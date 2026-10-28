const config = require("../config");

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
  if (/user offline/i.test(text)) {
    return "지금 틱톡 라이브 중이 아닙니다. 방송이 켜진 뒤에 수집을 시작하세요.";
  }
  if (/user_not_found|doesn't exist|does not exist/i.test(text) && !/SIGI_STATE|blocked by TikTok/i.test(text)) {
    return "틱톡 ID를 찾지 못했습니다. 아이디를 다시 확인하세요.";
  }
  if (/429|too many connections|rate.?limit/i.test(text)) {
    return "틱톡 접속이 잠시 몰렸습니다. 조금 뒤에 다시 수집을 시작하세요.";
  }
  if (/SIGI_STATE|blocked by TikTok/i.test(text)) {
    return "틱톡이 서버 접속을 막았습니다. 조금 뒤에 다시 수집을 시작하세요.";
  }
  if (/offline|not.?live|user.?offline|room_not_found|isn't online|is not online|ended/i.test(text)) {
    return "지금 틱톡 라이브 중이 아닙니다. 방송이 켜진 뒤에 수집을 시작하세요.";
  }
  return "틱톡 라이브에 연결하지 못했습니다. 방송 중인지와 ID를 확인하세요.";
}

function connectionOptions() {
  const options = {
    fetchRoomInfoOnConnect: false,
    enableExtendedGiftInfo: false
  };
  if (config.tiktokSignApiKey) options.signApiKey = config.tiktokSignApiKey;
  return options;
}

let tiktokLib;

async function loadTikTok() {
  if (!tiktokLib) tiktokLib = await import("tiktok-live-connector");
  return tiktokLib;
}

async function findLiveRoom(tiktok, connection, uniqueId) {
  const errors = [];
  try {
    const html = await tiktok.fetchRoomInfoFromHtmlRoute({
      webClient: connection.webClient,
      uniqueId
    });
    const roomId = html?.user?.roomId || html?.liveRoom?.roomId || "";
    if (roomId) return { roomId: String(roomId), status: html?.liveRoom?.status };
    errors.push(new Error("user_not_found"));
  } catch (err) {
    errors.push(err);
  }

  try {
    const api = await tiktok.fetchRoomInfoFromApiLiveRoute({
      webClient: connection.webClient,
      uniqueId
    });
    const roomId = api?.data?.user?.roomId || "";
    if (roomId) return { roomId: String(roomId), status: api?.data?.liveRoom?.status };
    errors.push(new Error("user_not_found"));
  } catch (err) {
    errors.push(err);
  }

  const failure = new Error(errors.map((err) => collectErrorText(err)).filter(Boolean).join(" | ") || "tiktok room lookup failed");
  failure.errors = errors;
  throw failure;
}

async function startTikTok({ username, onChat, onStatus }) {
  const tiktok = await loadTikTok();
  const Connection = tiktok.TikTokLiveConnection;
  if (!Connection || !tiktok.fetchRoomInfoFromHtmlRoute) {
    throw new Error("틱톡 수집 라이브러리를 불러오지 못했습니다.");
  }

  const uniqueId = String(username || "").trim().replace(/^@/, "");
  const connection = new Connection(uniqueId, connectionOptions());
  let stopping = false;
  let reconnectTimer = null;
  let offlineTries = 0;

  const handleChat = (data) => {
    const chat = normalizeEvent(data);
    if (!chat.msg) return;
    onChat(chat);
  };

  connection.on(tiktok.WebcastEvent?.CHAT || "chat", handleChat);

  const open = async () => {
    const room = await findLiveRoom(tiktok, connection, uniqueId);
    if (room.status === 4) throw new Error("user offline");
    await connection.connect(room.roomId);
  };

  const reconnect = () => {
    if (stopping) return;
    onStatus("reconnecting");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(async () => {
      try {
        await open();
        offlineTries = 0;
        onStatus("connected");
      } catch (err) {
        const message = tiktokConnectError(err);
        const offline = /라이브 중이 아닙니다|offline|ended|not live/i.test(`${message} ${collectErrorText(err)}`);
        offlineTries += offline ? 1 : 0;
        if (offline && offlineTries >= 2) {
          onStatus("ended", { error: "틱톡 방송 연결이 끊어져 주문·채팅·정산서를 저장합니다." });
          return;
        }
        onStatus("error", { error: message });
        reconnect();
      }
    }, 3000);
  };

  connection.on(tiktok.ControlEvent?.DISCONNECTED || "disconnected", reconnect);
  connection.on(tiktok.WebcastEvent?.STREAM_END || "streamEnd", () => {
    if (stopping) return;
    onStatus("ended", { error: "틱톡 방송이 종료되어 주문·채팅·정산서를 저장합니다." });
  });

  try {
    await open();
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
