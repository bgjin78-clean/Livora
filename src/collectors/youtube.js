const path = require("path");
const axios = require("axios");
const config = require("../config");
const { normalizeText } = require("../engine/parse");

let grpc = null;
let liveChatStreamClient = null;
try {
  grpc = require("@grpc/grpc-js");
  const protoLoader = require("@grpc/proto-loader");
  const definition = protoLoader.loadSync(path.join(__dirname, "stream_list.proto"), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true
  });
  const youtubeStreamProto = grpc.loadPackageDefinition(definition).youtube.api.v3;
  liveChatStreamClient = new youtubeStreamProto.V3DataLiveChatMessageService(
    "youtube.googleapis.com:443",
    grpc.credentials.createSsl()
  );
} catch (err) {
  console.error("[youtube grpc]", err.message);
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function youtubeApiError(err) {
  const raw = stripHtml(err.response?.data?.error?.message || err.message || err.details || "");
  const reason = err.response?.data?.error?.errors?.[0]?.reason || "";
  if (/quota/i.test(raw) || /quotaExceeded/i.test(reason)) {
    return "유튜브 오늘 이용량이 끝났습니다. 내일 다시 시도하거나, 그동안은 틱톡으로 수집하세요.";
  }
  if (/keyInvalid|API key not valid/i.test(raw + reason)) {
    return "유튜브 연결 키가 올바르지 않습니다. 관리자에게 알려주세요.";
  }
  return raw ? `유튜브 연결에 실패했습니다. ${raw}` : "유튜브 라이브에 연결하지 못했습니다.";
}

function isQuotaError(err) {
  const raw = String(err.response?.data?.error?.message || err.message || err.details || "");
  const reason = err.response?.data?.error?.errors?.[0]?.reason || "";
  return /quota/i.test(raw) || /quotaExceeded/i.test(reason);
}

function isFatalGrpc(err) {
  if (!grpc || err?.code == null) return false;
  return [
    grpc.status.INVALID_ARGUMENT,
    grpc.status.PERMISSION_DENIED,
    grpc.status.NOT_FOUND,
    grpc.status.FAILED_PRECONDITION
  ].includes(err.code);
}

async function getVideoId(input) {
  const text = normalizeText(input);
  let m = text.match(/[?&]v=([^&]+)/);
  if (m) return m[1];
  m = text.match(/youtu\.be\/([^?&/]+)/);
  if (m) return m[1];
  m = text.match(/youtube\.com\/live\/([^?&/]+)/);
  if (m) return m[1];
  if (!config.youtubeApiKey) throw new Error("YOUTUBE_API_KEY가 없습니다.");

  const url =
    "https://www.googleapis.com/youtube/v3/search" +
    `?part=snippet&type=video&eventType=live&q=${encodeURIComponent(text)}` +
    `&key=${config.youtubeApiKey}`;
  try {
    const res = await axios.get(url);
    return res.data.items?.[0]?.id?.videoId || null;
  } catch (err) {
    throw new Error(youtubeApiError(err));
  }
}

async function getLiveChatId(videoId) {
  const url =
    "https://www.googleapis.com/youtube/v3/videos" +
    `?part=liveStreamingDetails&id=${videoId}&key=${config.youtubeApiKey}`;
  try {
    const res = await axios.get(url);
    return res.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId || null;
  } catch (err) {
    throw new Error(youtubeApiError(err));
  }
}

function emitItem(item, onChat, startedAt) {
  const snippet = item.snippet || {};
  const author = item.authorDetails || item.author_details || {};
  const msg = snippet.displayMessage || snippet.display_message || "";
  if (!msg) return;
  const published = Date.parse(snippet.publishedAt || snippet.published_at || "");
  const timeMs = Number.isFinite(published) ? published : Date.now();
  if (timeMs < startedAt) return;
  onChat({
    uid: author.channelId || author.channel_id || "",
    nick: author.displayName || author.display_name || "",
    msg
  });
}

function startRestLoop({ chatId, onChat, onStatus, startedAt, getStopping }) {
  let nextPageToken = "";
  let timer = null;
  const loop = async () => {
    if (getStopping()) return;
    try {
      const url =
        "https://www.googleapis.com/youtube/v3/liveChat/messages" +
        `?liveChatId=${chatId}&part=snippet,authorDetails&key=${config.youtubeApiKey}` +
        `&pageToken=${nextPageToken}`;
      const res = await axios.get(url);
      nextPageToken = res.data.nextPageToken || "";
      for (const item of res.data.items || []) emitItem(item, onChat, startedAt);
      timer = setTimeout(loop, res.data.pollingIntervalMillis || 3000);
    } catch (err) {
      onStatus("error", { error: youtubeApiError(err) });
      if (isQuotaError(err)) return;
      timer = setTimeout(loop, 60000);
    }
  };
  loop();
  return () => clearTimeout(timer);
}

function openLiveChatStream({ chatId, pageToken, onChat, startedAt, getStopping, setCall }) {
  return new Promise((resolve, reject) => {
    const metadata = new grpc.Metadata();
    metadata.set("x-goog-api-key", config.youtubeApiKey);
    const request = {
      live_chat_id: chatId,
      part: ["snippet", "authorDetails"]
    };
    if (pageToken) request.page_token = pageToken;

    const call = liveChatStreamClient.streamList(request, metadata);
    if (setCall) setCall(call);
    let settled = false;
    let queue = Promise.resolve();
    let nextToken = pageToken || "";

    const done = (err) => {
      if (settled) return;
      settled = true;
      if (setCall) setCall(null);
      try { call.cancel(); } catch {}
      queue.catch(() => {}).finally(() => (err ? reject(err) : resolve(nextToken)));
    };

    call.on("data", (response) => {
      if (response?.next_page_token) nextToken = response.next_page_token;
      queue = queue.then(() => {
        if (getStopping()) return;
        for (const item of response?.items || []) emitItem(item, onChat, startedAt);
      }).catch((err) => console.error("[youtube stream]", err.message));
    });
    call.on("error", (err) => {
      if (getStopping() && err?.code === grpc.status.CANCELLED) return done();
      done(err);
    });
    call.on("end", () => done());
  });
}

function startGrpcLoop({ chatId, onChat, onStatus, startedAt, getStopping, onFallback }) {
  let pageToken = "";
  let active = true;
  let currentCall = null;
  const run = async () => {
    while (active && !getStopping()) {
      try {
        pageToken = await openLiveChatStream({
          chatId,
          pageToken,
          onChat,
          startedAt,
          getStopping,
          setCall: (call) => { currentCall = call; }
        });
        if (getStopping() || !active) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        if (getStopping() || !active) return;
        if (isQuotaError(err) || err?.code === grpc.status.UNIMPLEMENTED) {
          onStatus("error", { error: youtubeApiError(err) });
          if (onFallback) onFallback();
          return;
        }
        if (isFatalGrpc(err)) {
          onStatus("ended", { error: youtubeApiError(err) });
          return;
        }
        console.error("[youtube grpc reconnect]", err.details || err.message);
        onStatus("reconnecting");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  };
  run();
  return () => {
    active = false;
    try { currentCall?.cancel(); } catch {}
  };
}

async function startYouTube({ input, onChat, onStatus }) {
  if (!config.youtubeApiKey) {
    throw new Error("유튜브 API 키가 없어 수집을 시작할 수 없습니다.");
  }

  const videoId = await getVideoId(input);
  if (!videoId) {
    throw new Error("진행 중인 유튜브 라이브를 찾지 못했습니다. 라이브 주소(youtube.com/watch?v=...)를 채널에 넣어 보세요.");
  }
  const chatId = await getLiveChatId(videoId);
  if (!chatId) throw new Error("유튜브 라이브 채팅에 연결하지 못했습니다.");

  let stopping = false;
  const startedAt = Date.now() - 2000;
  let stopRest = null;
  let stopGrpc = null;

  const startRest = () => {
    if (stopRest) return;
    stopRest = startRestLoop({
      chatId,
      onChat,
      onStatus,
      startedAt,
      getStopping: () => stopping
    });
  };

  if (liveChatStreamClient) {
    stopGrpc = startGrpcLoop({
      chatId,
      onChat,
      onStatus,
      startedAt,
      getStopping: () => stopping,
      onFallback: startRest
    });
  } else {
    startRest();
  }

  onStatus("connected", { videoId, mode: liveChatStreamClient ? "grpc" : "rest" });

  return async () => {
    stopping = true;
    if (stopGrpc) stopGrpc();
    if (stopRest) stopRest();
  };
}

module.exports = { startYouTube };
