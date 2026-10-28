const crypto = require("crypto");
const db = require("../db");
const { OrderEngine } = require("../engine/OrderEngine");
const { composeRegistrationFields } = require("../engine/parse");
const { writeChatExcel, writeExcel } = require("../export/excel");
const {
  canGrabDesktop,
  captureProductScreen,
  decodeImage,
  saveUploadedOrderShot,
  saveUploadedProductShot
} = require("../export/screenshot");
const { renderInvoices } = require("../export/images");
const { sendSessionMail } = require("../export/mail");
const { keepSessionFiles, saveToUserDesktop } = require("../export/keep");
const { excelFileName } = require("../export/fileName");
const { archiveSellerFile } = require("../export/archive");
const path = require("path");
const { startTikTok } = require("./tiktok");
const { startYouTube } = require("./youtube");

const sessions = new Map();

function getUserSessions(userId) {
  return [...sessions.values()].filter((session) => session.userId === userId && session.status === "running");
}

function getUserSession(userId, platform) {
  const list = getUserSessions(userId);
  if (platform) return list.find((session) => session.platform === platform) || null;
  return list[0] || null;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function withSessionMeta(session, payload = {}) {
  return {
    ...payload,
    sessionId: session.id,
    platform: session.platform,
    channelId: session.channelId
  };
}

async function startSession({ user, platform, channelId, broadcast, screenCapture = true }) {
  const approved = user.role === "admin"
    ? db.findApprovedChannelAny(platform, String(channelId).trim())
    : db.findApprovedChannel(user.id, platform, String(channelId).trim());
  if (!approved) {
    throw new Error("승인되지 않은 채널입니다. 관리자에게 채널 승인을 요청하세요.");
  }

  const existing = getUserSession(user.id, platform);
  if (existing) {
    throw new Error(`${platform === "youtube" ? "유튜브" : "틱톡"}은 이미 수집 중입니다. 먼저 종료하세요.`);
  }

  const sessionId = crypto.randomUUID();
  const engine = new OrderEngine({
    sessionId,
    onEvent: (type, payload) => {
      broadcast(sessionId, type, withSessionMeta(session, payload));
    }
  });

  const session = {
    id: sessionId,
    userId: user.id,
    platform,
    channelId: approved.channel_id,
    status: "running",
    startedAt: new Date().toISOString(),
    error: "",
    screenCapture: user.role !== "admin",
    shotErrorSent: false,
    pendingShotFile: "",
    engine,
    stop: null
  };

  sessions.set(sessionId, session);
  db.createLiveSession({
    id: sessionId,
    userId: user.id,
    platform,
    channelId: approved.channel_id
  });

  session.notify = broadcast;
  const onChat = (chat) => engine.ingestChat(chat);
  const onStatus = (status, extra = {}) => {
    if (status === "connected") session.error = "";
    if (extra.error) session.error = extra.error;
    broadcast(sessionId, "status", withSessionMeta(session, {
      status,
      error: extra.error || session.error || ""
    }));
    if (status === "ended" && !session.finishing) finishLive(sessionId, extra.error || "ended");
  };

  try {
    if (platform === "tiktok") {
      session.stop = await startTikTok({
        username: approved.channel_id,
        onChat,
        onStatus
      });
    } else if (platform === "youtube") {
      session.stop = await startYouTube({
        input: approved.channel_id,
        onChat,
        onStatus
      });
    } else {
      throw new Error("지원하지 않는 플랫폼입니다.");
    }
  } catch (err) {
    const message = String(err?.message || "").trim() || "수집을 시작하지 못했습니다. 라이브 중인지와 ID를 확인하세요.";
    session.status = "error";
    session.error = message;
    db.updateLiveSession(sessionId, { status: "error", error: message, stoppedAt: new Date().toISOString() });
    sessions.delete(sessionId);
    throw new Error(message);
  }

  onStatus("connected");
  return publicSession(session);
}

function invoiceOrdersFromEngine(session) {
  return session.engine.snapshot().orders.filter((o) => o.stockStatus !== "shortage").map((o) => ({
    nickname: o.nickname,
    product: o.product,
    option: o.option,
    color: o.color,
    size: o.size,
    qty: o.qty,
    price: o.price,
    amount: o.amount,
    time: o.time
  }));
}

async function finishSessionFiles(session) {
  const seller = db.getUserById(session.userId);
  const files = [];
  try {
    const excelPath = await writeExcel(session.id);
    const filename = excelFileName({ seller, kind: "orders" });
    files.push({ filename, path: excelPath });
    archiveSellerFile({
      seller,
      session,
      kind: "orders",
      sourcePath: excelPath,
      filename,
      source: "stop"
    });
  } catch (err) {
    console.error("[stop excel]", err.message);
  }
  try {
    const chatPath = await writeChatExcel(session.id);
    const filename = excelFileName({ seller, kind: "chats" });
    files.push({ filename, path: chatPath });
    archiveSellerFile({
      seller,
      session,
      kind: "chats",
      sourcePath: chatPath,
      filename,
      source: "stop"
    });
  } catch (err) {
    console.error("[stop chat excel]", err.message);
  }
  try {
    const { files: invoices } = await renderInvoices(session.id, invoiceOrdersFromEngine(session));
    for (const filePath of invoices || []) {
      const filename = path.basename(filePath);
      files.push({ filename, path: filePath });
      archiveSellerFile({
        seller,
        session,
        kind: "invoices",
        sourcePath: filePath,
        filename,
        source: "stop"
      });
    }
  } catch (err) {
    console.error("[stop invoices]", err.message);
  }
  const kept = keepSessionFiles(session.id, files);
  let desktop = { ok: false, skipped: true, reason: "no-desktop" };
  try {
    desktop = saveToUserDesktop(seller?.username, files);
  } catch (err) {
    console.error("[desktop]", err.message);
    desktop = { ok: false, error: err.message };
  }
  let mail = { ok: false, skipped: true };
  try {
    mail = await sendSessionMail({
      seller,
      platform: session.platform,
      channelId: session.channelId,
      files
    });
  } catch (err) {
    console.error("[stop mail]", err.message);
    mail = { ok: false, error: err.message };
  }
  return {
    files: kept,
    mail,
    desktop
  };
}

const finishing = new Map();

function finishLive(sessionId, reason = "ended") {
  if (finishing.has(sessionId)) return finishing.get(sessionId);
  const job = finishLiveNow(sessionId, reason).finally(() => finishing.delete(sessionId));
  finishing.set(sessionId, job);
  return job;
}

async function finishLiveNow(sessionId, reason) {
  const session = sessions.get(sessionId);
  if (!session || session.finishing) return null;
  session.finishing = true;
  session.status = "stopped";
  try {
    if (session.stop) await session.stop();
  } catch {}
  const wrap = await finishSessionFiles(session);
  db.updateLiveSession(sessionId, {
    status: "stopped",
    stoppedAt: new Date().toISOString(),
    error: reason && reason !== "ended" ? String(reason) : ""
  });
  const result = { id: sessionId, status: "stopped", reason, platform: session.platform, ...wrap };
  if (session.notify) {
    session.notify(sessionId, "session-closed", withSessionMeta(session, result));
  }
  sessions.delete(sessionId);
  return result;
}

async function stopSession(sessionId) {
  return finishLive(sessionId, "stopped");
}

function saveClientOrderShot(session, payload, image) {
  if (!session.screenCapture) {
    throw new Error("화면캡처가 꺼져 있습니다.");
  }
  const buffer = decodeImage(image);
  const seller = db.getUserById(session.userId);
  const fileName = saveUploadedOrderShot({
    engine: session.engine,
    seller,
    payload,
    buffer
  });
  return withSessionMeta(session, {
    uid: payload.uid,
    product: payload.product,
    option: payload.option,
    message: payload.message,
    nickname: payload.nickname,
    shotFile: fileName
  });
}

function saveClientProductShot(session, productName = "F2", image) {
  const buffer = decodeImage(image);
  const seller = db.getUserById(session.userId);
  const shotFile = saveUploadedProductShot({
    sessionId: session.id,
    seller,
    productName,
    buffer
  });
  return { ok: true, shotFile };
}

async function capturePendingProductShot(session, productName = "F2", image, attachCurrent = false) {
  let saved;
  if (image) saved = saveClientProductShot(session, productName, image);
  else if (!canGrabDesktop()) {
    return { ok: false, message: "화면 공유를 허용한 뒤 수동 캡처를 다시 누르세요. 웹 서버는 판매자 PC를 직접 찍을 수 없습니다." };
  } else {
    const seller = db.getUserById(session.userId);
    const shotFile = await captureProductScreen({
      sessionId: session.id,
      seller,
      productName
    });
    saved = { ok: true, shotFile };
  }
  if (!saved.ok) return saved;
  if (attachCurrent && session.engine.qtyMode.product) {
    const attached = session.engine.attachShot(saved.shotFile);
    session.pendingShotFile = "";
    return { ...saved, ...attached, attached: true };
  }
  session.pendingShotFile = saved.shotFile;
  return { ...saved, attached: false };
}

async function registerProduct(session, input, image) {
  const payload = typeof input === "string"
    ? String(input || "").trim()
    : composeRegistrationFields({
        ...(input || {}),
        fallbackProduct: session.engine.qtyMode.product
      }).payload;
  if (!payload) return { ok: true, skipped: true };
  let shotPath = session.pendingShotFile || "";
  session.pendingShotFile = "";
  const productName = typeof input === "string"
    ? "F2"
    : (input.name || input.number || session.engine.qtyMode.product || "F2");
  if (!shotPath && image) {
    try {
      const saved = saveClientProductShot(session, productName, image);
      shotPath = saved.shotFile || "";
    } catch (err) {
      console.error("[product shot upload]", err.message);
    }
  }
  if (!shotPath && canGrabDesktop()) {
    try {
      const seller = db.getUserById(session.userId);
      shotPath = await captureProductScreen({
        sessionId: session.id,
        seller,
        productName
      });
    } catch (err) {
      console.error("[product shot]", err.message);
    }
  }
  try {
    return session.engine.registerProduct(input, shotPath);
  } catch (err) {
    console.error("[register product]", err.message);
    return { ok: false, message: String(err.message || "").trim() || "상품을 등록하지 못했습니다." };
  }
}

function removeProduct(session, input) {
  return session.engine.removeProduct(input);
}

function resetProducts(session) {
  return session.engine.resetProducts();
}

function clearOrders(session) {
  return session.engine.clearOrders();
}

function clearChats(session) {
  return session.engine.clearChats();
}

function publicSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    platform: session.platform,
    channelId: session.channelId,
    status: session.status,
    startedAt: session.startedAt,
    error: session.error,
    screenCapture: session.screenCapture !== false,
    snapshot: session.engine.snapshot()
  };
}

function runningCollectionCounts() {
  let tiktok = 0;
  let youtube = 0;
  for (const session of sessions.values()) {
    if (session.status !== "running") continue;
    if (session.platform === "tiktok") tiktok += 1;
    else if (session.platform === "youtube") youtube += 1;
  }
  return { tiktok, youtube };
}

async function stopUserSessions(userId, platform) {
  const targets = platform
    ? [getUserSession(userId, platform)].filter(Boolean)
    : getUserSessions(userId);
  const stopped = [];
  for (const session of targets) {
    stopped.push(await stopSession(session.id));
  }
  return stopped;
}

function publicSessions(userId) {
  return getUserSessions(userId).map(publicSession);
}

module.exports = {
  getUserSession,
  getUserSessions,
  getSession,
  startSession,
  stopSession,
  stopUserSessions,
  registerProduct,
  capturePendingProductShot,
  saveClientOrderShot,
  saveClientProductShot,
  removeProduct,
  resetProducts,
  clearOrders,
  clearChats,
  publicSession,
  publicSessions,
  runningCollectionCounts
};
