const axios = require("axios");
const config = require("../config");
const { normalizeText } = require("../engine/parse");

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
  const res = await axios.get(url);
  return res.data.items?.[0]?.id?.videoId || null;
}

async function getLiveChatId(videoId) {
  const url =
    "https://www.googleapis.com/youtube/v3/videos" +
    `?part=liveStreamingDetails&id=${videoId}&key=${config.youtubeApiKey}`;
  const res = await axios.get(url);
  return res.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId || null;
}

async function startYouTube({ input, onChat, onStatus }) {
  if (!config.youtubeApiKey) {
    throw new Error("유튜브 API 키가 없어 수집을 시작할 수 없습니다.");
  }

  const videoId = await getVideoId(input);
  if (!videoId) throw new Error("진행 중인 유튜브 라이브를 찾지 못했습니다.");
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
      onStatus("error", { error: err.response?.data?.error?.message || err.message });
      timer = setTimeout(loop, 5000);
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
