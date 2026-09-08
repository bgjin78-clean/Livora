const axios = require("axios");
const config = require("../config");
const { normalizeText } = require("../engine/parse");

function stripHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function youtubeApiError(err) {
  const raw = stripHtml(err.response?.data?.error?.message || err.message || "");
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
  const raw = String(err.response?.data?.error?.message || err.message || "");
  const reason = err.response?.data?.error?.errors?.[0]?.reason || "";
  return /quota/i.test(raw) || /quotaExceeded/i.test(reason);
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
  let nextPageToken = "";
  let timer = null;

  const loop = async () => {
    if (stopping) return;
    try {
      const url =
        "https://www.googleapis.com/youtube/v3/liveChat/messages" +
        `?liveChatId=${chatId}&part=snippet,authorDetails&key=${config.youtubeApiKey}` +
        `&pageToken=${nextPageToken}`;
      const res = await axios.get(url);
      nextPageToken = res.data.nextPageToken || "";
      for (const item of res.data.items || []) {
        const msg = item.snippet?.displayMessage || "";
        if (!msg) continue;
        onChat({
          uid: item.authorDetails?.channelId || "",
          nick: item.authorDetails?.displayName || "",
          msg
        });
      }
      const wait = res.data.pollingIntervalMillis || 3000;
      timer = setTimeout(loop, wait);
    } catch (err) {
      onStatus("error", { error: youtubeApiError(err) });
      if (isQuotaError(err)) return;
      timer = setTimeout(loop, 60000);
    }
  };

  loop();
  onStatus("connected", { videoId });

  return async () => {
    stopping = true;
    clearTimeout(timer);
  };
}

module.exports = { startYouTube };
