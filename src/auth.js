const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const config = require("./config");
const db = require("./db");

const COOKIE = "livora_token";

function signUser(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: "12h" }
  );
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 12 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE);
}

function readUser(req) {
  const token = req.cookies?.[COOKIE] || "";
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.getUserById(payload.id);
    if (!user || user.status !== "active") return null;
    if (user.expire_date && new Date() > new Date(`${user.expire_date}T23:59:59`)) return null;
    return user;
  } catch {
    return null;
  }
}

function login(username, password) {
  const user = db.getUserByUsername(String(username || "").trim());
  if (!user) return { ok: false, message: "아이디 또는 비밀번호가 틀렸습니다." };
  if (!bcrypt.compareSync(String(password || ""), user.password_hash)) {
    return { ok: false, message: "아이디 또는 비밀번호가 틀렸습니다." };
  }
  if (user.status !== "active") return { ok: false, message: "정지된 계정입니다." };
  if (user.expire_date && new Date() > new Date(`${user.expire_date}T23:59:59`)) {
    return { ok: false, message: "사용 기간이 만료되었습니다." };
  }
  return { ok: true, user, token: signUser(user) };
}

function requireAuth(req, res, next) {
  const user = readUser(req);
  if (!user) {
    return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
  }
  req.user = publicUser(user);
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ ok: false, message: "관리자만 사용할 수 있습니다." });
  }
  next();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    status: user.status,
    expireDate: user.expire_date
  };
}

module.exports = {
  COOKIE,
  login,
  setAuthCookie,
  clearAuthCookie,
  readUser,
  requireAuth,
  requireAdmin,
  publicUser
};
