const DESK_PLATFORMS = ["tiktok", "youtube"];

const state = {
  user: null,
  session: null,
  sessions: [],
  channels: [],
  chats: [],
  orders: [],
  productsByPlatform: { tiktok: [], youtube: [] },
  qtyByPlatform: { tiktok: null, youtube: null },
  reviews: [],
  outputs: [],
  mailReady: false,
  guessOnly: false,
  editingUserId: null,
  adminUsers: [],
  lastSession: null,
  lastByPlatform: { tiktok: null, youtube: null },
  activePlatform: "tiktok",
  adminStatsTimer: null,
  screenCapture: true,
  labelPrint: localStorage.getItem("livoraLabelPrint") === "1"
};

const labelQueue = [];
let labelPrinting = false;

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.headers.get("content-type")?.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) throw new Error((data.message && String(data.message).trim()) || "요청 실패");
    return data;
  }
  if (!res.ok) throw new Error("요청 실패");
  return res;
}

function show(view) {
  $("loginView").classList.toggle("hidden", view !== "login");
  $("appView").classList.toggle("hidden", view !== "app");
}

function setPage(page) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  ["desk", "orders", "files", "admin"].forEach((id) => {
    $(`${id}Page`).classList.toggle("hidden", id !== page);
  });
  const titles = {
    desk: ["COLLECTOR", "주문 수집"],
    orders: ["ORDERS", "주문 목록"],
    files: ["ARCHIVE", "엑셀·정산서"],
    admin: ["ADMIN", "관리"]
  };
  $("pageEyebrow").textContent = titles[page][0];
  $("pageTitle").textContent = titles[page][1];
  const showAdminStats = page === "admin" && state.user?.role === "admin";
  $("adminOverview").classList.toggle("hidden", !showAdminStats);
  if (showAdminStats) loadAdminStats();
}

function deskLane(platform) {
  return document.querySelector(`.platform-lane[data-platform="${platform}"]`);
}

function deskEl(platform, role) {
  return deskLane(platform)?.querySelector(`[data-role="${role}"]`) || null;
}

function platformBody(platform, extra = {}) {
  return { platform, ...extra };
}

function sessionForPlatform(platform) {
  return liveSessions().find((row) => row.platform === platform)
    || (state.lastByPlatform[platform]?.id ? state.lastByPlatform[platform] : null);
}

function upsertSession(session) {
  if (!session?.id) return;
  const idx = state.sessions.findIndex((row) => row.id === session.id || row.platform === session.platform);
  if (idx >= 0) state.sessions[idx] = { ...state.sessions[idx], ...session };
  else state.sessions.push(session);
  if (!state.session || state.session.platform === session.platform) state.session = session;
}

function liveSessions() {
  return (state.sessions || []).filter((row) => row && row.status !== "stopped");
}

function platformLabel(platform) {
  if (platform === "youtube") return "유튜브";
  if (platform === "tiktok") return "틱톡";
  return platform || "";
}

function platformTag(platform) {
  if (!platform) return "";
  return `<span class="platform-tag ${platform}">${platformLabel(platform)}</span>`;
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function renderChannels() {
  renderChannelIds();
}

function renderChannelIds() {
  const isAdmin = state.user?.role === "admin";
  for (const platform of DESK_PLATFORMS) {
    const select = deskEl(platform, "channel");
    if (!select) continue;
    const list = state.channels.filter((c) => c.platform === platform);
    const seen = new Set();
    const unique = [];
    for (const c of list) {
      if (seen.has(c.channel_id)) continue;
      seen.add(c.channel_id);
      unique.push(c);
    }
    const prev = select.value;
    select.innerHTML = unique.length
      ? unique.map((c) => {
        const owner = c.username || c.user_name || "";
        const title = c.label || c.channel_id;
        const label = isAdmin && owner ? `${title} · ${owner}` : title;
        return `<option value="${escapeAttr(c.channel_id)}">${escapeAttr(label)}</option>`;
      }).join("")
      : `<option value="">승인된 ID 없음</option>`;
    if (prev && unique.some((c) => c.channel_id === prev)) select.value = prev;
  }

  const tiktok = [...new Set(state.channels.filter((c) => c.platform === "tiktok").map((c) => c.channel_id))];
  const youtube = [...new Set(state.channels.filter((c) => c.platform === "youtube").map((c) => c.channel_id))];
  const bits = [];
  if (tiktok.length) bits.push(`틱톡 ${tiktok.join(", ")}`);
  if (youtube.length) bits.push(`유튜브 ${youtube.join(", ")}`);
  if (bits.length) {
    $("channelIdsHint").textContent = `${isAdmin
      ? `승인된 전체 채널: ${bits.join(" · ")}`
      : `이 계정 채널: ${bits.join(" · ")}`} · 왼쪽 틱톡, 오른쪽 유튜브를 각각 켤 수 있습니다.`;
  } else {
    $("channelIdsHint").textContent = isAdmin
      ? "승인된 틱톡/유튜브 채널이 없습니다."
      : "이 계정에 승인된 틱톡/유튜브 ID가 없습니다. 관리자에게 승인을 요청하세요.";
  }
}

function renderChats() {
  for (const platform of DESK_PLATFORMS) {
    const el = deskEl(platform, "chats");
    if (!el) continue;
    const rows = state.chats.filter((c) => c.platform === platform).slice(-80).reverse();
    el.innerHTML = rows.length
      ? rows.map((c) => `
        <div class="chat-row ${c.is_order || c.isOrder ? "order" : ""} ${c.kind === "cancel" ? "cancel" : ""}">
          <b>${c.nick || ""}</b>${c.msg || ""}
        </div>
      `).join("")
      : `<div class="chat-row">채팅이 없습니다.</div>`;
  }
}

function renderReviews() {
  const el = $("reviewList");
  if (!el) return;
  el.innerHTML = (state.reviews || []).length
    ? state.reviews.map((r) => `
        <div class="order-row review-row">
          <b>${escapeAttr(r.nickname || r.nick || "")}</b>
          ${escapeAttr(r.message || r.msg || "")}
          <small>${escapeAttr(r.reason || "검수필요")}${r.product ? ` · ${escapeAttr(r.product)} ${r.qty || ""}개` : ""}</small>
        </div>
      `).join("")
    : `<div class="order-row">검수대기 주문이 없습니다.</div>`;
}

function renderOutputs() {
  for (const platform of DESK_PLATFORMS) {
    const el = deskEl(platform, "outputs");
    if (!el) continue;
    const rows = (state.outputs || []).filter((row) => row.platform === platform).slice(0, 200);
    el.innerHTML = rows.length
      ? rows.map((row) => `
          <div class="order-row output-row">
            <b>${escapeAttr(row.nick || "")}</b>
            ${escapeAttr(row.product || "")} ${escapeAttr(row.option || "")}
          </div>
        `).join("")
      : `<div class="order-row">주문이 들어오면 수량만큼 여기에 출력됩니다.</div>`;
  }
}

function appendOutputLines(payload) {
  const count = Number(payload.printQty || 0);
  if (!count) return;
  const option = [payload.option, payload.color, payload.size].filter(Boolean).filter((part, idx, all) => all.indexOf(part) === idx).join(" ");
  const lines = Array.from({ length: count }, () => ({
    nick: payload.nickname || payload.nick || "",
    product: payload.product || "",
    option,
    platform: payload.platform || ""
  }));
  state.outputs = lines.concat(state.outputs).slice(0, 200);
  renderOutputs();
}

function matchSourceLabel(source) {
  return {
    "qty-mode": "이거모드",
    current: "현재상품 추정",
    follow: "따라가기",
    alias: "별칭",
    named: "상품명",
    option: "옵션",
    number: "번호",
    unregistered: "미등록 상품"
  }[source] || "";
}

function isInferredOrder(o) {
  if (o.inferred === true || o.inferred === 1) return true;
  const src = o.matchSource || o.match_source || "";
  return Boolean(src) && src !== "named" && src !== "number";
}

function canUseShots() {
  return state.user?.role !== "admin";
}

function orderShotName(o) {
  return o.shotFile || o.shot_path || "";
}

function orderShotHref(file, sessionId) {
  if (!canUseShots()) return "";
  const id = sessionId || exportSession()?.id;
  if (!id || !file) return "";
  return `/api/sessions/${id}/shots/${encodeURIComponent(file)}`;
}

const SHOT_HINT = "상품을 등록하면 그 화면을 바로 저장합니다. 처음에는 화면 공유 창이 뜨니 전체 화면 또는 라이브 창을 고르세요. 찍히지 않았거나 다시 찍으려면 수동 캡처를 누르세요. 방송이 끝나도 24시간은 다시 볼 수 있고, 그 다음에 서버에서 지웁니다.";
let screenStream = null;
let screenVideo = null;

function setShotHint(text) {
  if ($("shotHint")) $("shotHint").textContent = text || SHOT_HINT;
}

function isScreenShareLive() {
  return Boolean(screenStream && screenStream.getVideoTracks().some((track) => track.readyState === "live"));
}

function stopScreenShare() {
  screenStream?.getTracks().forEach((track) => track.stop());
  screenStream = null;
  if (screenVideo) screenVideo.srcObject = null;
}

function onShareEnded() {
  stopScreenShare();
  setShotHint("화면 공유가 끊어졌습니다. 다음 상품 등록이나 수동 캡처 때 화면을 다시 고르세요.");
}

async function ensureScreenShare() {
  if (isScreenShareLive()) return true;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("이 브라우저는 화면 캡처를 지원하지 않습니다. Chrome에서 열어 주세요.");
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 5 },
      audio: false
    });
    const track = screenStream.getVideoTracks()[0];
    if (track) track.addEventListener("ended", onShareEnded);
    if (!screenVideo) {
      screenVideo = document.createElement("video");
      screenVideo.muted = true;
      screenVideo.playsInline = true;
      screenVideo.setAttribute("playsinline", "");
      screenVideo.style.cssText = "position:fixed;left:-9999px;width:2px;height:2px;opacity:0;pointer-events:none;";
      document.body.appendChild(screenVideo);
    }
    screenVideo.srcObject = screenStream;
    await screenVideo.play();
    if (!screenVideo.videoWidth) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("화면 공유가 아직 준비되지 않았습니다.")), 4000);
        screenVideo.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    setShotHint("화면 공유 중입니다. 상품을 등록하면 이 화면을 바로 저장합니다.");
    return true;
  } catch (err) {
    stopScreenShare();
    if (err?.name === "NotAllowedError" || err?.name === "NotFoundError") {
      throw new Error("화면 공유를 허용해야 상품 화면이 저장됩니다. 전체 화면 또는 라이브 창을 고르세요.");
    }
    throw err;
  }
}

