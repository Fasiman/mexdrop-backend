require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const passport = require("passport");
const SteamStrategy = require("passport-steam").Strategy;
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

// ============================================================================
// ПУТИ К ФАЙЛАМ
// ============================================================================

const CACHE_FILE = path.join(__dirname, "prices_cache.json");

const DB_DIR = path.join(__dirname, "db");
const USERS_FILE = path.join(DB_DIR, "users.json");
const UPGRADES_FILE = path.join(DB_DIR, "upgrades.json");

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json({ limit: "5mb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret_cs2_upgrade",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      secure: false,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================================

function ensureDbDir() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
}

function createDefaultStats() {
  return {
    totalUpgrades: 0,
    successfulUpgrades: 0,
    failedUpgrades: 0,
    totalDeposited: 0.0,
    totalWithdrawn: 0.0,
    totalWagered: 0.0,
  };
}

// ============================================================================
// USERS DB
// ============================================================================

function getUsersFromDb() {
  ensureDbDir();

  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(
      USERS_FILE,
      JSON.stringify([], null, 2),
      "utf-8"
    );

    return [];
  }

  try {
    const data = fs.readFileSync(USERS_FILE, "utf-8");

    if (!data.trim()) {
      return [];
    }

    const parsed = JSON.parse(data);

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(
      "[БД Users] Ошибка чтения файла:",
      error.message
    );

    return [];
  }
}

function saveUsersToDb(users) {
  try {
    ensureDbDir();

    fs.writeFileSync(
      USERS_FILE,
      JSON.stringify(users, null, 2),
      "utf-8"
    );

    return true;
  } catch (error) {
    console.error(
      "[БД Users] Ошибка записи в файл:",
      error.message
    );

    return false;
  }
}

// ============================================================================
// СОХРАНЕНИЕ / ОБНОВЛЕНИЕ STEAM USER
// ============================================================================

