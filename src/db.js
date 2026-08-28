const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const config = require("./config");

let db;

function open() {
  if (db) return db;

  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.shotsDir, { recursive: true });
  fs.mkdirSync(config.invoicesDir, { recursive: true });
  fs.mkdirSync(config.exportsDir, { recursive: true });

  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      expire_date TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approved_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, platform, channel_id)
    );

    CREATE TABLE IF NOT EXISTS live_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      stopped_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      product TEXT,
      number TEXT,
      options_json TEXT,
      price INTEGER DEFAULT 0,
      stock INTEGER DEFAULT 0,
      display_name TEXT,
      shot_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      product TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      chat_key TEXT NOT NULL,
      uid TEXT,
      nick TEXT,
      msg TEXT,
      is_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      uid TEXT NOT NULL,
      nick TEXT,
      product TEXT,
      option_name TEXT,
      color TEXT,
      size TEXT,
      qty INTEGER DEFAULT 0,
      price INTEGER DEFAULT 0,
      amount INTEGER DEFAULT 0,
      msg TEXT,
      shot_path TEXT,
      identity_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, uid, identity_key)
    );
  `);

  const productCols = db.prepare("PRAGMA table_info(products)").all().map((col) => col.name);
  if (!productCols.includes("default_qty")) {
    db.exec("ALTER TABLE products ADD COLUMN default_qty INTEGER DEFAULT 1");
  }

  const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((col) => col.name);
  if (!orderCols.includes("match_source")) {
    db.exec("ALTER TABLE orders ADD COLUMN match_source TEXT DEFAULT ''");
  }
  if (!orderCols.includes("inferred")) {
    db.exec("ALTER TABLE orders ADD COLUMN inferred INTEGER DEFAULT 0");
  }

  seed();
  return db;
}

function now() {
  return new Date().toISOString();
}

function seed() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;

  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, name, role, status, expire_date, created_at)
    VALUES (@username, @password_hash, @name, @role, 'active', @expire_date, @created_at)
  `);

  insertUser.run({
    username: config.adminUsername,
    password_hash: bcrypt.hashSync(config.adminPassword, 10),
    name: "Livora Admin",
    role: "admin",
    expire_date: "2028-12-31",
    created_at: now()
  });

  const seller = insertUser.run({
    username: "seller",
    password_hash: bcrypt.hashSync("seller1234", 10),
    name: "판매자",
    role: "seller",
    expire_date: "2028-12-31",
    created_at: now()
  });

  const insertChannel = db.prepare(`
    INSERT INTO approved_channels (user_id, platform, channel_id, label, created_at)
    VALUES (@user_id, @platform, @channel_id, @label, @created_at)
  `);

  insertChannel.run({
    user_id: seller.lastInsertRowid,
    platform: "tiktok",
    channel_id: "nandapick21",
    label: "틱톡 샘플",
    created_at: now()
  });

  insertChannel.run({
    user_id: seller.lastInsertRowid,
    platform: "youtube",
    channel_id: "땡도령2",
    label: "유튜브 샘플",
    created_at: now()
  });
}

function getUserByUsername(username) {
  return open().prepare("SELECT * FROM users WHERE username = ?").get(username);
}