async function grabScreenBlob() {
  if (!isScreenShareLive()) {
    throw new Error("화면 공유가 필요합니다. 상품 등록이나 수동 캡처를 다시 눌러 화면을 고르세요.");
  }
  const canvas = document.createElement("canvas");
  let width = 0;
  let height = 0;
  let draw;
  const track = screenStream.getVideoTracks()[0];
  if (typeof ImageCapture !== "undefined" && track) {
    try {
      const bitmap = await new ImageCapture(track).grabFrame();
      width = bitmap.width;
      height = bitmap.height;
      draw = (ctx, dw, dh) => ctx.drawImage(bitmap, 0, 0, dw, dh);
    } catch {}
  }
  if (!draw) {
    if (!screenVideo?.videoWidth) throw new Error("화면 공유가 아직 준비되지 않았습니다.");
    width = screenVideo.videoWidth;
    height = screenVideo.videoHeight;
    draw = (ctx, dw, dh) => ctx.drawImage(screenVideo, 0, 0, dw, dh);
  }
  const scale = Math.min(1, 1600 / width);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  draw(canvas.getContext("2d"), canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("캡처에 실패했습니다."))), "image/jpeg", 0.72);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("캡처 변환에 실패했습니다."));
    reader.readAsDataURL(blob);
  });
}

async function captureScreenDataUrl() {
  const blob = await grabScreenBlob();
  return blobToDataUrl(blob);
}

function optionText(order) {
  return [order.option || order.option_name, order.color, order.size]
    .filter((part) => String(part || "").trim())
    .filter((part, idx, all) => all.indexOf(part) === idx)
    .join(" / ");
}

function labelCopies(qty) {
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1 || n > 10) return 0;
  return n;
}

function setLabelButton() {
  const btn = $("labelBtn");
  if (!btn) return;
  const waiting = labelQueue.length;
  btn.classList.toggle("on", Boolean(state.labelPrint));
  if (!state.labelPrint) btn.textContent = "라벨";
  else if (waiting) btn.textContent = `라벨 ON · 대기 ${waiting}`;
  else btn.textContent = "라벨 ON";
}