function saveOrUpdateUser(profile) {
  const users = getUsersFromDb();

  const steamid = profile.id;

  const userData = {
    id: steamid,
    steamid: steamid,
    username: profile.displayName || `User_${steamid.slice(-4)}`,
    avatar:
      profile.photos?.[2]?.value ||
      profile.photos?.[0]?.value ||
      "",
    profileUrl: profile._json?.profileurl || "",
    lastLogin: new Date().toISOString(),
  };

  const existingIndex = users.findIndex(
    (user) => user.steamid === steamid
  );

  if (existingIndex !== -1) {
    users[existingIndex] = {
      ...users[existingIndex],
      ...userData,
      stats: users[existingIndex].stats || createDefaultStats(),
      inventory: Array.isArray(users[existingIndex].inventory)
        ? users[existingIndex].inventory
        : [],
    };
  } else {
    const newUser = {
      ...userData,

      balance: 0.0,

      inventory: [],

      tradeUrl: "",

      role: "user",

      isBanned: false,

      stats: createDefaultStats(),

      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
  }

  if (saveUsersToDb(users)) {
    console.log(
      `[БД Users] Пользователь ${userData.username} (${steamid}) сохранен.`
    );
  }
}

// ============================================================================
// UPGRADES DB
// ============================================================================

function getUpgradesFromDb() {
  ensureDbDir();

  if (!fs.existsSync(UPGRADES_FILE)) {
    fs.writeFileSync(
      UPGRADES_FILE,
      JSON.stringify([], null, 2),
      "utf-8"
    );

    return [];
  }

  try {
    const data = fs.readFileSync(UPGRADES_FILE, "utf-8");

    if (!data.trim()) {
      return [];
    }

    const parsed = JSON.parse(data);

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(
      "[БД Upgrades] Ошибка чтения файла:",
      error.message
    );

    return [];
  }
}

function saveUpgradesToDb(upgrades) {
  try {
    ensureDbDir();

    fs.writeFileSync(
      UPGRADES_FILE,
      JSON.stringify(upgrades, null, 2),
      "utf-8"
    );

    return true;
  } catch (error) {
    console.error(
      "[БД Upgrades] Ошибка записи в файл:",
      error.message
    );

    return false;
  }
}

// ============================================================================
// PASSPORT
// ============================================================================

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

if (STEAM_API_KEY) {
  passport.use(
    new SteamStrategy(
      {
        returnURL: `${SERVER_URL}/api/auth/steam/return`,
        realm: `${SERVER_URL}/`,
        apiKey: STEAM_API_KEY,
      },
      (identifier, profile, done) => {
        process.nextTick(() => {
          profile.identifier = identifier;

          saveOrUpdateUser(profile);

          return done(null, profile);
        });
      }
    )
  );
}

// ============================================================================
// AUTH
// ============================================================================

app.get("/api/auth/steam", (req, res, next) => {
  if (!STEAM_API_KEY) {
    return res
      .status(500)
      .send("STEAM_API_KEY не задан в .env");
  }

  passport.authenticate("steam", {
    failureRedirect: "/",
  })(req, res, next);
});

app.get(
  "/api/auth/steam/return",
  passport.authenticate("steam", {
    failureRedirect: "/",
  }),
  (req, res) => {
    const steamid = req.user.id;

    res.redirect(
      `${CLIENT_URL}?steamid=${steamid}`
    );
  }
);

app.get("/api/auth/user", (req, res) => {
  try {
    if (req.isAuthenticated()) {
      const users = getUsersFromDb();

      const dbUser = users.find(
        (user) => user.steamid === req.user.id
      );

      return res.json({
        authenticated: true,

        user:
          dbUser ||
          {
            id: req.user.id,

            steamid: req.user.id,

            username:
              req.user.displayName ||
              `User_${req.user.id.slice(-4)}`,

            avatar:
              req.user.photos?.[2]?.value ||
              req.user.photos?.[0]?.value ||
              "",

            profileUrl:
              req.user._json?.profileurl ||
              "",

            balance: 0.0,

            inventory: [],

            tradeUrl: "",

            role: "user",

            isBanned: false,

            stats: createDefaultStats(),
          },
      });
    }

    return res.json({
      authenticated: false,
      user: null,
    });
  } catch (error) {
    console.error(
      "[AUTH USER] Ошибка:",
      error
    );

    return res.status(500).json({
      authenticated: false,
      user: null,
      error: "Ошибка проверки авторизации",
    });
  }
});

app.get("/api/auth/logout", (req, res, next) => {
  req.logout((error) => {
    if (error) {
      return next(error);
    }

    req.session.destroy(() => {
      res.json({
        success: true,
        message: "Выход выполнен",
      });
    });
  });
});

// ============================================================================
// ЦЕНЫ
// ============================================================================

let cachedPriceMap = null;
let lastFileMtime = 0;

function loadPricesFromJson() {
  if (!fs.existsSync(CACHE_FILE)) {
    return null;
  }

  try {
    const stat = fs.statSync(CACHE_FILE);

    if (
      cachedPriceMap &&
      stat.mtimeMs === lastFileMtime
    ) {
      return cachedPriceMap;
    }

    console.log(
      `[Цены] Читаем обновленный ${CACHE_FILE}...`
    );

    const raw = JSON.parse(
      fs.readFileSync(CACHE_FILE, "utf-8")
    );

    const priceDict = {};

    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item?.market_hash_name) {
          continue;
        }

        const price =
          item.suggested_price ??
          item.min_price ??
          item.median_price;

        if (
          price != null &&
          Number.isFinite(Number(price)) &&
          Number(price) > 0
        ) {
          priceDict[item.market_hash_name] =
            Number(Number(price).toFixed(2));
        }
      }
    }

    cachedPriceMap = priceDict;

    lastFileMtime = stat.mtimeMs;

    console.log(
      `[Цены] Успешно загружено ${
        Object.keys(priceDict).length
      } предметов`
    );

    return cachedPriceMap;
  } catch (error) {
    console.error(
      "[Цены] Ошибка чтения JSON:",
      error.message
    );

    return cachedPriceMap;
  }
}

loadPricesFromJson();

