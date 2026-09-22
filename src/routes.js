const fs = require("fs");
const path = require("path");
const express = require("express");
const db = require("./db");
const auth = require("./auth");
const collector = require("./collectors/manager");
const realtime = require("./realtime");
const { writeExcel, writeChatExcel, writeUserDayChatExcel } = require("./export/excel");
const { renderInvoices } = require("./export/images");
const { listShotFiles } = require("./export/screenshot");
const { excelFileName } = require("./export/fileName");
const { archiveSellerFile } = require("./export/archive");
const config = require("./config");

function createRouter(broadcast) {
  const router = express.Router();

  function lastSessionFor(userId, platform) {
    const rows = db.listLiveSessions(userId);
    const row = platform ? rows.find((item) => item.platform === platform) : rows[0];
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

  function requestPlatform(req) {
    return String(req.body?.platform || req.query?.platform || "").trim();
  }

  function liveFor(req) {
    return collector.getUserSession(req.user.id, requestPlatform(req) || undefined);
  }

  function clientIp(req) {
    return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  }

  function writeLog(req, action, detail = "") {
    try {
      db.insertLog({
        user_id: req.user?.id || null,
        username: req.user?.username || req.body?.username || "",
        action,
        detail,
        ip: clientIp(req)
      });
    } catch (err) {
      console.error("[log]", err.message);
    }
  }

  router.post("/login", (req, res) => {
    const remember = Boolean(req.body?.remember);
    const result = auth.login(req.body?.username, req.body?.password, remember);
    if (!result.ok) {
      writeLog(req, "LOGIN_FAIL", result.message);
      return res.status(401).json(result);
    }
    auth.setAuthCookie(res, result.token, remember);
    req.user = auth.publicUser(result.user);
    writeLog(req, "LOGIN_SUCCESS", remember ? "로그인 유지" : "");
    res.json({ ok: true, user: req.user });
  });

  router.post("/logout", (req, res) => {
    auth.clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get("/me", auth.requireAuth, (req, res) => {
    const sessions = collector.publicSessions(req.user.id);
    const current = sessions[0] || null;
    res.json({
      ok: true,
      user: req.user,
      channels: req.user.role === "admin" ? db.listChannels() : db.listChannels(req.user.id),
      sessions,
      session: current,
      lastSession: current || lastSessionFor(req.user.id)
    });
  });

  router.get("/admin/overview", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const collecting = collector.runningCollectionCounts();
    res.json({
      ok: true,
      sellers: db.listUsers().filter((user) => user.role === "seller").length,
      online: realtime.countOnlineSellers(),
      tiktok: collecting.tiktok,
      youtube: collecting.youtube
    });
  });

  router.get("/admin/users", auth.requireAuth, auth.requireAdmin, (req, res) => {
    res.json({ ok: true, users: db.listUsers() });
  });

  router.post("/admin/users", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const { username, password, name, role, expireDate, status, license, mailTo } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, message: "아이디와 비밀번호가 필요합니다." });
    }
    try {
      const user = db.createUser({ username, password, name, role, expireDate, status, license, mailTo });
      writeLog(req, "USER_CREATE", username);
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
    await collector.stopUserSessions(id);
    const result = db.deleteUser(id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ ok: true });
  });

  router.get("/admin/accounts.csv", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const rows = [
      ["아이디", "이름", "역할", "상태", "만료일", "라이선스", "메일"],
      ...db.listUsers().map((user) => [
        user.username,
        user.name,
        user.role,
        user.status,
        user.expire_date || "",
        user.license || "PRO",
        user.mail_to || ""
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
      orders: session ? db.listOrders(session.id).map(({ shot_path, ...order }) => order) : [],
      chats: session ? db.listChats(session.id, 80) : []
    });
  });

  router.get("/admin/users/:id/export/chats", auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const user = db.getUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ ok: false, message: "사용자를 찾지 못했습니다." });
    const filePath = await writeUserDayChatExcel(user.id);
    res.download(filePath, excelFileName({ seller: user, kind: "chats" }));
  });

  router.get("/admin/logs", auth.requireAuth, auth.requireAdmin, (req, res) => {
    res.json({ ok: true, logs: db.listLogs(200) });
  });

  router.get("/admin/files", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const userId = Number(req.query.userId || 0);
    res.json({
      ok: true,
      files: db.listAdminFiles({ userId: userId || undefined, limit: 300 })
    });
  });

  router.get("/admin/files/:id", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const row = db.getAdminFile(Number(req.params.id));
    if (!row) return res.status(404).json({ ok: false, message: "파일을 찾지 못했습니다." });
    const filePath = path.join(config.adminCopiesDir, path.basename(row.stored_name));
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, message: "파일이 없습니다." });
    res.download(filePath, row.filename || row.stored_name);
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
        screenCapture: req.user.role !== "admin" && req.body?.screenCapture !== false,
        broadcast: (sessionId, type, payload) => {
          const live = collector.getSession(sessionId);
          if (live) broadcast(live.userId, type, payload);
        }
      });
      writeLog(req, "SESSION_START", `${req.body?.platform || ""} ${req.body?.channelId || ""}`);
      res.json({ ok: true, session, sessions: collector.publicSessions(req.user.id) });
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  router.post("/sessions/stop", auth.requireAuth, async (req, res) => {
    const platform = requestPlatform(req);
    const stopped = await collector.stopUserSessions(req.user.id, platform || undefined);
    writeLog(req, "SESSION_STOP", platform || stopped.map((row) => row?.id).join(","));
    const remaining = collector.publicSessions(req.user.id);
    const lastSession = remaining[0] || lastSessionFor(req.user.id, platform || undefined);
    res.json({ ok: true, sessions: remaining, session: remaining[0] || lastSession, lastSession });
  });

  router.post("/sessions/products", auth.requireAuth, async (req, res) => {
    const live = liveFor(req);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    try {
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
    } catch (err) {
      console.error("[register product]", err.message);
      res.status(400).json({ ok: false, message: String(err.message || "").trim() || "상품을 등록하지 못했습니다." });
    }
  });

  router.post("/sessions/product-shot", auth.requireAuth, async (req, res) => {
    const live = liveFor(req);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    try {
      const result = await collector.capturePendingProductShot(live, req.body?.name || "F2");
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message || "상품 화면을 찍지 못했습니다." });
    }
  });

  router.post("/sessions/products/remove", auth.requireAuth, (req, res) => {
    const live = liveFor(req);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    const result = collector.removeProduct(live, req.body || {});
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  router.post("/sessions/products/reset", auth.requireAuth, (req, res) => {
    const live = liveFor(req);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    res.json(collector.resetProducts(live));
  });

  router.post("/sessions/orders/clear", auth.requireAuth, (req, res) => {
    const live = liveFor(req);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    res.json(collector.clearOrders(live));
  });

  router.post("/sessions/chats/clear", auth.requireAuth, (req, res) => {
    const live = liveFor(req);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    res.json(collector.clearChats(live));
  });

  router.get("/sessions/summary", auth.requireAuth, (req, res) => {
    const live = liveFor(req);
    const lastSession = collector.publicSession(live) || lastSessionFor(req.user.id, requestPlatform(req) || undefined);
    const sessionId = live?.id || lastSession?.id;
    const orders = sessionId ? db.listOrders(sessionId) : [];
    const totalQty = orders.reduce((sum, o) => sum + Number(o.qty || 0), 0);
    const totalAmount = orders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
    const buyers = new Set(orders.map((o) => o.uid || o.nick)).size;
    const products = {};
    const people = {};
    for (const o of orders) {
      const option = [o.size, o.color, o.option_name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" / ");
      const pKey = [o.product || "", option, Number(o.price || 0)].join("||");
      if (!products[pKey]) products[pKey] = { product: o.product, option, qty: 0, amount: 0 };
      products[pKey].qty += Number(o.qty || 0);
      products[pKey].amount += Number(o.amount || 0);
      const nick = o.nick || o.uid || "-";
      if (!people[nick]) people[nick] = { nickname: nick, items: [], qty: 0, amount: 0 };
      people[nick].items.push({ product: o.product, option, qty: o.qty, amount: o.amount });
      people[nick].qty += Number(o.qty || 0);
      people[nick].amount += Number(o.amount || 0);
    }
    res.json({
      ok: true,
      all: { buyers, orderCount: orders.length, qty: totalQty, amount: totalAmount },
      products: Object.values(products).sort((a, b) => String(a.product).localeCompare(String(b.product), "ko")),
      buyers: Object.values(people).sort((a, b) => String(a.nickname).localeCompare(String(b.nickname), "ko"))
    });
  });

  router.post("/sessions/qty-mode", auth.requireAuth, (req, res) => {
    const live = liveFor(req);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    res.json(live.engine.toggleQtyMode());
  });

  router.post("/sessions/screen-capture", auth.requireAuth, (req, res) => {
    const live = liveFor(req);
    if (!live) return res.status(400).json({ ok: false, message: "먼저 수집을 시작하세요." });
    if (req.user.role === "admin") {
      live.screenCapture = false;
      return res.json({ ok: true, enabled: false });
    }
    live.screenCapture = req.body?.enabled !== false;
    res.json({ ok: true, enabled: live.screenCapture });
  });

  router.get("/sessions/current", auth.requireAuth, (req, res) => {
    const lives = collector.getUserSessions(req.user.id);
    const platform = requestPlatform(req);
    const live = platform ? collector.getUserSession(req.user.id, platform) : lives[0] || null;
    const lastSession = collector.publicSession(live) || lastSessionFor(req.user.id, platform || undefined);
    const chats = [];
    const orders = [];
    const reviews = [];
    for (const item of lives.length ? lives : []) {
      chats.push(...db.listChats(item.id, 120).map((row) => ({ ...row, platform: item.platform, sessionId: item.id })));
      orders.push(...db.listOrders(item.id).map((row) => ({ ...row, platform: item.platform, sessionId: item.id })));
      reviews.push(...(item.engine.reviews || []).map((row) => ({ ...row, platform: item.platform, sessionId: item.id })));
    }
    if (!lives.length && lastSession?.id) {
      chats.push(...db.listChats(lastSession.id, 120).map((row) => ({ ...row, platform: lastSession.platform, sessionId: lastSession.id })));
      orders.push(...db.listOrders(lastSession.id).map((row) => ({ ...row, platform: lastSession.platform, sessionId: lastSession.id })));
    }
    chats.sort((a, b) => Number(a.created_ms || 0) - Number(b.created_ms || 0));
    res.json({
      ok: true,
      sessions: collector.publicSessions(req.user.id),
      session: collector.publicSession(live),
      lastSession,
      chats,
      orders,
      products: live ? db.listProducts(live.id) : (lastSession?.id ? db.listProducts(lastSession.id) : []),
      reviews: live ? reviews.filter((row) => row.sessionId === live.id) : reviews
    });
  });

  router.get("/sessions/:id/export/excel", auth.requireAuth, async (req, res) => {
    const session = db.getLiveSession(req.params.id);
    if (!session || (session.user_id !== req.user.id && req.user.role !== "admin")) {
      return res.status(404).json({ ok: false, message: "세션을 찾지 못했습니다." });
    }
    const filePath = await writeExcel(session.id);
    const owner = db.getUserById(session.user_id);
    const filename = excelFileName({ seller: owner, kind: "orders" });
    if (req.user.role !== "admin") {
      archiveSellerFile({
        seller: owner,
        session,
        kind: "orders",
        sourcePath: filePath,
        filename,
        source: "download"
      });
    }
    res.download(filePath, filename);
  });

  router.get("/export/chats", auth.requireAuth, async (req, res) => {
    const live = liveFor(req);
    const latest = db.listLiveSessions(req.user.id)[0];
    const platform = live?.platform || latest?.platform || "";
    const channelId = live?.channelId || latest?.channel_id || "";
    const filePath = await writeUserDayChatExcel(req.user.id, { platform, channelId });
    const filename = excelFileName({ seller: req.user, kind: "chats" });
    if (req.user.role !== "admin") {
      archiveSellerFile({
        seller: req.user,
        session: live || latest || {},
        kind: "chats",
        sourcePath: filePath,
        filename,
        source: "download"
      });
    }
    res.download(filePath, filename);
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
    if (req.user.role !== "admin") {
      const owner = db.getUserById(session.user_id);
      for (const filePath of files || []) {
        archiveSellerFile({
          seller: owner,
          session,
          kind: "invoices",
          sourcePath: filePath,
          filename: path.basename(filePath),
          source: "download"
        });
      }
    }
    res.json({ ok: true, files: files.map((f) => path.basename(f)) });
  });

  router.get("/sessions/:id/shots", auth.requireAuth, (req, res) => {
    const session = db.getLiveSession(req.params.id);
    if (!session || session.user_id !== req.user.id) {
      return res.status(404).json({ ok: false, message: "세션을 찾지 못했습니다." });
    }
    res.json({ ok: true, files: listShotFiles(session.id) });
  });

  router.get("/sessions/:id/shots/:file", auth.requireAuth, (req, res) => {
    const session = db.getLiveSession(req.params.id);
    if (!session || session.user_id !== req.user.id) {
      return res.status(404).end();
    }
    const filePath = path.join(config.shotsDir, session.id, path.basename(req.params.file));
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`);
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