function printLabelJob({ nickname, product, option, copies }) {
  return new Promise((resolve) => {
    const count = labelCopies(copies) || 1;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(iframe);
    const pages = Array.from({ length: count }, () => `
      <div class="label">
        <div class="nickname">${escapeAttr(nickname || "-")}</div>
        <div class="product">${escapeAttr(product || "-")}${option ? ` / ${escapeAttr(option)}` : ""}</div>
      </div>
    `).join("");
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <style>
    @page { size: 50mm 40mm; margin: 0; }
    html, body { width: 50mm; margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: "Malgun Gothic", Arial, sans-serif; }
    .label {
      width: 50mm; height: 40mm;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      box-sizing: border-box; overflow: hidden; page-break-after: always;
    }
    .label:last-child { page-break-after: auto; }
    .nickname { font-size: 22px; font-weight: 900; margin-bottom: 8px; text-align: center; }
    .product { font-size: 17px; font-weight: 700; text-align: center; }
  </style>
</head>
<body>${pages}</body>
</html>`);
    doc.close();
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      iframe.remove();
      resolve();
    };
    iframe.contentWindow.onafterprint = done;
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch {
        done();
      }
    }, 80);
    setTimeout(done, 60000);
  });
}

async function flushLabelQueue() {
  if (labelPrinting) return;
  labelPrinting = true;
  setLabelButton();
  try {
    while (state.labelPrint && labelQueue.length) {
      const job = labelQueue.shift();
      setLabelButton();
      await printLabelJob(job);
    }
  } finally {
    labelPrinting = false;
    setLabelButton();
  }
}

function enqueueLabel(order, copies) {
  const count = labelCopies(copies);
  if (!count) return;
  labelQueue.push({
    nickname: order.nickname || order.nick || "-",
    product: order.product || "-",
    option: optionText(order),
    copies: count
  });
  setLabelButton();
  if (state.labelPrint) flushLabelQueue();
}

function isShortage(o) {
  return (o?.stockStatus || o?.stock_status || "") === "shortage";
}

function orderCard(o) {
  const inferred = isInferredOrder(o);
  const shortage = isShortage(o);
  const src = matchSourceLabel(o.matchSource || o.match_source);
  const chat = o.msg || o.message || "";
  const shot = orderShotName(o);
  const href = orderShotHref(shot, o.sessionId);
  return `
    <div class="order-row ${inferred ? "guess" : ""} ${shortage ? "shortage" : ""}">
      <b>${o.nick || o.nickname || ""}</b>
      ${o.product || ""} ${o.option_name || o.option || ""} · ${o.qty}개 · ${shortage ? "재고부족" : `${(o.amount || 0).toLocaleString("ko-KR")}원`}
      ${shortage ? `<span class="match-tag shortage">재고부족</span>` : ""}
      ${src ? `<span class="match-tag ${inferred ? "guess" : ""}">${inferred ? "추정 · " : ""}${src}</span>` : ""}
      ${href ? `<a class="shot-link" href="${href}" target="_blank" rel="noopener">캡처</a>` : ""}
      <button type="button" class="label-reprint" data-label-nick="${escapeAttr(o.nick || o.nickname || "")}" data-label-product="${escapeAttr(o.product || "")}" data-label-option="${escapeAttr(optionText(o))}" data-label-qty="${labelCopies(o.qty) || 1}">라벨</button>
      ${chat ? `<small>채팅: ${chat}</small>` : ""}
    </div>`;
}

function renderOrders() {
  const all = state.orders;
  const rows = state.guessOnly ? all.filter(isInferredOrder) : all;
  for (const platform of DESK_PLATFORMS) {
    const el = deskEl(platform, "orders");
    if (!el) continue;
    const list = all.filter((o) => o.platform === platform).slice(0, 80);
    el.innerHTML = list.length
      ? list.map(orderCard).join("")
      : `<div class="order-row">접수된 주문이 없습니다.</div>`;
  }
  $("orderTable").innerHTML = rows.map((o) => {
    const inferred = isInferredOrder(o);
    const shortage = isShortage(o);
    const src = matchSourceLabel(o.matchSource || o.match_source) || "-";
    const shot = orderShotName(o);
    return `
    <tr class="${shortage ? "shortage" : ""}">
      <td>${platformTag(o.platform)}${o.nick || o.nickname || ""}</td>
      <td>${o.product || ""}</td>
      <td>${o.option_name || o.option || ""}</td>
      <td>${o.qty}</td>
      <td>${shortage ? "재고부족" : `${(o.amount || 0).toLocaleString("ko-KR")}원`}</td>
      <td>${shortage ? "재고부족" : inferred ? `추정 · ${src}` : src}</td>
      <td>${o.msg || o.message || ""}</td>
      <td class="shot-col">${orderShotHref(shot, o.sessionId) ? `<a class="shot-link" href="${orderShotHref(shot, o.sessionId)}" target="_blank" rel="noopener">보기</a>` : "-"}</td>
      <td><button type="button" class="label-reprint" data-label-nick="${escapeAttr(o.nick || o.nickname || "")}" data-label-product="${escapeAttr(o.product || "")}" data-label-option="${escapeAttr(optionText(o))}" data-label-qty="${labelCopies(o.qty) || 1}">라벨</button></td>
    </tr>`;
  }).join("");
  const confirmed = all.filter((o) => !isShortage(o));
  const buyers = new Set(confirmed.map((o) => o.uid || o.nick)).size;
  $("statBuyers").textContent = buyers;
  $("statOrders").textContent = confirmed.length;
  $("statAmount").textContent = confirmed.reduce((s, o) => s + Number(o.amount || 0), 0).toLocaleString("ko-KR");
}

function exportSession() {
  return state.session || state.lastSession;
}

function setLastSession(session) {
  if (!session?.id) return;
  state.lastSession = session;
  if (session.platform) state.lastByPlatform[session.platform] = session;
}

function updateFilesHint() {
  const hint = $("filesHint");
  if (!hint) return;
  const lives = liveSessions();
  const session = exportSession();
  if (lives.length) {
    hint.textContent = `지금 방송: ${lives.map((row) => `${platformLabel(row.platform)} ${row.channelId || row.channel_id || ""}`).join(" · ")}`;
    return;
  }
  if (!session) {
    hint.textContent = "아직 받을 방송이 없습니다. 수집을 한 번 하면 종료 후에도 받을 수 있습니다.";
    return;
  }
  const mailNote = state.mailReady ? " 방송이 끝나거나 끊기면 관리자 메일로도 보냅니다." : "";
  hint.textContent = `직전 방송: ${platformLabel(session.platform)} ${session.channelId || session.channel_id || ""} · 다음 수집 전까지 이 방송을 받습니다.${mailNote}`;
}

function setLiveBadge() {
  const lives = liveSessions();
  const live = lives.length > 0;
  $("liveBadge").textContent = live ? "수집중" : "대기";
  $("liveBadge").classList.toggle("live", live);
  for (const platform of DESK_PLATFORMS) {
    const el = deskEl(platform, "status");
    const row = lives.find((item) => item.platform === platform);
    if (!el) continue;
    el.textContent = row?.error ? row.error : row ? `수집중 · ${row.channelId || row.channel_id || ""}` : "대기";
    el.classList.toggle("live", Boolean(row) && !row.error);
  }
  updateFilesHint();
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "chat") {
      state.chats.push({
        nick: msg.payload.nick,
        msg: msg.payload.msg,
        is_order: msg.payload.isOrder,
        platform: msg.payload.platform,
        sessionId: msg.payload.sessionId
      });
      renderChats();
    }
    if (msg.type === "cancel") {
      const p = msg.payload || {};
      if (p.removed) {
        state.orders = state.orders.filter((o) => {
          const sameUser = String(o.uid || "") === String(p.uid || "");
          const sameProduct = (o.product || "") === (p.product || "");
          const sameOption = (o.option_name || o.option || "") === (p.option || "");
          const sameStatus = (o.stockStatus || o.stock_status || "") === (p.stockStatus || "");
          if (!sameUser || !sameProduct || !sameStatus) return true;
          if (p.option) return !sameOption;
          return false;
        });
      } else if (p.qty != null) {
        const idx = state.orders.findIndex((o) =>
          String(o.uid || "") === String(p.uid || "") &&
          (o.product || "") === (p.product || "") &&
          (o.option_name || o.option || "") === (p.option || "") &&
          (o.stockStatus || o.stock_status || "") === (p.stockStatus || "")
        );
        if (idx >= 0) {
          state.orders[idx].qty = p.qty;
          state.orders[idx].amount = Number(p.qty || 0) * Number(state.orders[idx].price || 0);
        }
      }
      renderOrders();
    }
    if (msg.type === "review") {
      state.reviews.unshift(msg.payload);
      state.reviews = state.reviews.slice(0, 80);
      renderReviews();
    }
    if (msg.type === "orders-cleared") {
      const platform = msg.payload?.platform;
      if (platform) {
        state.orders = state.orders.filter((o) => o.platform && o.platform !== platform);
        state.reviews = state.reviews.filter((r) => r.platform && r.platform !== platform);
      } else {
        state.orders = [];
        state.reviews = [];
      }
      renderOrders();
      renderReviews();
    }
    if (msg.type === "chats-cleared") {
      const platform = msg.payload?.platform;
      state.chats = platform
        ? state.chats.filter((c) => c.platform && c.platform !== platform)
        : [];
      renderChats();
    }
    if (msg.type === "stock-block" || msg.type === "duplicate-order" || msg.type === "add-order") {
      const p = msg.payload || {};
      const current = deskEl(p.platform, "current");
      if (current) {
        current.textContent = msg.type === "duplicate-order"
          ? `중복 주문: ${p.nickname || ""} / ${p.product || ""} ${p.option || ""}`.trim()
          : msg.type === "add-order"
            ? `추가 주문: ${p.nickname || ""} / ${p.product || ""} ${p.option || ""} +${p.added || 1} → ${p.qty || ""}개`.trim()
            : `재고부족: ${p.nickname || ""} / ${p.product || ""} ${p.option || ""} ${p.shortage || ""}개`.trim();
      }
    }
    if (msg.type === "order") {
      const incoming = {
        uid: msg.payload.uid,
        nick: msg.payload.nickname,
        product: msg.payload.product,
        option_name: msg.payload.option,
        color: msg.payload.color,
        size: msg.payload.size,
        qty: msg.payload.qty,
        amount: msg.payload.amount,
        msg: msg.payload.message,
        matchSource: msg.payload.matchSource,
        inferred: msg.payload.inferred,
        shotFile: msg.payload.shotFile || "",
        platform: msg.payload.platform,
        sessionId: msg.payload.sessionId,
        stockStatus: msg.payload.stockStatus || ""
      };
      if (state.labelPrint && incoming.stockStatus !== "shortage") enqueueLabel(msg.payload, msg.payload.printQty ?? incoming.qty);
      appendOutputLines(msg.payload);
      const idx = state.orders.findIndex((o) =>
        o.uid === incoming.uid &&
        o.product === incoming.product &&
        (o.option_name || "") === (incoming.option_name || "") &&
        (o.stockStatus || o.stock_status || "") === (incoming.stockStatus || "") &&
        (!incoming.sessionId || o.sessionId === incoming.sessionId)
      );
      if (idx >= 0) {
        if (!incoming.shotFile && (state.orders[idx].shotFile || state.orders[idx].shot_path)) {
          incoming.shotFile = state.orders[idx].shotFile || state.orders[idx].shot_path;
        }
        state.orders[idx] = { ...state.orders[idx], ...incoming };
      } else {
        state.orders.unshift(incoming);
      }
      renderOrders();
    }
    if (msg.type === "order-shot") {
      const p = msg.payload || {};
      const idx = state.orders.findIndex((o) =>
        o.uid === p.uid &&
        o.product === p.product &&
        (o.option_name || o.option || "") === (p.option || "") &&
        (!p.sessionId || !o.sessionId || o.sessionId === p.sessionId)
      );
      if (idx >= 0) {
        state.orders[idx].shotFile = p.shotFile;
        state.orders[idx].shot_path = p.shotFile;
        renderOrders();
      }
    }
    if (msg.type === "shot-status" && msg.payload && !msg.payload.ok) {
      setShotHint(msg.payload.error || "화면 캡처에 실패했습니다. 수동 캡처로 다시 찍을 수 있습니다.");
    }
    if (msg.type === "session-closed") {
      const payload = msg.payload || {};
      state.sessions = state.sessions.filter((row) => row.platform !== payload.platform);
      setLastSession(payload);
      setLiveBadge();
      saveBroadcastFiles(payload).then((note) => {
        if (note) $("filesHint").textContent = note;
      });
    }
    if (msg.type === "status") {
      if (msg.payload.platform) {
        const current = state.sessions.find((row) => row.platform === msg.payload.platform);
        if (current) upsertSession({ ...current, status: msg.payload.status === "error" ? "running" : current.status, error: msg.payload.error || "" });
      }
      setLiveBadge();
    }
    if (msg.type === "product") {
      const platform = msg.payload.platform;
      if (!platform) return;
      upsertProduct(platform, msg.payload);
      setCurrentProduct(platform, msg.payload, msg.payload.qtyMode);
    }
    if (msg.type === "product-removed") {
      const platform = msg.payload.platform;
      if (!platform) return;
      applyProductState(platform, msg.payload.products, msg.payload.qtyMode);
    }
    if (msg.type === "products-reset") {
      const platform = msg.payload.platform;
      if (!platform) return;
      applyProductState(platform, [], msg.payload?.qtyMode);
    }
  };
}

async function bootApp() {
  const data = await api("/api/me");
  state.user = data.user;
  state.mailReady = Boolean(data.mailReady);
  state.channels = data.channels || [];
  state.sessions = data.sessions || (data.session ? [data.session] : []);
  state.session = data.session || state.sessions[0] || null;
  setLastSession(data.session || data.lastSession);
  $("sideName").textContent = data.user.name;
  $("sideMeta").textContent = `${data.user.role} · ${data.user.license || "PRO"} · ${data.user.expireDate || ""}`;
  const isAdmin = data.user.role === "admin";
  document.body.classList.toggle("is-admin", isAdmin);
  $("adminNavWrap").classList.toggle("hidden", !isAdmin);
  $("adminOverview").classList.add("hidden");
  renderChannels();
  setLiveBadge();
  setLabelButton();
  if (canUseShots() && !isScreenShareLive()) setShotHint();
  if (liveSessions().length || state.session) {
    const cur = await api("/api/sessions/current");
    state.sessions = cur.sessions || state.sessions;
    state.session = cur.session || state.session;
    state.sessions.forEach(setLastSession);
    setLastSession(data.session || data.lastSession || cur.lastSession);
    state.chats = cur.chats || [];
    state.orders = cur.orders || [];
    state.reviews = cur.reviews || [];
    renderChats();
    renderOrders();
    renderReviews();
    renderOutputs();
    for (const session of state.sessions) {
      const snap = session.snapshot;
      if (!snap || !session.platform) continue;
      applyProductState(session.platform, snap.products || [], snap.qtyMode);
    }
    setLiveBadge();
  } else {
    renderChats();
    renderOrders();
    renderOutputs();
    for (const platform of DESK_PLATFORMS) renderProductHistory(platform, null);
  }
  connectWs();
  show("app");
  if (data.user.role === "admin") {
    await loadAdmin();
    startAdminStats();
  }
}

async function loadAdminStats() {
  try {
    const data = await api("/api/admin/overview");
    $("adminStatSellers").textContent = data.sellers ?? 0;
    $("adminStatOnline").textContent = data.online ?? 0;
    $("adminStatTiktok").textContent = data.tiktok ?? 0;
    $("adminStatYoutube").textContent = data.youtube ?? 0;
  } catch {
    // keep last numbers if refresh fails
  }
}

function startAdminStats() {
  if (state.adminStatsTimer) return;
  loadAdminStats();
  state.adminStatsTimer = setInterval(loadAdminStats, 8000);
}

function setAdminTab(tab) {
  const pages = {
    accounts: "adminTabAccounts",
    channels: "adminTabChannels",
    "seller-data": "adminTabSellerData",
    files: "adminTabFiles",
    logs: "adminTabLogs"
  };
  Object.entries(pages).forEach(([name, id]) => {
    $(id).classList.toggle("hidden", name !== tab);
  });
  document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.adminTab === tab);
  });
  if (tab === "seller-data" && $("sellerDataUser").value) loadSellerData();
  if (tab === "files") loadAdminFiles();
  if (tab === "logs") loadAdminLogs();
}

async function loadAdmin() {
  const users = await api("/api/admin/users");
  const channels = await api("/api/admin/channels");
  state.adminUsers = users.users || [];
  $("channelUser").innerHTML = state.adminUsers.map((u) => `<option value="${u.id}">${escapeAttr(u.username)}</option>`).join("");
  $("sellerDataUser").innerHTML = state.adminUsers
    .filter((u) => u.role === "seller")
    .map((u) => `<option value="${u.id}">${escapeAttr(u.name || u.username)} (${escapeAttr(u.username)})</option>`)
    .join("") || `<option value="">판매자 없음</option>`;
  $("userList").innerHTML = state.adminUsers.map((u) => `
    <div class="stack-item">
      <span>${escapeAttr(u.username)} · ${escapeAttr(u.role)} · ${escapeAttr(u.license || "PRO")} · ${escapeAttr(u.status)}</span>
      <span>
        <button class="edit-btn" type="button" data-edit="${u.id}">수정</button>
        <button type="button" data-del="${u.id}">삭제</button>
      </span>
    </div>
  `).join("");
  $("channelList").innerHTML = channels.channels.map((c) => `
    <div class="stack-item">
      <span>${escapeAttr(c.username)} · ${escapeAttr(c.platform)} · ${escapeAttr(c.channel_id)}</span>
      <button data-id="${c.id}">삭제</button>
    </div>
  `).join("");
  if ($("sellerDataUser").value) loadSellerData();
  if (!$("adminTabFiles").classList.contains("hidden")) loadAdminFiles();
  await loadAdminStats();
}

async function loadAdminLogs() {
  const box = $("adminLogList");
  if (!box) return;
  try {
    const data = await api("/api/admin/logs");
    box.innerHTML = (data.logs || []).length
      ? data.logs.map((row) => `
          <div class="stack-item">
            <span>${escapeAttr(row.created_at || "")} · ${escapeAttr(row.username || "-")} · ${escapeAttr(row.action || "")}</span>
            <span>${escapeAttr(row.detail || row.ip || "")}</span>
          </div>
        `).join("")
      : `<div class="stack-item">아직 로그가 없습니다.</div>`;
  } catch (err) {
    box.innerHTML = `<div class="stack-item">${escapeAttr(err.message)}</div>`;
  }
}

function adminFileKindLabel(kind) {
  return { orders: "주문 엑셀", chats: "채팅 엑셀", invoices: "정산서" }[kind] || kind || "파일";
}

function adminFileSourceLabel(source) {
  return { download: "다운로드", stop: "방송 종료" }[source] || source || "";
}

function fillAdminFileUsers() {
  const sel = $("adminFileUser");
  if (!sel) return;
  const current = sel.value;
  const sellers = (state.adminUsers || []).filter((u) => u.role === "seller");
  sel.innerHTML = [`<option value="">전체 셀러</option>`]
    .concat(sellers.map((u) => `<option value="${u.id}">${escapeAttr(u.name || u.username)} (${escapeAttr(u.username)})</option>`))
    .join("");
  if ([...sel.options].some((opt) => opt.value === current)) sel.value = current;
}

async function loadAdminFiles() {
  const box = $("adminFileList");
  if (!box) return;
  fillAdminFileUsers();
  const userId = $("adminFileUser")?.value;
  try {
    const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    const data = await api(`/api/admin/files${qs}`);
    const files = data.files || [];
    box.innerHTML = files.length
      ? files.map((row) => `
          <div class="stack-item">
            <span>${escapeAttr(row.created_at || "")} · ${escapeAttr(row.username || "-")} · ${escapeAttr(adminFileKindLabel(row.kind))} · ${escapeAttr(adminFileSourceLabel(row.source))}<br>${escapeAttr(row.filename || row.stored_name)}</span>
            <button class="edit-btn" type="button" data-admin-file="${row.id}" data-admin-file-name="${escapeAttr(row.filename || row.stored_name)}">받기</button>
          </div>
        `).join("")
      : `<div class="stack-item">아직 보관된 파일이 없습니다. 셀러가 방송을 종료하거나 엑셀·정산서를 받으면 여기에 남습니다.</div>`;
  } catch (err) {
    box.innerHTML = `<div class="stack-item">${escapeAttr(err.message)}</div>`;
  }
}

function resetUserForm() {
  state.editingUserId = null;
  $("newUser").value = "";
  $("newPass").value = "";
  $("newPass").placeholder = "비밀번호";
  $("newName").value = "";
  $("newRole").value = "seller";
  $("newStatus").value = "active";
  $("newExpire").value = "";
  $("newLicense").value = "PRO";
  $("newMail").value = "";
  $("addUserBtn").textContent = "계정 생성";
  $("cancelEditBtn").classList.add("hidden");
}

function fillUserForm(user) {
  state.editingUserId = user.id;
  $("newUser").value = user.username || "";
  $("newPass").value = "";
  $("newPass").placeholder = "비밀번호 (바꿀 때만 입력)";
  $("newName").value = user.name || "";
  $("newRole").value = user.role || "seller";
  $("newStatus").value = user.status || "active";
  $("newExpire").value = user.expire_date || "";
  $("newLicense").value = user.license || "PRO";
  $("newMail").value = user.mail_to || user.mailTo || "";
  $("addUserBtn").textContent = "계정 저장";
  $("cancelEditBtn").classList.remove("hidden");
}

function sessionLabel(row) {
  const when = String(row.started_at || "").replace("T", " ").slice(0, 16);
  return `${platformLabel(row.platform)} ${row.channel_id} · 주문 ${row.order_count || 0} · ${when}`;
}

async function loadSellerData() {
  const userId = $("sellerDataUser").value;
  if (!userId) {
    $("sellerDataHint").textContent = "셀러를 선택하세요.";
    $("sellerDataSession").innerHTML = "";
    $("sellerOrderList").innerHTML = "";
    $("sellerChatList").innerHTML = "";
    return;
  }
  const prev = $("sellerDataSession").value;
  const data = await api(`/api/admin/users/${userId}/data${prev ? `?sessionId=${encodeURIComponent(prev)}` : ""}`);
  $("sellerDataSession").innerHTML = (data.sessions || []).length
    ? data.sessions.map((row) => `<option value="${escapeAttr(row.id)}">${escapeAttr(sessionLabel(row))}</option>`).join("")
    : `<option value="">방송 기록 없음</option>`;
  if (data.session?.id) $("sellerDataSession").value = data.session.id;
  const channels = (data.channels || []).map((c) => `${platformLabel(c.platform)} ${c.label || c.channel_id}`).join(", ");
  $("sellerDataHint").textContent = data.session
    ? `채널: ${channels || "없음"} · 이 방송 주문 ${data.orders.length}건, 채팅 ${data.chats.length}건`
    : `채널: ${channels || "없음"} · 아직 수집한 방송이 없습니다.`;
  $("sellerOrderList").innerHTML = (data.orders || []).length
    ? data.orders.slice(0, 80).map((o) => `
        <div class="order-row ${isShortage(o) ? "shortage" : ""}"><b>${escapeAttr(o.nick || "")}</b>${escapeAttr(o.product || "")} ${escapeAttr(o.option_name || o.color || "")} ${o.qty || 0}개${isShortage(o) ? " · 재고부족" : ""}</div>
      `).join("")
    : `<div class="order-row">주문이 없습니다.</div>`;
  $("sellerChatList").innerHTML = (data.chats || []).length
    ? data.chats.slice().reverse().map((c) => `
        <div class="chat-row ${c.is_order ? "order" : ""}"><b>${escapeAttr(c.nick || "")}</b>${escapeAttr(c.msg || "")}</div>
      `).join("")
    : `<div class="chat-row">채팅이 없습니다.</div>`;
}

$("loginPw").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("loginBtn").click();
});
$("loginId").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("loginBtn").click();
});
if (localStorage.getItem("livoraRemember") === "1") {
  $("rememberLogin").checked = true;
  $("loginId").value = localStorage.getItem("livoraLoginId") || "";
}

$("loginBtn").onclick = async () => {
  $("loginError").textContent = "";
  const remember = $("rememberLogin").checked;
  try {
    await api("/api/login", {
      method: "POST",
      body: {
        username: $("loginId").value,
        password: $("loginPw").value,
        remember
      }
    });
    localStorage.setItem("livoraRemember", remember ? "1" : "0");
    if (remember) localStorage.setItem("livoraLoginId", $("loginId").value.trim());
    else localStorage.removeItem("livoraLoginId");
    await bootApp();
  } catch (err) {
    $("loginError").textContent = err.message;
  }
};

$("logoutBtn").onclick = async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
};

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.onclick = () => setPage(btn.dataset.page);
});

document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
  btn.onclick = () => setAdminTab(btn.dataset.adminTab);
});

function desktopStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("livora-desktop", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readDesktopHandle() {
  try {
    const db = await desktopStore();
    return await new Promise((resolve, reject) => {
      const request = db.transaction("kv").objectStore("kv").get("root");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function writeDesktopHandle(handle) {
  const db = await desktopStore();
  await new Promise((resolve, reject) => {
    const request = db.transaction("kv", "readwrite").objectStore("kv").put(handle, "root");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function grantedDesktopHandle() {
  const handle = await readDesktopHandle();
  if (!handle?.queryPermission) return null;
  const permission = await handle.queryPermission({ mode: "readwrite" });
  return permission === "granted" ? handle : null;
}

async function rememberDesktopFolder() {
  if (!window.showDirectoryPicker) return false;
  if (await grantedDesktopHandle()) return true;
  try {
    const handle = await window.showDirectoryPicker({
      id: "livora-desktop",
      startIn: "desktop",
      mode: "readwrite"
    });
    await writeDesktopHandle(handle);
    return true;
  } catch {
    return false;
  }
}

function folderNameForUser() {
  return String(state.user?.username || "seller").replace(/[\\/:*?"<>|]/g, "_").trim() || "seller";
}

const savingBundles = new Map();

async function saveBroadcastFiles(bundle) {
  const sessionId = bundle?.id || bundle?.sessionId;
  const files = bundle?.files || [];
  if (!sessionId || !files.length) return "";
  if (savingBundles.has(sessionId)) return savingBundles.get(sessionId);
  const job = writeBroadcastFiles(bundle, sessionId, files);
  savingBundles.set(sessionId, job);
  return job;
}

async function writeBroadcastFiles(bundle, sessionId, files) {
  if (bundle.desktop?.ok) return `바탕화면 ${bundle.desktop.dir} 폴더에 주문·채팅·정산서를 저장했습니다. 서버에는 1주일 보관합니다.`;
  let root = await grantedDesktopHandle();
  if (!root && window.showDirectoryPicker) {
    try {
      root = await window.showDirectoryPicker({
        id: "livora-desktop",
        startIn: "desktop",
        mode: "readwrite"
      });
      await writeDesktopHandle(root);
    } catch {
      root = null;
    }
  }
  if (root) {
    const folder = await root.getDirectoryHandle(folderNameForUser(), { create: true });
    for (const name of files) {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/kept/${encodeURIComponent(name)}`, { credentials: "same-origin" });
      if (!res.ok) continue;
      const handle = await folder.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(await res.blob());
      await writable.close();
    }
    return `바탕화면의 ${folderNameForUser()} 폴더에 주문·채팅·정산서를 저장했습니다. 서버에는 1주일 보관하고 관리자 메일로도 보냅니다.`;
  }
  for (const name of files) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/kept/${encodeURIComponent(name)}`, { credentials: "same-origin" });
    if (!res.ok) continue;
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }
  return "바탕화면 폴더를 아직 고르지 않아 파일을 다운로드했습니다. 다음 수집을 시작할 때 바탕화면을 선택하면 아이디 폴더에 저장됩니다.";
}

async function startPlatform(platform) {
  const channelId = deskEl(platform, "channel")?.value || "";
  if (!channelId) return alert(`${platformLabel(platform)} 승인 채널이 없습니다.`);
  await rememberDesktopFolder();
  state.activePlatform = platform;
  try {
    $("liveBadge").textContent = "수집중";
    $("liveBadge").classList.add("live");
    const data = await api("/api/sessions/start", {
      method: "POST",
      body: { platform, channelId, screenCapture: canUseShots() }
    });
    state.sessions = data.sessions || [];
    upsertSession(data.session);
    setLastSession(data.session);
    state.chats = state.chats.filter((c) => c.platform && c.platform !== platform);
    state.orders = state.orders.filter((o) => o.platform && o.platform !== platform);
    state.reviews = state.reviews.filter((r) => r.platform && r.platform !== platform);
    state.outputs = state.outputs.filter((row) => row.platform !== platform);
    applyProductState(platform, [], null);
    renderChats();
    renderOrders();
    renderReviews();
    renderOutputs();
    setLiveBadge();
  } catch (err) {
    setLiveBadge();
    alert(err.message);
  }
}

async function stopPlatform(platform) {
  const previousSessions = state.sessions.slice();
  state.sessions = state.sessions.filter((row) => row.platform !== platform);
  setLiveBadge();
  let data;
  try {
    data = await api("/api/sessions/stop", { method: "POST", body: { platform } });
  } catch (err) {
    state.sessions = previousSessions;
    setLiveBadge();
    alert(err.message);
    return;
  }
  setLastSession(data.lastSession || data.session || state.session);
  state.sessions = data.sessions || [];
  state.session = state.sessions[0] || data.session || null;
  setLiveBadge();
  const mail = data.mail || {};
  let mailText = "";
  if (mail.ok) mailText = ` 관리자 메일 ${mail.to || ""}로 보냈습니다.`;
  else if (mail.error) mailText = ` 관리자 메일은 보내지 못했습니다. ${mail.error}`;
  else if (mail.reason === "no-target") mailText = " 관리자 메일이 없어 파일만 저장했습니다. 관리자 계정에 메일을 넣어 주세요.";
  else if (mail.reason === "smtp") mailText = " 메일 서버 설정이 없어 파일만 저장했습니다.";
  const notes = [];
  for (const bundle of data.bundles || []) {
    const saved = await saveBroadcastFiles(bundle);
    if (saved) notes.push(saved);
  }
  $("filesHint").textContent = `${platformLabel(platform)} 종료 저장이 끝났습니다.${mailText} ${notes.join(" ")}`.trim();
  if (mail.ok) alert(`${platformLabel(platform)} 종료. 관리자 메일로 보냈습니다.`);
}

function productKey(p) {
  if (p?.key) return p.key;
  if (p?.type === "number" || (p?.number && !p?.options?.length)) return `N:${p.number}`;
  const options = p?.options || [];
  if (p?.type === "option" || options.length) {
    const opts = options.map((opt) => String(opt || "").replace(/\s+/g, "").toLowerCase()).filter(Boolean).sort().join(".");
    return `O:${p.product}:${opts}:${Number(p.price || 0)}`;
  }
  return p?.product ? `P:${p.product}` : "";
}

function upsertProduct(platform, reg) {
  if (!platform || !reg) return;
  const list = state.productsByPlatform[platform] || [];
  const key = productKey(reg);
  const idx = list.findIndex((p) => productKey(p) === key);
  if (idx >= 0) list[idx] = { ...list[idx], ...reg, key };
  else list.unshift({ ...reg, key });
  state.productsByPlatform[platform] = list;
}

function applyProductState(platform, products, qtyMode) {
  if (!platform) return;
  if (Array.isArray(products)) {
    state.productsByPlatform[platform] = products.map((p) => ({ ...p, key: productKey(p) }));
  }
  if (qtyMode !== undefined) state.qtyByPlatform[platform] = qtyMode;
  const mode = state.qtyByPlatform[platform];
  const list = state.productsByPlatform[platform] || [];
  const current = mode?.key
    ? list.find((p) => productKey(p) === mode.key)
    : mode?.product
    ? list.find((p) => (p.product || p.number) === mode.product)
    : null;
  setCurrentProduct(platform, current, mode);
}

function fieldList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (!value) return [];
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try { return fieldList(JSON.parse(value)); } catch { /* 문자열 옵션으로 처리 */ }
  }
  return String(value).split(/[,./|]+/).map((item) => item.trim()).filter(Boolean);
}

function productFields(p) {
  const fields = [];
  const rawName = String(p?.product || "").trim();
  const number = String(p?.number || (/^\d+$/.test(rawName) ? rawName : "")).trim();
  const name = rawName && rawName !== number ? rawName : "";
  if (name) fields.push(["상품명", name]);
  if (number) fields.push(["번호", number]);
  const sizes = fieldList(p?.sizes);
  const colors = fieldList(p?.colors);
  if (sizes.length) fields.push(["사이즈", sizes.join(", ")]);
  if (colors.length) fields.push(["색상", colors.join(", ")]);
  if (!sizes.length && !colors.length) {
    const options = fieldList(p?.options?.length ? p.options : p?.options_json);
    if (options.length) fields.push(["옵션", options.join(", ")]);
  }
  const price = Number(p?.price || 0);
  if (price) fields.push(["가격", `${price.toLocaleString("ko-KR")}원`]);
  const qty = Number(p?.defaultQty || p?.default_qty || 0);
  if (qty > 1) fields.push(["수량", `${qty}개`]);
  const stock = Number(p?.stock || 0);
  if (stock) fields.push(["재고", `${stock}개`]);
  return fields;
}

function fieldHtml(label, value) {
  return `<span class="reg-field"><em>${escapeAttr(label)}</em>${escapeAttr(value)}</span>`;
}

function renderProductHistory(platform, qtyMode) {
  const el = deskEl(platform, "products");
  if (!el) return;
  const mode = qtyMode === undefined ? state.qtyByPlatform[platform] : qtyMode;
  const current = mode?.product || "";
  const seen = new Set();
  const items = [];
  for (const p of state.productsByPlatform[platform] || []) {
    const key = productKey(p);
    const name = p.product || p.number || "";
    if (!name || seen.has(key || name)) continue;
    seen.add(key || name);
    items.push({ ...p, key, name, current: (mode?.key && key === mode.key) || (!mode?.key && name === current) });
  }
  const sessionId = sessionForPlatform(platform)?.id || "";
  el.innerHTML = items.map((p) => {
    const fields = productFields(p);
    const shot = p.shotFile || p.shot_path || "";
    return `
      <span class="product-chip ${p.current ? "current" : ""} ${shot ? "has-shot" : ""}" data-key="${escapeAttr(p.key)}" data-shot="${escapeAttr(shot)}" data-session="${escapeAttr(sessionId)}" title="${shot ? "클릭하면 이 상품 캡처를 엽니다" : ""}">
        ${fields.map(([label, value]) => fieldHtml(label, value)).join("")}
        ${p.current ? `<span class="reg-now">현재</span>` : ""}
        ${shot ? `<span class="reg-now">캡처</span>` : ""}
        <button type="button" data-remove="${escapeAttr(p.key)}">삭제</button>
      </span>`;
  }).join("");
}

function setCurrentProduct(platform, reg, qtyMode) {
  const current = deskEl(platform, "current");
  const qtyBtn = deskEl(platform, "qtyBtn");
  if (qtyMode !== undefined) state.qtyByPlatform[platform] = qtyMode;
  const mode = state.qtyByPlatform[platform];
  if (qtyBtn) qtyBtn.textContent = mode?.enabled ? "이거모드 ON" : "이거모드";
  const product = reg?.product || reg?.number || mode?.product;
  if (!current) return;
  if (!product) {
    current.textContent = "현재 등록 상품 없음";
    renderProductHistory(platform, mode);
    return;
  }
  const fields = productFields({
    ...reg,
    price: reg?.price ?? mode?.price ?? 0,
    stock: reg?.stock ?? mode?.stock ?? 0,
    defaultQty: reg?.defaultQty ?? mode?.defaultQty ?? 1
  });
  current.innerHTML = `<span class="reg-now">현재상품</span>${fields.map(([label, value]) => fieldHtml(label, value)).join("")}`;
  renderProductHistory(platform, mode);
}

function laneField(platform, role) {
  return deskEl(platform, role)?.value.trim() || "";
}

async function registerProduct(platform) {
  const name = laneField(platform, "name");
  const number = laneField(platform, "number");
  const size = laneField(platform, "size");
  const color = laneField(platform, "color");
  const qty = laneField(platform, "qty");
  const price = laneField(platform, "price");
  const stock = laneField(platform, "stock");
  if (!name && !number && !size && !color && !qty && !price && !stock) return;
  try {
    let image = "";
    if (canUseShots()) {
      try {
        if (!isScreenShareLive()) await ensureScreenShare();
        image = await captureScreenDataUrl();
      } catch (err) {
        setShotHint(`${err.message || "상품 등록 화면을 찍지 못했습니다."} 상품은 등록됩니다. 수동 캡처로 다시 찍을 수 있습니다.`);
      }
    }
    const data = await api("/api/sessions/products", {
      method: "POST",
      body: platformBody(platform, { name, number, size, color, qty, price, stock, image })
    });
    if (data.skipped) return;
    ["name", "number", "size", "color", "qty", "price", "stock"].forEach((role) => {
      const input = deskEl(platform, role);
      if (input) input.value = "";
    });
    upsertProduct(platform, data.registration);
    setCurrentProduct(platform, data.registration, data.qtyMode);
    const shot = data.registration?.shotFile || "";
    if (shot) setShotHint(`${platformLabel(platform)} 상품 등록 캡처 저장: ${shot}. 상품 이름을 누르면 열립니다.`);
  } catch (err) {
    const message = String(err.message || "").trim();
    alert(message === "요청 실패" || /failed to fetch/i.test(message)
      ? "상품을 등록하지 못했습니다. 수집이 켜져 있는지 확인한 뒤 다시 등록하세요."
      : message);
  }
}

async function removeLaneProduct(platform, key, label) {
  if (!confirm(`${label}\n등록에서 삭제할까요? 이미 접수된 주문은 그대로 둡니다.`)) return;
  try {
    const data = await api("/api/sessions/products/remove", {
      method: "POST",
      body: platformBody(platform, { key })
    });
    applyProductState(platform, data.products, data.qtyMode);
  } catch (err) {
    alert(err.message);
  }
}

async function resetLaneProducts(platform) {
  if (!confirm(`${platformLabel(platform)}에 등록한 상품을 모두 지울까요? 이미 접수된 주문은 그대로 둡니다.`)) return;
  try {
    const data = await api("/api/sessions/products/reset", { method: "POST", body: platformBody(platform) });
    applyProductState(platform, data.products || [], data.qtyMode);
  } catch (err) {
    alert(err.message);
  }
}

async function toggleQtyMode(platform) {
  try {
    const data = await api("/api/sessions/qty-mode", { method: "POST", body: platformBody(platform) });
    applyProductState(platform, state.productsByPlatform[platform] || [], data.qtyMode);
  } catch (err) {
    alert(err.message);
  }
}

async function clearLaneChats(platform) {
  if (!confirm(`${platformLabel(platform)} 채팅을 지울까요? 지운 채팅은 다시 불러오지 않습니다.`)) return;
  try {
    await api("/api/sessions/chats/clear", { method: "POST", body: platformBody(platform) });
    state.chats = state.chats.filter((c) => c.platform && c.platform !== platform);
    renderChats();
  } catch (err) {
    alert(err.message);
  }
}

$("labelBtn").onclick = () => {
  state.labelPrint = !state.labelPrint;
  localStorage.setItem("livoraLabelPrint", state.labelPrint ? "1" : "0");
  setLabelButton();
  if (state.labelPrint) flushLabelQueue();
};

function handleLabelReprint(ev) {
  const btn = ev.target.closest("[data-label-nick]");
  if (!btn) return;
  printLabelJob({
    nickname: btn.dataset.labelNick,
    product: btn.dataset.labelProduct,
    option: btn.dataset.labelOption,
    copies: btn.dataset.labelQty
  });
}

$("orderTable").addEventListener("click", handleLabelReprint);

async function loadShots() {
  if (!canUseShots()) return;
  const targets = exportTargets();
  if (!targets.length) return alert("받을 방송이 없습니다. 먼저 수집을 한 번 하세요.");
  try {
    const blocks = [];
    for (const session of targets) {
      const data = await api(`/api/sessions/${session.id}/shots`);
      const files = data.files || [];
      const label = platformLabel(session.platform) || "방송";
      blocks.push(files.length
        ? files.map((file) => `<a class="file-item" href="/api/sessions/${session.id}/shots/${encodeURIComponent(file)}" target="_blank">${label} · ${file}</a>`).join("")
        : `<div class="file-item">${label} 화면 캡처가 없습니다.</div>`);
    }
    $("fileList").innerHTML = blocks.join("") || "<div class='file-item'>저장된 화면 캡처가 없습니다. 상품을 등록하면 여기에 쌓입니다. 방송 종료 후 24시간이 지나면 지워집니다.</div>";
  } catch (err) {
    alert(err.message);
  }
}

$("guessOnly").onchange = () => {
  state.guessOnly = $("guessOnly").checked;
  renderOrders();
};

function renderSummaryText(kind, data) {
  if (kind === "all") {
    const a = data.all || {};
    return [
      `구매자 ${a.buyers || 0}명`,
      `주문 ${a.orderCount || 0}줄`,
      `수량 ${a.qty || 0}개`,
      `금액 ${Number(a.amount || 0).toLocaleString("ko-KR")}원`,
      Number(a.shortageQty || 0) > 0 ? `재고부족 ${a.shortageQty}개` : ""
    ].filter(Boolean).join("\n");
  }
  if (kind === "product") {
    return (data.products || []).map((p) =>
      `${p.product || ""} ${p.option || ""} · ${p.qty}개 · ${Number(p.amount || 0).toLocaleString("ko-KR")}원`
    ).join("\n") || "상품 주문이 없습니다.";
  }
  return (data.buyers || []).map((b) => {
    const lines = (b.items || []).map((i) =>
      `  ${i.product || ""} ${i.option || ""} · ${i.qty}개 · ${Number(i.amount || 0).toLocaleString("ko-KR")}원`
    );
    return `${b.nickname}\n${lines.join("\n")}`;
  }).join("\n\n") || "구매자가 없습니다.";
}

async function showSummary(kind) {
  const blocks = [];
  for (const platform of DESK_PLATFORMS) {
    try {
      const data = await api(`/api/sessions/summary?platform=${encodeURIComponent(platform)}`);
      blocks.push(`${platformLabel(platform)}\n${renderSummaryText(kind, data)}`);
    } catch (err) {
      blocks.push(`${platformLabel(platform)}\n${err.message}`);
    }
  }
  $("summaryBox").textContent = blocks.join("\n\n");
}

$("summaryAllBtn").onclick = () => showSummary("all");
$("summaryProductBtn").onclick = () => showSummary("product");
$("summaryBuyerBtn").onclick = () => showSummary("buyer");

$("clearOrdersBtn").onclick = async () => {
  const platforms = liveSessions().map((row) => row.platform);
  if (!platforms.length) return alert("수집 중인 방송이 없습니다.");
  if (!confirm("수집 중인 틱톡·유튜브 주문 목록을 지울까요? 이미 받은 엑셀은 그대로입니다.")) return;
  try {
    for (const platform of platforms) {
      await api("/api/sessions/orders/clear", { method: "POST", body: platformBody(platform) });
      state.orders = state.orders.filter((o) => o.platform && o.platform !== platform);
      state.reviews = state.reviews.filter((r) => r.platform && r.platform !== platform);
      state.outputs = state.outputs.filter((row) => row.platform !== platform);
    }
    renderOrders();
    renderReviews();
    renderOutputs();
    $("summaryBox").textContent = "주문 목록을 지웠습니다.";
  } catch (err) {
    alert(err.message);
  }
};

async function captureProductShot(platform) {
  if (!canUseShots()) return;
  const target = platform || state.activePlatform;
  try {
    if (!isScreenShareLive()) await ensureScreenShare();
    const image = await captureScreenDataUrl();
    const name = laneField(target, "name") || state.qtyByPlatform[target]?.product || "수동";
    const data = await api("/api/sessions/product-shot", {
      method: "POST",
      body: platformBody(target, { name, image, attachCurrent: true })
    });
    if (data.registration) {
      upsertProduct(target, data.registration);
      setCurrentProduct(target, data.registration, data.qtyMode);
      setShotHint(`${platformLabel(target)} 현재 상품 화면을 저장했습니다. 상품 이름을 누르면 열립니다.`);
    } else {
      setShotHint(`${platformLabel(target)} 화면을 저장했습니다. 다음 상품 등록에 이 사진이 붙습니다.`);
    }
  } catch (err) {
    alert(err.message);
  }
}
$("deskPage").addEventListener("click", (ev) => {
  if (ev.target.closest("[data-label-nick]")) {
    handleLabelReprint(ev);
    return;
  }
  const lane = ev.target.closest("[data-platform]");
  if (!lane) return;
  const platform = lane.dataset.platform;
  state.activePlatform = platform;
  const action = ev.target.closest("[data-action]")?.dataset.action;
  if (action === "start") return startPlatform(platform);
  if (action === "stop") return stopPlatform(platform);
  if (action === "qty") return toggleQtyMode(platform);
  if (action === "register") return registerProduct(platform);
  if (action === "product-shot") return captureProductShot(platform);
  if (action === "reset-products") return resetLaneProducts(platform);
  if (action === "clear-chat") return clearLaneChats(platform);
  const removeKey = ev.target?.dataset?.remove;
  if (removeKey) {
    const chip = ev.target.closest(".product-chip");
    const label = (chip?.textContent || "").replace("삭제", "").trim() || "이 상품";
    return removeLaneProduct(platform, removeKey, label);
  }
  const chip = ev.target.closest(".product-chip");
  const shot = chip?.dataset?.shot;
  if (shot && canUseShots()) {
    const href = orderShotHref(shot, chip.dataset.session);
    if (href) window.open(href, "_blank", "noopener");
    else alert("캡처 파일을 열 수 없습니다. 수집 화면에서 다시 열어 보세요.");
  }
});

$("deskPage").addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  const role = ev.target?.dataset?.role;
  if (!["name", "number", "size", "color", "qty", "price", "stock"].includes(role)) return;
  const platform = ev.target.closest("[data-platform]")?.dataset.platform;
  if (!platform) return;
  ev.preventDefault();
  registerProduct(platform);
});

$("deskPage").addEventListener("focusin", (ev) => {
  const platform = ev.target.closest("[data-platform]")?.dataset.platform;
  if (platform) state.activePlatform = platform;
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "F2") return;
  if ($("appView").classList.contains("hidden")) return;
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (typing && !document.activeElement.closest("#deskPage")) return;
  e.preventDefault();
  const platform = document.activeElement?.closest?.("[data-platform]")?.dataset.platform || state.activePlatform;
  captureProductShot(platform);
});

function exportStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function exportSellerTag(user) {
  return String(user?.username || user?.name || (user?.id != null ? `id${user.id}` : "seller"))
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "seller";
}

function exportFileName(kind, user = state.user) {
  return `${exportStamp()}_${exportSellerTag(user)}_${kind}.xlsx`;
}

async function downloadFile(url, filename) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    let message = "다운로드에 실패했습니다.";
    try {
      const data = await res.json();
      if (data.message) message = data.message;
    } catch {}
    throw new Error(message);
  }
  const blob = await res.blob();
  const fileUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = fileUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(fileUrl);
}

function exportTargets() {
  const lives = liveSessions();
  if (lives.length) return lives;
  return state.lastSession?.id ? [state.lastSession] : [];
}

$("excelBtn").onclick = async () => {
  const targets = exportTargets();
  if (!targets.length) return alert("받을 방송이 없습니다. 먼저 수집을 한 번 하세요.");
  try {
    for (const session of targets) {
      const kind = session.platform ? `orders-${session.platform}` : "orders";
      await downloadFile(`/api/sessions/${session.id}/export/excel`, exportFileName(kind));
    }
  } catch (err) {
    alert(err.message);
  }
};

async function downloadChatExcel() {
  try {
    await downloadFile("/api/export/chats", exportFileName("chats"));
  } catch (err) {
    alert(err.message);
  }
}

$("chatExcelFilesBtn").onclick = downloadChatExcel;
$("shotsBtn").onclick = loadShots;

$("invoiceBtn").onclick = async () => {
  const targets = exportTargets();
  if (!targets.length) return alert("받을 방송이 없습니다. 먼저 수집을 한 번 하세요.");
  const blocks = [];
  for (const session of targets) {
    const data = await api(`/api/sessions/${session.id}/export/invoices`);
    const files = data.files || [];
    const label = platformLabel(session.platform) || "방송";
    blocks.push(`<p class="register-hint">${label} 구매자별 정산서입니다. 이미지를 받아 고객에게 메일이나 카톡으로 보낼 수 있습니다.</p>`);
    blocks.push(files.length
      ? files.map((file) => {
          const buyer = String(file).replace(/^정산서_/, "").replace(/\.jpg$/i, "");
          return `<div class="file-item"><span>${escapeAttr(label)} · ${escapeAttr(buyer)}</span><button type="button" class="ghost-btn invoice-download" data-session="${escapeAttr(session.id)}" data-file="${escapeAttr(file)}">다운로드</button></div>`;
        }).join("")
      : `<div class="file-item">${label} 접수된 주문이 없어 정산서가 없습니다.</div>`);
  }
  $("fileList").innerHTML = blocks.join("") || "<div class='file-item'>생성된 정산서가 없습니다.</div>";
};

$("fileList").addEventListener("click", async (ev) => {
  const button = ev.target.closest(".invoice-download");
  if (!button) return;
  try {
    await downloadFile(
      `/api/sessions/${encodeURIComponent(button.dataset.session)}/invoices/${encodeURIComponent(button.dataset.file)}`,
      button.dataset.file
    );
  } catch (err) {
    alert(err.message);
  }
});

$("addUserBtn").onclick = async () => {
  try {
    const body = {
      username: $("newUser").value,
      name: $("newName").value,
      role: $("newRole").value,
      status: $("newStatus").value,
      expireDate: $("newExpire").value,
      license: $("newLicense").value,
      mailTo: $("newMail").value
    };
    if ($("newPass").value) body.password = $("newPass").value;
    if (state.editingUserId) {
      await api(`/api/admin/users/${state.editingUserId}`, { method: "PATCH", body });
    } else {
      if (!body.password) return alert("비밀번호를 입력하세요.");
      await api("/api/admin/users", { method: "POST", body });
    }
    resetUserForm();
    await loadAdmin();
  } catch (err) {
    alert(err.message);
  }
};

$("cancelEditBtn").onclick = resetUserForm;

$("accountListBtn").onclick = async () => {
  try {
    await downloadFile("/api/admin/accounts.csv", "livora-accounts.csv");
  } catch (err) {
    alert(err.message);
  }
};

$("accountBackupBtn").onclick = async () => {
  try {
    const data = await api("/api/admin/accounts-backup");
    const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: "application/json" });
    const fileUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = fileUrl;
    a.download = `livora-accounts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(fileUrl);
  } catch (err) {
    alert(err.message);
  }
};