// ============================================================================
// API PRICES
// ============================================================================

const handlePricesRoute = (req, res) => {
  try {
    const prices = loadPricesFromJson();

    if (
      !prices ||
      Object.keys(prices).length === 0
    ) {
      return res.status(503).json({
        error: "Файл цен не найден или пуст",
        file: CACHE_FILE,
      });
    }

    return res.json(prices);
  } catch (error) {
    console.error(
      "[API Prices] Ошибка:",
      error
    );

    return res.status(500).json({
      error: "Ошибка загрузки цен",
    });
  }
};

app.get(
  "/api/prices",
  handlePricesRoute
);

app.get(
  "/api/items",
  handlePricesRoute
);

// ============================================================================
// API UPGRADES
// ============================================================================

// Получить последние успешные апгрейды
app.get("/api/upgrades", (req, res) => {
  try {
    const upgrades = getUpgradesFromDb();

    const requestedLimit =
      Number(req.query.limit) || 30;

    const limit = Math.min(
      100,
      Math.max(1, requestedLimit)
    );

    // Показываем только реальные выигрыши
    const winsOnly = upgrades.filter(
      (upgrade) =>
        upgrade?.won === true ||
        upgrade?.won === "true" ||
        upgrade?.won === 1
    );

    // Самые новые сверху
    const sorted = winsOnly.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime()
    );

    return res.json(
      sorted.slice(0, limit)
    );
  } catch (error) {
    console.error(
      "[API Upgrades GET] Ошибка:",
      error
    );

    return res.status(500).json({
      error:
        "Не удалось загрузить историю апгрейдов",
    });
  }
});

