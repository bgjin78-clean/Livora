const path = require("path");
const axios = require("axios");
const config = require("../config");


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

function isYouTubeAddress(value) {
  const text = String(value || "").trim();
  return /https?:\/\//i.test(text) || /youtu\.be|youtube\.com/i.test(text) || /[?&]v=/.test(text);
}

function normalizeYouTubeChannel(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

function compactName(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

async function youtubeGet(url) {
  try {
    const res = await axios.get(url);
    return res.data;
  } catch (err) {
    throw new Error(youtubeApiError(err));
  }
}

async function optionalChannelId(params) {
  const query = new URLSearchParams({ part: "id", key: config.youtubeApiKey, ...params });
  try {
    const res = await axios.get(`https://www.googleapis.com/youtube/v3/channels?${query}`);
    return res.data.items?.[0]?.id || "";
  } catch (err) {
    if (err.response?.status === 400 || err.response?.status === 404) return "";
    throw new Error(youtubeApiError(err));
  }
}

async function findChannelId(input) {
  if (isYouTubeAddress(input)) {
    throw new Error("유튜브는 주소로 승인할 수 없습니다. 채널 아이디(UC...)나 닉네임을 넣으세요.");
  }
  const name = normalizeYouTubeChannel(input);
  if (!name) throw new Error("유튜브 채널 아이디나 닉네임을 입력하세요.");
  if (/^UC[\w-]{22}$/.test(name)) return name;

  const byHandle = await optionalChannelId({ forHandle: name });
  if (byHandle) return byHandle;
  const byUser = await optionalChannelId({ forUsername: name });
  if (byUser) return byUser;

  const found = await youtubeGet(
    "https://www.googleapis.com/youtube/v3/search" +
    `?part=snippet&type=channel&maxResults=5&q=${encodeURIComponent(name)}&key=${config.youtubeApiKey}`
  );
  const items = found.items || [];
  const wanted = compactName(name);
  const exact = items.find((item) => compactName(item.snippet?.channelTitle || item.snippet?.title) === wanted);
  const picked = exact || (items.length === 1 ? items[0] : null);
  const channelId = picked?.id?.channelId || picked?.snippet?.channelId || "";
  if (!channelId) {
    throw new Error("같은 닉네임의 유튜브 채널을 찾지 못했습니다. 채널 아이디(UC...)를 넣어 보세요.");
  }
  return channelId;
}

async function getVideoId(input) {
  if (!config.youtubeApiKey) throw new Error("YOUTUBE_API_KEY가 없습니다.");
  const channelId = await findChannelId(input);
  const found = await youtubeGet(
    "https://www.googleapis.com/youtube/v3/search" +
    `?part=snippet&type=video&eventType=live&maxResults=1&channelId=${encodeURIComponent(channelId)}` +
    `&key=${config.youtubeApiKey}`
  );
  return found.items?.[0]?.id?.videoId || null;
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
    throw new Error("진행 중인 유튜브 라이브를 찾지 못했습니다. 채널 아이디나 닉네임이 맞는지, 지금 라이브 중인지 확인하세요.");
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

module.exports = { startYouTube, isYouTubeAddress, normalizeYouTubeChannel };