function getUserById(id) {
  return open().prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function listUsers() {
  return open().prepare(`
    SELECT id, username, name, role, status, expire_date, created_at
    FROM users ORDER BY id ASC
  `).all();
}

function createUser({ username, password, name, role, expireDate }) {
  const result = open().prepare(`
    INSERT INTO users (username, password_hash, name, role, status, expire_date, created_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(
    username,
    bcrypt.hashSync(password, 10),
    name || username,
    role || "seller",
    expireDate || "2028-12-31",
    now()
  );
  return getUserById(result.lastInsertRowid);
}

function updateUser(id, patch) {
  const user = getUserById(id);
  if (!user) return null;
  const next = {
    name: patch.name ?? user.name,
    role: patch.role ?? user.role,
    status: patch.status ?? user.status,
    expire_date: patch.expireDate ?? user.expire_date,
    password_hash: patch.password ? bcrypt.hashSync(patch.password, 10) : user.password_hash
  };
  open().prepare(`
    UPDATE users
    SET name = @name, role = @role, status = @status, expire_date = @expire_date, password_hash = @password_hash
    WHERE id = @id
  `).run({ ...next, id });
  return getUserById(id);
}

function listChannels(userId) {
  const sql = userId
    ? "SELECT * FROM approved_channels WHERE user_id = ? ORDER BY id DESC"
    : `SELECT c.*, u.username, u.name AS user_name
       FROM approved_channels c
       JOIN users u ON u.id = c.user_id
       ORDER BY c.id DESC`;
  return userId ? open().prepare(sql).all(userId) : open().prepare(sql).all();
}

function findApprovedChannel(userId, platform, channelId) {
  return open().prepare(`
    SELECT * FROM approved_channels
    WHERE user_id = ? AND platform = ? AND channel_id = ?
  `).get(userId, platform, channelId);
}

function findApprovedChannelAny(platform, channelId) {
  return open().prepare(`
    SELECT * FROM approved_channels
    WHERE platform = ? AND channel_id = ?
    ORDER BY id DESC
  `).get(platform, channelId);
}

function addChannel({ userId, platform, channelId, label }) {
  const result = open().prepare(`
    INSERT INTO approved_channels (user_id, platform, channel_id, label, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, platform, String(channelId).trim(), label || "", now());
  return open().prepare("SELECT * FROM approved_channels WHERE id = ?").get(result.lastInsertRowid);
}

function removeChannel(id) {
  return open().prepare("DELETE FROM approved_channels WHERE id = ?").run(id);
}

function createLiveSession({ id, userId, platform, channelId }) {
  open().prepare(`
    INSERT INTO live_sessions (id, user_id, platform, channel_id, status, started_at)
    VALUES (?, ?, ?, ?, 'running', ?)
  `).run(id, userId, platform, channelId, now());
}

function updateLiveSession(id, patch) {
  const session = getLiveSession(id);
  if (!session) return;
  open().prepare(`
    UPDATE live_sessions
    SET status = @status, stopped_at = @stopped_at, error = @error
    WHERE id = @id
  `).run({
    id,
    status: patch.status ?? session.status,
    stopped_at: patch.stoppedAt ?? session.stopped_at,
    error: patch.error ?? session.error
  });
}

function getLiveSession(id) {
  return open().prepare("SELECT * FROM live_sessions WHERE id = ?").get(id);
}

function listLiveSessions(userId) {
  if (userId) {
    return open().prepare(`
      SELECT * FROM live_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 50
    `).all(userId);
  }
  return open().prepare("SELECT * FROM live_sessions ORDER BY started_at DESC LIMIT 50").all();
}

function insertProduct(row) {
  return open().prepare(`
    INSERT INTO products (session_id, type, product, number, options_json, price, stock, default_qty, display_name, shot_path, created_at)
    VALUES (@session_id, @type, @product, @number, @options_json, @price, @stock, @default_qty, @display_name, @shot_path, @created_at)
  `).run({ created_at: now(), default_qty: 1, ...row });
}

function deleteProduct(sessionId, reg) {
  open().prepare(`
    DELETE FROM products
    WHERE session_id = ?
      AND type = ?
      AND IFNULL(product, '') = ?
      AND IFNULL(number, '') = ?
  `).run(sessionId, reg.type, reg.product || "", reg.number || "");
}

function deleteAliasesForProduct(sessionId, product) {
  if (!product) return;
  open().prepare(`
    DELETE FROM aliases WHERE session_id = ? AND product = ?
  `).run(sessionId, product);
}

function insertAlias(row) {
  open().prepare(`
    INSERT INTO aliases (session_id, alias, product) VALUES (?, ?, ?)
  `).run(row.session_id, row.alias, row.product);
}

function insertChat(row) {
  open().prepare(`
    INSERT INTO chats (session_id, chat_key, uid, nick, msg, is_order, created_at, created_ms)
    VALUES (@session_id, @chat_key, @uid, @nick, @msg, @is_order, @created_at, @created_ms)
  `).run(row);
}

function upsertOrder(row) {
  open().prepare(`
    INSERT INTO orders (
      session_id, uid, nick, product, option_name, color, size, qty, price, amount, msg, shot_path, identity_key, match_source, inferred, created_at, updated_at
    ) VALUES (
      @session_id, @uid, @nick, @product, @option_name, @color, @size, @qty, @price, @amount, @msg, @shot_path, @identity_key, @match_source, @inferred, @created_at, @updated_at
    )
    ON CONFLICT(session_id, uid, identity_key) DO UPDATE SET
      nick = excluded.nick,
      qty = excluded.qty,
      price = excluded.price,
      amount = excluded.amount,
      msg = excluded.msg,
      shot_path = excluded.shot_path,
      match_source = excluded.match_source,
      inferred = excluded.inferred,
      updated_at = excluded.updated_at
  `).run({ created_at: now(), updated_at: now(), match_source: "", inferred: 0, ...row });
}

function deleteOrder(sessionId, uid, identityKey) {
  open().prepare(`
    DELETE FROM orders WHERE session_id = ? AND uid = ? AND identity_key = ?
  `).run(sessionId, uid, identityKey);
}

function listChats(sessionId, limit = 200) {
  return open().prepare(`
    SELECT * FROM chats WHERE session_id = ? ORDER BY created_ms DESC LIMIT ?
  `).all(sessionId, limit).reverse();
}

function listAllChats(sessionId) {
  return open().prepare(`
    SELECT uid, nick, msg, is_order, created_at, created_ms, id
    FROM chats
    WHERE session_id = ?
    ORDER BY created_ms ASC, id ASC
  `).all(sessionId);
}

function startOfLocalDayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function listChatsForUserToday(userId, { platform, channelId } = {}) {
  const since = startOfLocalDayMs();
  if (platform && channelId) {
    return open().prepare(`
      SELECT c.uid, c.nick, c.msg, c.is_order, c.created_at, c.created_ms, c.id
      FROM chats c
      JOIN live_sessions s ON s.id = c.session_id
      WHERE s.user_id = ?
        AND s.platform = ?
        AND s.channel_id = ?
        AND c.created_ms >= ?
      ORDER BY c.created_ms ASC, c.id ASC
    `).all(userId, platform, channelId, since);
  }
  return open().prepare(`
    SELECT c.uid, c.nick, c.msg, c.is_order, c.created_at, c.created_ms, c.id
    FROM chats c
    JOIN live_sessions s ON s.id = c.session_id
    WHERE s.user_id = ?
      AND c.created_ms >= ?
    ORDER BY c.created_ms ASC, c.id ASC
  `).all(userId, since);
}

function listOrders(sessionId) {
  return open().prepare(`
    SELECT * FROM orders WHERE session_id = ? ORDER BY updated_at DESC
  `).all(sessionId);
}

function listProducts(sessionId) {
  return open().prepare(`
    SELECT * FROM products WHERE session_id = ? ORDER BY id DESC
  `).all(sessionId);
}

function markChatAsOrder(sessionId, chatKey) {
  open().prepare(`
    UPDATE chats SET is_order = 1 WHERE session_id = ? AND chat_key = ?
  `).run(sessionId, chatKey);
}

module.exports = {
  open,
  getUserByUsername,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  listChannels,
  findApprovedChannel,
  findApprovedChannelAny,
  addChannel,
  removeChannel,
  createLiveSession,
  updateLiveSession,
  getLiveSession,
  listLiveSessions,
  insertProduct,
  deleteProduct,
  deleteAliasesForProduct,
  insertAlias,
  insertChat,
  upsertOrder,
  deleteOrder,
  listChats,
  listAllChats,
  listChatsForUserToday,
  listOrders,
  listProducts,
  markChatAsOrder
};