// Создать новый апгрейд
app.post("/api/upgrades", (req, res) => {
  try {
    const body = req.body || {};

    let {
      steamid,
      inputItem,
      outputItem,
      chance,
      multiplier,
      won,
      profit,
    } = body;

    // ========================================================================
    // ПОДДЕРЖКА СТАРОГО ФОРМАТА
    // Если вдруг Hero отправит:
    //
    // {
    //   steamid,
    //   name,
    //   image,
    //   price,
    //   wearShort,
    //   badgeBg,
    //   badgeColor
    // }
    //
    // сервер тоже сможет сохранить запись.
    // ========================================================================

    if (
      (!outputItem || typeof outputItem !== "object") &&
      body.name
    ) {
      outputItem = {
        id: body.id || `skin-${Date.now()}`,

        name: body.name,

        image: body.image || "",

        price: Number(body.price) || 0,

        wearShort: body.wearShort || "",

        badgeBg:
          body.badgeBg ||
          "rgba(59, 130, 246, 0.25)",

        badgeColor:
          body.badgeColor ||
          "#60a5fa",

        glow:
          body.glow ||
          "#4ade80",
      };
    }

    // Для старого формата inputItem может отсутствовать.
    if (
      (!inputItem ||
        typeof inputItem !== "object") &&
      outputItem
    ) {
      inputItem = {
        id: "unknown-input",

        name: "Предмет",

        image: "",

        price: 0,
      };
    }

    // ========================================================================
    // ПРОВЕРКА
    // ========================================================================

    if (!steamid) {
      return res.status(400).json({
        error:
          "Недостаточно данных: отсутствует steamid",
      });
    }

    if (
      !outputItem ||
      typeof outputItem !== "object"
    ) {
      return res.status(400).json({
        error:
          "Недостаточно данных: отсутствует outputItem",
      });
    }

    if (
      !inputItem ||
      typeof inputItem !== "object"
    ) {
      return res.status(400).json({
        error:
          "Недостаточно данных: отсутствует inputItem",
      });
    }

    // ========================================================================
    // ПОЛЬЗОВАТЕЛЬ
    // ========================================================================

    const users = getUsersFromDb();

    let userIndex = users.findIndex(
      (user) =>
        String(user.steamid) === String(steamid)
    );

    // Если пользователя нет, автоматически создаём
    // demo-пользователя.
    if (userIndex === -1) {
      const newUser = {
        id: String(steamid),

        steamid: String(steamid),

        username:
          body.username ||
          `User_${String(steamid).slice(-4)}`,

        avatar: body.avatar || "",

        profileUrl:
          body.profileUrl || "",

        balance:
          Number(body.balance) || 0,

        inventory: Array.isArray(body.inventory)
          ? body.inventory
          : [],

        tradeUrl: "",

        role: "user",

        isBanned: false,

        stats: createDefaultStats(),

        createdAt:
          new Date().toISOString(),

        lastLogin:
          new Date().toISOString(),
      };

      users.push(newUser);

      userIndex = users.length - 1;

      console.log(
        `[БД Users] Автоматически создан пользователь ${steamid}`
      );
    }

    const user = users[userIndex];

    // ========================================================================
    // НОРМАЛИЗАЦИЯ ДАННЫХ
    // ========================================================================

    const safeChance =
      Number.isFinite(Number(chance))
        ? Number(chance)
        : 0;

    const safeInputPrice =
      Number.isFinite(
        Number(inputItem.price)
      )
        ? Number(inputItem.price)
        : 0;

    const safeOutputPrice =
      Number.isFinite(
        Number(outputItem.price)
      )
        ? Number(outputItem.price)
        : 0;

    const safeMultiplier =
      Number.isFinite(Number(multiplier))
        ? Number(multiplier)
        : safeInputPrice > 0
          ? safeOutputPrice /
            safeInputPrice
          : 0;

    const safeWon =
      won === true ||
      won === "true" ||
      won === 1;

    const safeProfit =
      Number.isFinite(Number(profit))
        ? Number(profit)
        : safeOutputPrice -
          safeInputPrice;

    // ========================================================================
    // НОВАЯ ЗАПИСЬ
    // ========================================================================

    const newUpgrade = {
      id:
        Date.now().toString() +
        Math.random()
          .toString(36)
          .substring(2, 9),

      steamid: user.steamid,

      username:
        user.username ||
        `User_${String(steamid).slice(-4)}`,

      avatar: user.avatar || "",

      inputItem: {
        ...inputItem,

        price: Number(
          safeInputPrice.toFixed(2)
        ),
      },

      outputItem: {
        ...outputItem,

        price: Number(
          safeOutputPrice.toFixed(2)
        ),
      },

      chance: Number(
        safeChance.toFixed(2)
      ),

      multiplier: Number(
        safeMultiplier.toFixed(4)
      ),

      won: safeWon,

      profit: Number(
        safeProfit.toFixed(2)
      ),

      createdAt:
        new Date().toISOString(),
    };

    // ========================================================================
    // ОБНОВЛЕНИЕ СТАТИСТИКИ
    // ========================================================================

    user.stats = {
      ...createDefaultStats(),
      ...(user.stats || {}),
    };

    user.stats.totalUpgrades =
      Number(user.stats.totalUpgrades) || 0;

    user.stats.successfulUpgrades =
      Number(
        user.stats.successfulUpgrades
      ) || 0;

    user.stats.failedUpgrades =
      Number(
        user.stats.failedUpgrades
      ) || 0;

    user.stats.totalWagered =
      Number(
        user.stats.totalWagered
      ) || 0;

    user.stats.totalUpgrades += 1;

    if (safeWon) {
      user.stats.successfulUpgrades += 1;
    } else {
      user.stats.failedUpgrades += 1;
    }

    user.stats.totalWagered +=
      safeInputPrice;

    users[userIndex] = user;

    // Сохраняем пользователя
    if (!saveUsersToDb(users)) {
      return res.status(500).json({
        error:
          "Не удалось сохранить пользователя",
      });
    }

    // ========================================================================
    // СОХРАНЯЕМ UPGRADES
    // ========================================================================

    const upgrades =
      getUpgradesFromDb();

    upgrades.push(newUpgrade);

    // Новые записи сверху
    upgrades.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime()
    );

    // Храним максимум 200 записей
    const trimmedUpgrades =
      upgrades.slice(0, 200);

    if (
      !saveUpgradesToDb(
        trimmedUpgrades
      )
    ) {
      return res.status(500).json({
        error:
          "Не удалось сохранить апгрейд в историю",
      });
    }

    console.log(
      `[UPGRADE] ${safeWon ? "WIN" : "LOSE"} | ${
        outputItem.name || "Скин"
      } | ${safeOutputPrice.toFixed(2)} ₽ | SteamID: ${steamid}`
    );

    return res.status(201).json({
      success: true,

      upgrade: newUpgrade,
    });
  } catch (error) {
    console.error(
      "[API Upgrades POST] Ошибка:",
      error
    );

    return res.status(500).json({
      error:
        "Внутренняя ошибка сервера при сохранении апгрейда",
    });
  }
});

