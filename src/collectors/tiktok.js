const tiktok = require("tiktok-live-connector");

function normalizeEvent(data) {
  const user = data.user || {};
  return {
    uid: String(data.uniqueId || user.uniqueId || user.userId || ""),
    nick: String(data.nickname || user.nickname || user.uniqueId || ""),
    msg: String(data.comment || "")
  };
}

function collectErrorText(err) {
  const parts = [];
  const seen = new Set();
  const walk = (value) => {
    if (!value || seen.has(value)) return;
    if (typeof value === "object") seen.add(value);
    if (typeof value === "string") {
      const text = value.trim();
      if (text && text !== "Error") parts.push(text);
      return;
    }
    if (value instanceof Error || value.message) walk(value.message);
    if (Array.isArray(value.errors)) value.errors.forEach(walk);
    if (value.cause) walk(value.cause);
  };
  walk(err);
  return [...new Set(parts)].join(" | ");
}

function tiktokConnectError(err) {
  const text = collectErrorText(err);
  if (/user_not_found/i.test(text)) return "틱톡 ID를 찾지 못했습니다. 아이디를 다시 확인하세요.";
  if (/offline|not.?live|user.?offline|room_not_found|ended/i.test(text)) {
    return "지금 틱톡 라이브 중이 아닙니다. 방송이 켜진 뒤에 수집을 시작하세요.";
  }
  const useful = text.split(" | ").find((part) => part && !/euler stream/i.test(part));
  return useful
    ? `틱톡 라이브에 연결하지 못했습니다. ${useful}`
    : "틱톡 라이브에 연결하지 못했습니다. 방송 중인지와 ID를 확인하세요.";
}

async function startTikTok({ username, onChat, onStatus }) {
  const Connection = tiktok.TikTokLiveConnection || tiktok.WebcastPushConnection;
  if (!Connection) throw new Error("틱톡 수집 라이브러리를 불러오지 못했습니다.");

  const uniqueId = String(username || "").trim().replace(/^@/, "");
  const connection = new Connection(uniqueId, { disableEulerFallbacks: true });
  let stopping = false;
  let reconnectTimer = null;

  const handleChat = (data) => {
    const chat = normalizeEvent(data);
    if (!chat.msg) return;
    onChat(chat);
  };

  if (tiktok.WebcastEvent?.CHAT) {
    connection.on(tiktok.WebcastEvent.CHAT, handleChat);
  } else {
    connection.on("chat", handleChat);
  }

  const reconnect = () => {
    if (stopping) return;
    onStatus("reconnecting");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(async () => {
      try {
        await connection.connect();
        onStatus("connected");
      } catch (err) {
        onStatus("error", { error: tiktokConnectError(err) });
        reconnect();
      }
    }, 3000);
  };

  connection.on("disconnected", reconnect);
  connection.on("streamEnd", () => {
    if (stopping) return;
    onStatus("ended");
  });

  try {
    await connection.connect();
  } catch (err) {
    throw new Error(tiktokConnectError(err));
  }

  return async () => {
    stopping = true;
    clearTimeout(reconnectTimer);
    try {
      await connection.disconnect();
    } catch {}
  };
}

module.exports = { startTikTok };
