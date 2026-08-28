const crypto = require("crypto");
const db = require("../db");
const { OrderEngine } = require("../engine/OrderEngine");
const { composeRegistrationFields } = require("../engine/parse");
const { writeChatExcel } = require("../export/excel");
const { startTikTok } = require("./tiktok");
const { startYouTube } = require("./youtube");

const sessions = new Map();

function getUserSession(userId) {
  for (const session of sessions.values()) {
    if (session.userId === userId && session.status === "running") return session;
  }
  return null;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

async function startSession({ user, platform, channelId, broadcast }) {
  const approved = user.role === "admin"
    ? db.findApprovedChannelAny(platform, String(channelId).trim())
    : db.findApprovedChannel(user.id, platform, String(channelId).trim());
  if (!approved) {
    throw new Error("승인되지 않은 채널입니다. 관리자에게 채널 승인을 요청하세요.");
  }

  const existing = getUserSession(user.id);
  if (existing) {
    throw new Error("이미 수집 중인 방송이 있습니다. 먼저 종료하세요.");
  }

  const sessionId = crypto.randomUUID();
  const engine = new OrderEngine({
    sessionId,
    onEvent: (type, payload) => broadcast(sessionId, type, payload)
  });

  const session = {
    id: sessionId,
    userId: user.id,
    platform,
    channelId: approved.channel_id,
    status: "running",
    startedAt: new Date().toISOString(),
    error: "",
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

  const onChat = (chat) => engine.ingestChat(chat);
  const onStatus = (status, extra = {}) => {
    session.status = status === "error" ? "error" : session.status;
    if (extra.error) session.error = extra.error;
    broadcast(sessionId, "status", {
      status,
      platform,
      channelId: approved.channel_id,
      error: extra.error || ""
    });
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

async function stopSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.status = "stopped";
  try {
    if (session.stop) await session.stop();
  } catch {}
  try {
    await writeChatExcel(sessionId);
  } catch {}
  db.updateLiveSession(sessionId, {
    status: "stopped",
    stoppedAt: new Date().toISOString()
  });
  sessions.delete(sessionId);
  return { id: sessionId, status: "stopped" };
}

async function registerProduct(session, input) {
  const payload = typeof input === "string"
    ? String(input || "").trim()
    : composeRegistrationFields({
        ...(input || {}),
        fallbackProduct: session.engine.qtyMode.product
      }).payload;
  if (!payload) return { ok: true, skipped: true };
  return session.engine.registerProduct(input, "");
}

function removeProduct(session, input) {
  return session.engine.removeProduct(input);
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
    snapshot: session.engine.snapshot()
  };
}

module.exports = {
  getUserSession,
  getSession,
  startSession,
  stopSession,
  registerProduct,
  removeProduct,
  publicSession
};