// ============================================================================
// USERS API
// ============================================================================

// Получить всех пользователей
app.get("/api/users", (req, res) => {
  try {
    const users = getUsersFromDb();

    return res.json(users);
  } catch (error) {
    console.error(
      "[API Users GET] Ошибка:",
      error
    );

    return res.status(500).json({
      error:
        "Не удалось загрузить пользователей",
    });
  }
});

// Получить пользователя
app.get(
  "/api/users/:steamid",
  (req, res) => {
    try {
      const { steamid } = req.params;

      const users = getUsersFromDb();

      const user = users.find(
        (item) =>
          String(item.steamid) ===
          String(steamid)
      );

      if (!user) {
        return res.status(404).json({
          error:
            "Пользователь не найден",
        });
      }

      return res.json(user);
    } catch (error) {
      console.error(
        "[API User GET] Ошибка:",
        error
      );

      return res.status(500).json({
        error:
          "Ошибка получения пользователя",
      });
    }
  }
);

// Создать пользователя
app.post("/api/users", (req, res) => {
  try {
    const {
      steamid,
      username,
      avatar,
      profileUrl,
      balance,
      role,
      tradeUrl,
    } = req.body;

    if (!steamid) {
      return res.status(400).json({
        error:
          "Поле steamid обязательно",
      });
    }

    const users = getUsersFromDb();

    const existingUser =
      users.find(
        (user) =>
          String(user.steamid) ===
          String(steamid)
      );

    if (existingUser) {
      return res.status(409).json({
        error:
          "Пользователь с таким steamid уже существует",
      });
    }

    const newUser = {
      id: String(steamid),

      steamid: String(steamid),

      username:
        username ||
        `User_${String(steamid).slice(-4)}`,

      avatar: avatar || "",

      profileUrl:
        profileUrl || "",

      balance:
        Number(balance) || 0.0,

      inventory:
        Array.isArray(req.body.inventory)
          ? req.body.inventory
          : [],

      tradeUrl:
        tradeUrl || "",

      role:
        role || "user",

      isBanned:
        Boolean(req.body.isBanned),

      stats: {
        ...createDefaultStats(),
        ...(req.body.stats || {}),
      },

      createdAt:
        new Date().toISOString(),

      lastLogin:
        new Date().toISOString(),
    };

    users.push(newUser);

    if (!saveUsersToDb(users)) {
      return res.status(500).json({
        error:
          "Не удалось сохранить пользователя в БД",
      });
    }

    return res.status(201).json({
      message:
        "Пользователь успешно создан",

      user: newUser,
    });
  } catch (error) {
    console.error(
      "[API Users POST] Ошибка:",
      error
    );

    return res.status(500).json({
      error:
        "Ошибка создания пользователя",
    });
  }
});

// ============================================================================
// ОБНОВИТЬ USER
// ============================================================================

