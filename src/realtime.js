const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");
const config = require("./config");
const db = require("./db");
const { COOKIE } = require("./auth");

const clients = new Map();

function parseCookie(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(rest.join("=") || "");
  });
  return out;
}

function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket, req) => {
    const cookies = parseCookie(req.headers.cookie);
    let user = null;
    try {
      const payload = jwt.verify(cookies[COOKIE] || "", config.jwtSecret);
      user = db.getUserById(payload.id);
    } catch {
      socket.close();
      return;
    }
    if (!user) {
      socket.close();
      return;
    }

    const list = clients.get(user.id) || new Set();
    list.add(socket);
    clients.set(user.id, list);

    socket.on("close", () => {
      list.delete(socket);
      if (!list.size) clients.delete(user.id);
    });
  });
}

function broadcastToUser(userId, type, payload) {
  const list = clients.get(userId);
  if (!list) return;
  const body = JSON.stringify({ type, payload, at: Date.now() });
  for (const socket of list) {
    if (socket.readyState === 1) socket.send(body);
  }
}

function makeBroadcaster(getSessionUserId) {
  return (sessionId, type, payload) => {
    const userId = getSessionUserId(sessionId);
    if (userId) broadcastToUser(userId, type, payload);
  };
}

function countOnlineSellers() {
  let count = 0;
  for (const [userId, list] of clients.entries()) {
    for (const socket of [...list]) {
      if (socket.readyState !== 1) list.delete(socket);
    }
    if (!list.size) {
      clients.delete(userId);
      continue;
    }
    const user = db.getUserById(userId);
    if (user?.role === "seller") count += 1;
  }
  return count;
}

module.exports = { attachRealtime, broadcastToUser, makeBroadcaster, countOnlineSellers };
