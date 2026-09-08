require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

// Путь к вашему JSON-файлу с ценами
const CACHE_FILE = path.join(__dirname, 'prices_cache.json');

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'secret_cs2_upgrade',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

if (STEAM_API_KEY) {
  passport.use(new SteamStrategy({
      returnURL: `${SERVER_URL}/api/auth/steam/return`,
      realm: `${SERVER_URL}/`,
      apiKey: STEAM_API_KEY
    },
    (identifier, profile, done) => {
      process.nextTick(() => {
        profile.identifier = identifier;
        return done(null, profile);
      });
    }
  ));
}

// ================= AUTH =================
app.get('/api/auth/steam', (req, res, next) => {
  if (!STEAM_API_KEY) return res.status(500).send('STEAM_API_KEY не задан');
  passport.authenticate('steam', { failureRedirect: '/' })(req, res, next);
});

app.get('/api/auth/steam/return',
  passport.authenticate('steam', { failureRedirect: '/' }),
  (req, res) => res.redirect(CLIENT_URL)
);

app.get('/api/auth/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        steamid: req.user.id,
        username: req.user.displayName,
        avatar: req.user.photos?.[2]?.value || req.user.photos?.[0]?.value,
        profileUrl: req.user._json?.profileurl
      }
    });
  } else {
    res.json({ authenticated: false, user: null });
  }
});

app.get('/api/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.json({ success: true, message: 'Выход выполнен' });
  });
});

// ================= КЭШ ЦЕН (ЛОКАЛЬНЫЙ JSON) =================
let cachedPriceMap = null;
let lastFileMtime = 0;

/**
 * Читает prices_cache.json и строит словарь { "itemName": priceInRub }.
 * Если файл не изменился, возвращает данные из памяти (очень быстро).
 * Если файл заменен на новый — автоматически перечитывает его!
 */
function loadPricesFromJson() {
  if (!fs.existsSync(CACHE_FILE)) return null;

  try {
    const stat = fs.statSync(CACHE_FILE);
    
    // Если файл не менялся и у нас уже есть данные в памяти — просто отдаем их
    if (cachedPriceMap && stat.mtimeMs === lastFileMtime) {
      return cachedPriceMap;
    }

    // Файл новый (или первый запуск) — читаем и парсим
    console.log(`[Цены] Читаем обновленный ${CACHE_FILE}...`);
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    const priceDict = {};

    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item.market_hash_name) continue;
        
        // Берем suggested_price, если её нет — min_price или median_price
        const price = item.suggested_price ?? item.min_price ?? item.median_price;
        
        if (price != null && Number.isFinite(price) && price > 0) {
          priceDict[item.market_hash_name] = Number(price.toFixed(2));
        }
      }
    }

    cachedPriceMap = priceDict;
    lastFileMtime = stat.mtimeMs;
    
    console.log(`[Цены] Успешно загружено ${Object.keys(priceDict).length} предметов`);
    return cachedPriceMap;
    
  } catch (e) {
    console.error('[Цены] Ошибка чтения JSON:', e.message);
    return cachedPriceMap; // В случае ошибки отдаем старый кэш из памяти
  }
}

// Загружаем цены сразу при старте сервера
loadPricesFromJson();

// ================= API ЭНДПОИНТЫ =================
const handlePricesRoute = (req, res) => {
  const prices = loadPricesFromJson();
  
  if (!prices || Object.keys(prices).length === 0) {
    return res.status(503).json({ 
      error: 'Файл цен не найден или пуст', 
      file: CACHE_FILE 
    });
  }
  
  res.json(prices);
};

app.get('/api/prices', handlePricesRoute);
app.get('/api/items', handlePricesRoute); // Для совместимости

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}/api/prices`);
  if (cachedPriceMap) {
    console.log(`✅ [Кэш] ${Object.keys(cachedPriceMap).length} предметов в памяти`);
    console.log(`💡 Совет: просто замените prices_cache.json новым файлом, и цены обновятся автоматически!`);
  } else {
    console.warn(`⚠️ [Кэш] Файл ${CACHE_FILE} не найден! Положите JSON в папку с сервером.`);
  }
});