app.put(
  "/api/users/:steamid",
  (req, res) => {
    try {
      const { steamid } = req.params;

      const users = getUsersFromDb();

      const index = users.findIndex(
        (user) =>
          String(user.steamid) ===
          String(steamid)
      );

      if (index === -1) {
        return res.status(404).json({
          error:
            "Пользователь не найден",
        });
      }

      const currentData =
        users[index];

      const updatedUser = {
        ...currentData,

        ...req.body,

        id: currentData.id,

        steamid: currentData.steamid,

        stats: req.body.stats
          ? {
              ...(currentData.stats ||
                createDefaultStats()),

              ...req.body.stats,
            }
          : currentData.stats ||
            createDefaultStats(),
      };

      users[index] = updatedUser;

      if (!saveUsersToDb(users)) {
        return res.status(500).json({
          error:
            "Не удалось сохранить изменения в БД",
        });
      }

      return res.json({
        message:
          "Пользователь успешно обновлен",

        user: updatedUser,
      });
    } catch (error) {
      console.error(
        "[API Users PUT] Ошибка:",
        error
      );

      return res.status(500).json({
        error:
          "Ошибка обновления пользователя",
      });
    }
  }
);

// PATCH — тоже обновление
app.patch(
  "/api/users/:steamid",
  (req, res) => {
    try {
      const { steamid } = req.params;

      const users = getUsersFromDb();

      const index = users.findIndex(
        (user) =>
          String(user.steamid) ===
          String(steamid)
      );

      if (index === -1) {
        return res.status(404).json({
          error:
            "Пользователь не найден",
        });
      }

      const currentData =
        users[index];

      const updatedUser = {
        ...currentData,

        ...req.body,

        id: currentData.id,

        steamid: currentData.steamid,

        stats: req.body.stats
          ? {
              ...(currentData.stats ||
                createDefaultStats()),

              ...req.body.stats,
            }
          : currentData.stats ||
            createDefaultStats(),
      };

      users[index] = updatedUser;

      if (!saveUsersToDb(users)) {
        return res.status(500).json({
          error:
            "Не удалось сохранить изменения в БД",
        });
      }

      return res.json({
        message:
          "Пользователь успешно обновлен",

        user: updatedUser,
      });
    } catch (error) {
      console.error(
        "[API Users PATCH] Ошибка:",
        error
      );

      return res.status(500).json({
        error:
          "Ошибка обновления пользователя",
      });
    }
  }
);

// ============================================================================
// DELETE USER
// ============================================================================

app.delete(
  "/api/users/:steamid",
  (req, res) => {
    try {
      const { steamid } = req.params;

      const users = getUsersFromDb();

      const index = users.findIndex(
        (user) =>
          String(user.steamid) ===
          String(steamid)
      );

      if (index === -1) {
        return res.status(404).json({
          error:
            "Пользователь не найден",
        });
      }

      const deletedUser =
        users.splice(index, 1)[0];

      if (!saveUsersToDb(users)) {
        return res.status(500).json({
          error:
            "Не удалось удалить пользователя из БД",
        });
      }

      return res.json({
        message:
          "Пользователь успешно удален",

        user: deletedUser,
      });
    } catch (error) {
      console.error(
        "[API Users DELETE] Ошибка:",
        error
      );

      return res.status(500).json({
        error:
          "Ошибка удаления пользователя",
      });
    }
  }
);

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,

    server: "CS2 Upgrade Backend",

    time: new Date().toISOString(),
  });
});

// ============================================================================
// 404
// ============================================================================

app.use((req, res) => {
  res.status(404).json({
    error: "API endpoint не найден",
    method: req.method,
    path: req.path,
  });
});

// ============================================================================
// GLOBAL ERROR HANDLER
// ============================================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "[GLOBAL ERROR]",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      error:
        "Внутренняя ошибка сервера",
    });
  }
);

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log("");
  console.log(
    "=================================================="
  );
  console.log(
    "🚀 CS2 Upgrade Backend запущен"
  );
  console.log(
    `🌐 Сервер: ${SERVER_URL}`
  );
  console.log(
    `👥 Users: ${SERVER_URL}/api/users`
  );
  console.log(
    `🎲 Upgrades: ${SERVER_URL}/api/upgrades`
  );
  console.log(
    `💰 Prices: ${SERVER_URL}/api/prices`
  );
  console.log(
    `❤️ Health: ${SERVER_URL}/api/health`
  );
  console.log(
    "=================================================="
  );
  console.log("");
});