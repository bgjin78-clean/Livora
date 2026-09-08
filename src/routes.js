const fs = require("fs");
const path = require("path");
const express = require("express");
const db = require("./db");
const auth = require("./auth");
const collector = require("./collectors/manager");
const { writeExcel, writeChatExcel, writeUserDayChatExcel } = require("./export/excel");
const { renderInvoices } = require("./export/images");

function createRouter(broadcast) {
  const router = express.Router();

  function lastSessionFor(userId) {
    const row = db.listLiveSessions(userId)[0];
    if (!row) return null;
    return {
      id: row.id,
      platform: row.platform,
      channelId: row.channel_id,
      status: row.status,
      startedAt: row.started_at,
      stoppedAt: row.stopped_at
    };
  }

  router.post("/login", (req, res) => {
    const result = auth.login(req.body?.username, req.body?.password);
    if (!result.ok) return res.status(401).json(result);
    auth.setAuthCookie(res, result.token);
    res.json({ ok: true, user: auth.publicUser(result.user) });
  });

  router.post("/logout", (req, res) => {
    auth.clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get("/me", auth.requireAuth, (req, res) => {
    const current = collector.publicSession(collector.getUserSession(req.user.id));
    res.json({
      ok: true,
      user: req.user,
      channels: req.user.role === "admin" ? db.listChannels() : db.listChannels(req.user.id),
      session: current,
      lastSession: current || lastSessionFor(req.user.id)
    });
  });

  router.get("/admin/users", auth.requireAuth, auth.requireAdmin, (req, res) => {
    res.json({ ok: true, users: db.listUsers() });
  });

  router.post("/admin/users", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const { username, password, name, role, expireDate, status } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, message: "아이디와 비밀번호가 필요합니다." });
    }
    try {
      const user = db.createUser({ username, password, name, role, expireDate, status });
      res.json({ ok: true, user });
    } catch {
      res.status(400).json({ ok: false, message: "이미 있는 아이디입니다." });
    }
  });

  router.patch("/admin/users/:id", auth.requireAuth, auth.requireAdmin, (req, res) => {
    try {
      const user = db.updateUser(Number(req.params.id), req.body || {});
      if (!user) return res.status(404).json({ ok: false, message: "사용자를 찾지 못했습니다." });
      res.json({ ok: true, user: auth.publicUser(user) });
    } catch (err) {
      const message = String(err?.message || "");
      if (/UNIQUE|already/i.test(message)) {
        return res.status(400).json({ ok: false, message: "이미 있는 아이디입니다." });
      }
      res.status(400).json({ ok: false, message: message || "수정하지 못했습니다." });
    }
  });

  router.delete("/admin/users/:id", auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(400).json({ ok: false, message: "지금 로그인 중인 계정은 삭제할 수 없습니다." });
    }
    const live = collector.getUserSession(id);
    if (live) await collector.stopSession(live.id);
    const result = db.deleteUser(id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ ok: true });
  });

  router.get("/admin/accounts.csv", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const rows = [
      ["아이디", "이름", "역할", "상태", "만료일"],
      ...db.listUsers().map((user) => [
        user.username,
        user.name,
        user.role,
        user.status,
        user.expire_date || ""
      ])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=livora-accounts.csv");
    res.send(`\uFEFF${csv}`);
  });

  router.get("/admin/accounts-backup", auth.requireAuth, auth.requireAdmin, (req, res) => {
    db.persistAccounts();
    res.json({ ok: true, backup: db.snapshotAccounts() });
  });

  router.post("/admin/accounts-restore", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const backup = req.body?.backup || req.body;
    if (!backup?.users || !Array.isArray(backup.users)) {
      return res.status(400).json({ ok: false, message: "복구 파일 형식이 올바르지 않습니다." });
    }
    res.json(db.importAccountBackup(backup));
  });

  router.get("/admin/users/:id/data", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const user = db.getUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ ok: false, message: "사용자를 찾지 못했습니다." });
    const sessions = db.listLiveSessionsWithCounts(user.id);
    const requested = String(req.query.sessionId || "").trim();
    const session = requested
      ? sessions.find((row) => row.id === requested) || null
      : sessions[0] || null;
    res.json({
      ok: true,
      user: auth.publicUser(user),
      channels: db.listChannels(user.id),
      sessions,
      session,
      orders: session ? db.listOrders(session.id) : [],
      chats: session ? db.listChats(session.id, 80) : []
    });
  });

  router.get("/admin/users/:id/export/chats", auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const user = db.getUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ ok: false, message: "사용자를 찾지 못했습니다." });
    const filePath = await writeUserDayChatExcel(user.id);
    res.download(filePath, `${user.username}-chats.xlsx`);
  });

  router.get("/admin/channels", auth.requireAuth, auth.requireAdmin, (req, res) => {
    res.json({ ok: true, channels: db.listChannels() });
  });

  router.post("/admin/channels", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const { userId, platform, channelId, label } = req.body || {};
    if (!userId || !platform || !channelId) {
      return res.status(400).json({ ok: false, message: "계정, 플랫폼, 채널 ID가 필요합니다." });
    }
    if (!["tiktok", "youtube"].includes(platform)) {
      return res.status(400).json({ ok: false, message: "플랫폼은 tiktok 또는 youtube만 가능합니다." });
    }
    try {
      const channel = db.addChannel({ userId, platform, channelId, label });
      res.json({ ok: true, channel });
    } catch {
      res.status(400).json({ ok: false, message: "이미 승인된 채널입니다." });
    }
  });

  router.delete("/admin/channels/:id", auth.requireAuth, auth.requireAdmin, (req, res) => {
    db.removeChannel(Number(req.params.id));
    res.json({ ok: true });
  });

  router.post("/sessions/start", auth.requireAuth, async (req, res) => {
    try {
      const session = await collector.startSession({
        user: req.user,
        platform: req.body?.platform,
        channelId: req.body?.channelId,
        broadcast: (sessionId, type, payload) => {
          const live = collector.getSession(sessionId);
          if (live) broadcast(live.userId, type, payload);
        }
      });
      res.json({ ok: true, session });
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  router.post("/sessions/stop", auth.requireAuth, async (req, res) => {
    const live = collector.getUserSession(req.user.id);
    if (!live) return res.json({ ok: true, session: null, lastSession: lastSessionFor(req.user.id) });
    await collector.stopSession(live.id);
    const lastSession = lastSessionFor(req.user.id);
    res.json({ ok: true, session: lastSession, lastSession });
  });

  router.post("/sessions/products", auth.requireAuth, async (req, res) => {
    const live = collector.getUserSession(req.user.id);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    const body = req.body || {};
    const hasFields = ["name", "number", "option", "size", "color", "qty", "price", "stock"].some((key) => body[key] != null && String(body[key]).trim() !== "");
    const input = hasFields
      ? {
          name: body.name,
          number: body.number,
          option: body.option,
          size: body.size,
          color: body.color,
          qty: body.qty,
          price: body.price,
          stock: body.stock
        }
      : (body.payload || "");
    const result = await collector.registerProduct(live, input);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  router.post("/sessions/products/remove", auth.requireAuth, (req, res) => {
    const live = collector.getUserSession(req.user.id);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    const result = collector.removeProduct(live, req.body || {});
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  router.post("/sessions/qty-mode", auth.requireAuth, (req, res) => {
    const live = collector.getUserSession(req.user.id);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    res.json(live.engine.toggleQtyMode());
  });

  router.get("/sessions/current", auth.requireAuth, (req, res) => {
    const live = collector.getUserSession(req.user.id);
    const lastSession = collector.publicSession(live) || lastSessionFor(req.user.id);
    const sessionId = lastSession?.id;
    res.json({
      ok: true,
      session: collector.publicSession(live),
      lastSession,
      chats: sessionId ? db.listChats(sessionId, 120) : [],
      orders: sessionId ? db.listOrders(sessionId) : [],
      products: sessionId ? db.listProducts(sessionId) : []
    });
  });

  router.get("/sessions/:id/export/excel", auth.requireAuth, async (req, res) => {
    const session = db.getLiveSession(req.params.id);
    if (!session || (session.user_id !== req.user.id && req.user.role !== "admin")) {
      return res.status(404).json({ ok: false, message: "세션을 찾지 못했습니다." });
    }
    const filePath = await writeExcel(session.id);
    res.download(filePath, "livora-orders.xlsx");
  });

  router.get("/export/chats", auth.requireAuth, async (req, res) => {
    const live = collector.getUserSession(req.user.id);
    const latest = db.listLiveSessions(req.user.id)[0];
    const platform = live?.platform || latest?.platform || "";
    const channelId = live?.channelId || latest?.channel_id || "";
    const filePath = await writeUserDayChatExcel(req.user.id, { platform, channelId });
    res.download(filePath, path.basename(filePath));
  });

  router.get("/sessions/:id/export/invoices", auth.requireAuth, async (req, res) => {
    const session = db.getLiveSession(req.params.id);
    if (!session || (session.user_id !== req.user.id && req.user.role !== "admin")) {
      return res.status(404).json({ ok: false, message: "세션을 찾지 못했습니다." });
    }
    const live = collector.getSession(session.id);
    const orders = live
      ? live.engine.snapshot().orders
      : db.listOrders(session.id).map((o) => ({
          nickname: o.nick,
          product: o.product,
          option: o.option_name,
          qty: o.qty,
          price: o.price,
          amount: o.amount
        }));
    const { files } = await renderInvoices(session.id, orders);
    res.json({ ok: true, files: files.map((f) => path.basename(f)) });
  });

  router.get("/sessions/:id/shots/:file", auth.requireAuth, (req, res) => {
    const session = db.getLiveSession(req.params.id);
    if (!session || (session.user_id !== req.user.id && req.user.role !== "admin")) {
      return res.status(404).end();
    }
    const filePath = path.join(require("./config").shotsDir, session.id, path.basename(req.params.file));
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  });

  router.get("/sessions/:id/invoices/:file", auth.requireAuth, (req, res) => {
    const session = db.getLiveSession(req.params.id);
    if (!session || (session.user_id !== req.user.id && req.user.role !== "admin")) {
      return res.status(404).end();
    }
    const filePath = path.join(require("./config").invoicesDir, session.id, path.basename(req.params.file));
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  });

  return router;
}

module.exports = { createRouter };