$("accountRestoreFile").onchange = async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    const data = await api("/api/admin/accounts-restore", { method: "POST", body: { backup } });
    alert(`${data.added || 0}개 계정을 복구했습니다.`);
    await loadAdmin();
  } catch (err) {
    alert(err.message || "복구 파일을 읽지 못했습니다.");
  }
};

$("userList").addEventListener("click", async (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  if (editId) {
    const user = state.adminUsers.find((u) => String(u.id) === String(editId));
    if (user) fillUserForm(user);
    return;
  }
  if (!delId) return;
  const user = state.adminUsers.find((u) => String(u.id) === String(delId));
  if (!confirm(`${user?.username || "이 계정"}을 삭제할까요?\n채널 승인과 주문·채팅도 함께 삭제됩니다.`)) return;
  try {
    await api(`/api/admin/users/${delId}`, { method: "DELETE" });
    if (String(state.editingUserId) === String(delId)) resetUserForm();
    await loadAdmin();
  } catch (err) {
    alert(err.message);
  }
});

$("addChannelBtn").onclick = async () => {
  try {
    await api("/api/admin/channels", {
      method: "POST",
      body: {
        userId: Number($("channelUser").value),
        platform: $("channelPlatform").value,
        channelId: $("channelId").value,
        label: $("channelLabel").value
      }
    });
    $("channelId").value = "";
    loadAdmin();
  } catch (err) {
    alert(err.message);
  }
};

$("sellerDataUser").onchange = () => {
  $("sellerDataSession").innerHTML = "";
  loadSellerData().catch((err) => alert(err.message));
};

$("adminFileUser").onchange = () => {
  loadAdminFiles().catch((err) => alert(err.message));
};

$("adminFileList").addEventListener("click", async (e) => {
  const id = e.target.dataset.adminFile;
  if (!id) return;
  try {
    await downloadFile(`/api/admin/files/${id}`, e.target.dataset.adminFileName || "file");
  } catch (err) {
    alert(err.message);
  }
});

$("sellerDataSession").onchange = () => {
  loadSellerData().catch((err) => alert(err.message));
};

function selectedSellerUser() {
  const id = Number($("sellerDataUser").value);
  return state.adminUsers.find((u) => Number(u.id) === id) || { id, username: `id${id}` };
}

$("sellerExcelBtn").onclick = async () => {
  const sessionId = $("sellerDataSession").value;
  if (!sessionId) return alert("방송 기록이 없습니다.");
  try {
    await downloadFile(`/api/sessions/${sessionId}/export/excel`, exportFileName("orders", selectedSellerUser()));
  } catch (err) {
    alert(err.message);
  }
};

$("sellerChatExcelBtn").onclick = async () => {
  const userId = $("sellerDataUser").value;
  if (!userId) return alert("셀러를 선택하세요.");
  try {
    await downloadFile(`/api/admin/users/${userId}/export/chats`, exportFileName("chats", selectedSellerUser()));
  } catch (err) {
    alert(err.message);
  }
};

$("channelList").addEventListener("click", async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  await fetch(`/api/admin/channels/${id}`, { method: "DELETE", credentials: "include" });
  loadAdmin();
});

api("/api/me").then(bootApp).catch(() => show("login"));
