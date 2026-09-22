const state = {
  user: null,
  session: null,
  sessions: [],
  channels: [],
  chats: [],
  orders: [],
  products: [],
  reviews: [],
  guessOnly: false,
  editingUserId: null,
  adminUsers: [],
  lastSession: null,
  adminStatsTimer: null,
  screenCapture: localStorage.getItem("livoraScreenCapture") !== "0",
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

function selectedPlatform() {
  return $("platformSelect").value;
}

function platformBody(extra = {}) {
  return { platform: selectedPlatform(), ...extra };
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
  const platforms = [...new Set(state.channels.map((c) => c.platform))];
  const prev = $("platformSelect").value;
  $("platformSelect").innerHTML = platforms.length
    ? platforms.map((p) => `<option value="${escapeAttr(p)}">${platformLabel(p)}</option>`).join("")
    : `<option value="">플랫폼 없음</option>`;
  if (prev && platforms.includes(prev)) $("platformSelect").value = prev;
  renderChannelIds();
}

function renderChannelIds() {
  const platform = $("platformSelect").value;
  const isAdmin = state.user?.role === "admin";
  const list = state.channels.filter((c) => c.platform === platform);
  const seen = new Set();
  const unique = [];
  for (const c of list) {
    if (seen.has(c.channel_id)) continue;
    seen.add(c.channel_id);
    unique.push(c);
  }
  const prev = $("channelSelect").value;
  $("channelSelect").innerHTML = unique.length
    ? unique.map((c) => {
      const owner = c.username || c.user_name || "";
      const title = c.label || c.channel_id;
      const label = isAdmin && owner ? `${title} · ${owner}` : title;
      return `<option value="${escapeAttr(c.channel_id)}">${escapeAttr(label)}</option>`;
    }).join("")
    : `<option value="">승인된 ID 없음</option>`;
  if (prev && unique.some((c) => c.channel_id === prev)) $("channelSelect").value = prev;

  const tiktok = [...new Set(state.channels.filter((c) => c.platform === "tiktok").map((c) => c.channel_id))];
  const youtube = [...new Set(state.channels.filter((c) => c.platform === "youtube").map((c) => c.channel_id))];
  const bits = [];
  if (tiktok.length) bits.push(`틱톡 ${tiktok.join(", ")}`);
  if (youtube.length) bits.push(`유튜브 ${youtube.join(", ")}`);
  if (bits.length) {
    $("channelIdsHint").textContent = `${isAdmin
      ? `승인된 전체 채널: ${bits.join(" · ")}`
      : `이 계정 채널: ${bits.join(" · ")}`} · 틱톡과 유튜브를 동시에 켤 수 있습니다. 상품 등록은 지금 고른 플랫폼에만 적용됩니다.`;
  } else {
    $("channelIdsHint").textContent = isAdmin
      ? "승인된 틱톡/유튜브 채널이 없습니다."
      : "이 계정에 승인된 틱톡/유튜브 ID가 없습니다. 관리자에게 승인을 요청하세요.";
  }
}

function renderChats() {
  $("chatList").innerHTML = state.chats.slice(-80).reverse().map((c) => `
    <div class="chat-row ${c.is_order || c.isOrder ? "order" : ""} ${c.kind === "cancel" ? "cancel" : ""}">
      ${platformTag(c.platform)}<b>${c.nick || ""}</b>${c.msg || ""}
    </div>
  `).join("");
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

function orderShotHref(file) {
  if (!canUseShots()) return "";
  const session = exportSession();
  if (!session?.id || !file) return "";
  return `/api/sessions/${session.id}/shots/${encodeURIComponent(file)}`;
}

function setShotButton() {
  if (!$("shotBtn")) return;
  const on = canUseShots() && state.screenCapture !== false;
  $("shotBtn").textContent = on ? "화면캡처 ON" : "화면캡처";
  $("shotBtn").classList.toggle("on", on);
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

function renderOrders() {
  const all = state.orders;
  const rows = state.guessOnly ? all.filter(isInferredOrder) : all;
  $("liveOrders").innerHTML = all.slice(0, 80).map((o) => {
    const inferred = isInferredOrder(o);
    const src = matchSourceLabel(o.matchSource || o.match_source);
    const chat = o.msg || o.message || "";
    const shot = orderShotName(o);
    const href = orderShotHref(shot);
    return `
    <div class="order-row ${inferred ? "guess" : ""}">
      ${platformTag(o.platform)}
      <b>${o.nick || o.nickname || ""}</b>
      ${o.product || ""} ${o.option_name || o.option || ""} · ${o.qty}개 · ${(o.amount || 0).toLocaleString("ko-KR")}원
      ${src ? `<span class="match-tag ${inferred ? "guess" : ""}">${inferred ? "추정 · " : ""}${src}</span>` : ""}
      ${href ? `<a class="shot-link" href="${href}" target="_blank" rel="noopener">캡처</a>` : ""}
      <button type="button" class="label-reprint" data-label-nick="${escapeAttr(o.nick || o.nickname || "")}" data-label-product="${escapeAttr(o.product || "")}" data-label-option="${escapeAttr(optionText(o))}" data-label-qty="${labelCopies(o.qty) || 1}">라벨</button>
      ${chat ? `<small>채팅: ${chat}</small>` : ""}
    </div>`;
  }).join("");
  $("orderTable").innerHTML = rows.map((o) => {
    const inferred = isInferredOrder(o);
    const src = matchSourceLabel(o.matchSource || o.match_source) || "-";
    const shot = orderShotName(o);
    const href = orderShotHref(shot);
    return `
    <tr>
      <td>${o.nick || o.nickname || ""}</td>
      <td>${o.product || ""}</td>
      <td>${o.option_name || o.option || ""}</td>
      <td>${o.qty}</td>
      <td>${(o.amount || 0).toLocaleString("ko-KR")}원</td>
      <td>${inferred ? `추정 · ${src}` : src}</td>
      <td>${o.msg || o.message || ""}</td>
      <td class="shot-col">${href ? `<a class="shot-link" href="${href}" target="_blank" rel="noopener">보기</a>` : "-"}</td>
      <td><button type="button" class="label-reprint" data-label-nick="${escapeAttr(o.nick || o.nickname || "")}" data-label-product="${escapeAttr(o.product || "")}" data-label-option="${escapeAttr(optionText(o))}" data-label-qty="${labelCopies(o.qty) || 1}">라벨</button></td>
    </tr>`;
  }).join("");
  const buyers = new Set(all.map((o) => o.uid || o.nick)).size;
  $("statBuyers").textContent = buyers;
  $("statOrders").textContent = all.length;
  $("statAmount").textContent = all.reduce((s, o) => s + Number(o.amount || 0), 0).toLocaleString("ko-KR");
}

function exportSession() {
  return state.session || state.lastSession;
}

function setLastSession(session) {
  if (session?.id) state.lastSession = session;
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
  hint.textContent = `직전 방송: ${platformLabel(session.platform)} ${session.channelId || session.channel_id || ""} · 다음 수집 전까지 이 방송을 받습니다.`;
}

function setLiveBadge() {
  const lives = liveSessions();
  const live = lives.length > 0;
  $("liveBadge").textContent = live
    ? lives.map((row) => `${platformLabel(row.platform)} ${row.channelId || row.channel_id || ""}`).join(" · ")
    : "대기";
  $("liveBadge").classList.toggle("live", live);
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
          if (!sameUser || !sameProduct) return true;
          if (p.option) return !sameOption;
          return false;
        });
      } else if (p.qty != null) {
        const idx = state.orders.findIndex((o) =>
          String(o.uid || "") === String(p.uid || "") &&
          (o.product || "") === (p.product || "") &&
          (o.option_name || o.option || "") === (p.option || "")
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
    if (msg.type === "stock-block") {
      const p = msg.payload || {};
      $("currentProduct").textContent = `재고 초과: ${p.nickname || ""} / ${p.product || ""} / 남은 ${p.remain ?? 0}개`;
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
        sessionId: msg.payload.sessionId
      };
      if (state.labelPrint) enqueueLabel(msg.payload, msg.payload.printQty ?? incoming.qty);
      const idx = state.orders.findIndex((o) =>
        o.uid === incoming.uid &&
        o.product === incoming.product &&
        (o.option_name || "") === (incoming.option_name || "") &&
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
      const idx = state.orders.findIndex((o) => o.uid === p.uid && o.product === p.product && (o.option_name || o.option || "") === (p.option || ""));
      if (idx >= 0) {
        state.orders[idx].shotFile = p.shotFile;
        state.orders[idx].shot_path = p.shotFile;
        renderOrders();
      }
    }
    if (msg.type === "shot-status" && msg.payload && !msg.payload.ok) {
      $("shotHint").textContent = msg.payload.error || "화면 캡처에 실패했습니다. Livora가 켜진 이 컴퓨터 화면만 찍을 수 있습니다.";
    }
    if (msg.type === "status") {
      if (msg.payload.platform) {
        const current = state.sessions.find((row) => row.platform === msg.payload.platform);
        if (current) upsertSession({ ...current, status: msg.payload.status === "error" ? "running" : current.status, error: msg.payload.error || "" });
      }
      setLiveBadge();
      if (msg.payload.status === "error") {
        $("liveBadge").textContent = String(msg.payload.error || "오류").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        $("liveBadge").classList.add("live");
      }
    }
    if (msg.type === "product") {
      if (msg.payload.platform && msg.payload.platform !== selectedPlatform()) return;
      upsertProduct(msg.payload);
      setCurrentProduct(msg.payload, msg.payload.qtyMode);
      if (msg.payload.qtyMode?.enabled) $("qtyBtn").textContent = "이거모드 ON";
    }
    if (msg.type === "product-removed") {
      if (msg.payload.platform && msg.payload.platform !== selectedPlatform()) return;
      applyProductState(msg.payload.products, msg.payload.qtyMode);
    }
    if (msg.type === "products-reset") {
      if (msg.payload.platform && msg.payload.platform !== selectedPlatform()) return;
      applyProductState([], msg.payload?.qtyMode);
    }
  };
}

async function bootApp() {
  const data = await api("/api/me");
  state.user = data.user;
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
  if (state.session?.platform) $("platformSelect").value = state.session.platform;
  renderChannelIds();
  setLiveBadge();
  setShotButton();
  setLabelButton();
  if (liveSessions().length || state.session) {
    const cur = await api(`/api/sessions/current${selectedPlatform() ? `?platform=${encodeURIComponent(selectedPlatform())}` : ""}`);
    state.sessions = cur.sessions || state.sessions;
    state.session = cur.session || state.session;
    state.chats = cur.chats || [];
    state.orders = cur.orders || [];
    state.reviews = cur.reviews || cur.session?.snapshot?.reviews || [];
    if (cur.session?.screenCapture != null) {
      state.screenCapture = cur.session.screenCapture;
      setShotButton();
    }
    renderChats();
    renderOrders();
    renderReviews();
    const snap = cur.session?.snapshot;
    state.products = snap?.products || cur.products || [];
    if (snap?.qtyMode?.product) setCurrentProduct(snap.products?.find((p) => (p.product || p.number) === snap.qtyMode.product) || snap.products?.[0], snap.qtyMode);
    else renderProductHistory();
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
        <div class="order-row"><b>${escapeAttr(o.nick || "")}</b>${escapeAttr(o.product || "")} ${escapeAttr(o.option_name || o.color || "")} ${o.qty || 0}개</div>
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

$("platformSelect").onchange = async () => {
  renderChannelIds();
  const live = liveSessions().find((row) => row.platform === selectedPlatform());
  state.session = live || state.session;
  if (!live) {
    applyProductState([], null);
    return;
  }
  const snap = live.snapshot;
  state.products = snap?.products || [];
  if (snap?.qtyMode?.product) setCurrentProduct(snap.products?.find((p) => (p.product || p.number) === snap.qtyMode.product) || snap.products?.[0], snap.qtyMode);
  else applyProductState(state.products, snap?.qtyMode);
};

$("startBtn").onclick = async () => {
  const platform = $("platformSelect").value;
  const channelId = $("channelSelect").value;
  if (!platform || !channelId) return alert("승인된 채널이 없습니다.");
  try {
    const data = await api("/api/sessions/start", {
      method: "POST",
      body: { platform, channelId, screenCapture: canUseShots() && state.screenCapture !== false }
    });
    state.sessions = data.sessions || [];
    upsertSession(data.session);
    if (data.session?.screenCapture != null) state.screenCapture = data.session.screenCapture;
    setShotButton();
    setLastSession(data.session);
    state.chats = state.chats.filter((c) => c.platform && c.platform !== platform);
    state.orders = state.orders.filter((o) => o.platform && o.platform !== platform);
    state.reviews = state.reviews.filter((r) => r.platform && r.platform !== platform);
    state.products = [];
    applyProductState([], null);
    renderChats();
    renderOrders();
    renderReviews();
    setLiveBadge();
  } catch (err) {
    alert(err.message);
  }
};

$("stopBtn").onclick = async () => {
  const platform = selectedPlatform();
  const data = await api("/api/sessions/stop", { method: "POST", body: { platform } });
  setLastSession(data.lastSession || data.session || state.session);
  state.sessions = data.sessions || [];
  state.session = state.sessions.find((row) => row.platform === platform) || data.session || state.sessions[0] || null;
  setLiveBadge();
  $("filesHint").textContent = `${platformLabel(platform)} 종료 저장이 끝났습니다. 엑셀·정산서·채팅 파일을 받으세요.`;
};

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

function upsertProduct(reg) {
  if (!reg) return;
  const key = productKey(reg);
  const idx = state.products.findIndex((p) => productKey(p) === key);
  if (idx >= 0) state.products[idx] = { ...state.products[idx], ...reg, key };
  else state.products.unshift({ ...reg, key });
}

function applyProductState(products, qtyMode) {
  if (Array.isArray(products)) state.products = products.map((p) => ({ ...p, key: productKey(p) }));
  const current = qtyMode?.key
    ? state.products.find((p) => productKey(p) === qtyMode.key)
    : qtyMode?.product
    ? state.products.find((p) => (p.product || p.number) === qtyMode.product)
    : null;
  setCurrentProduct(current, qtyMode);
  if (qtyMode) $("qtyBtn").textContent = qtyMode.enabled ? "이거모드 ON" : "이거모드";
}

function renderProductHistory(qtyMode) {
  const el = $("productList");
  if (!el) return;
  const current = qtyMode?.product || "";
  const seen = new Set();
  const items = [];
  for (const p of state.products) {
    const key = productKey(p);
    const name = p.product || p.number || "";
    if (!name || seen.has(key || name)) continue;
    seen.add(key || name);
    items.push({ ...p, key, name, current: (qtyMode?.key && key === qtyMode.key) || (!qtyMode?.key && name === current) });
  }
  el.innerHTML = items.map((p) => {
    const extra = [
      p.sizes?.length ? p.sizes.join("/") : (p.options || []).join("/"),
      p.colors?.length ? p.colors.join("/") : "",
      Number(p.price) ? `${Number(p.price).toLocaleString("ko-KR")}원` : ""
    ].filter(Boolean).join(" ");
    return `
      <span class="product-chip ${p.current ? "current" : ""}" data-key="${escapeAttr(p.key)}">
        ${escapeAttr(p.name)}${extra ? ` ${escapeAttr(extra)}` : ""}${p.current ? " · 현재" : ""}
        <button type="button" data-remove="${p.key}">삭제</button>
      </span>`;
  }).join("");
}

function setCurrentProduct(reg, qtyMode) {
  const product = reg?.displayName || qtyMode?.product;
  if (!product) {
    $("currentProduct").textContent = "현재 등록 상품 없음";
    renderProductHistory(qtyMode);
    return;
  }
  const price = Number(reg?.price ?? qtyMode?.price ?? 0);
  const stock = Number(reg?.stock ?? qtyMode?.stock ?? 0);
  const bits = [product];
  const sizes = (reg?.sizes || []).join("/");
  const colors = (reg?.colors || []).join("/");
  if (sizes) bits.push(sizes);
  if (colors) bits.push(colors);
  const defaultQty = Number(reg?.defaultQty ?? qtyMode?.defaultQty ?? 1);
  if (defaultQty > 1) bits.push(`수량 ${defaultQty}`);
  if (price) bits.push(`${price.toLocaleString("ko-KR")}원`);
  if (stock) bits.push(`재고 ${stock}`);
  $("currentProduct").textContent = `현재상품: ${bits.join(" · ")}`;
  renderProductHistory(qtyMode);
}

$("registerBtn").onclick = async () => {
  const name = $("productName").value.trim();
  const number = $("productNumber").value.trim();
  const size = $("productSize").value.trim();
  const color = $("productColor").value.trim();
  const qty = $("productQty").value.trim();
  const price = $("productPrice").value.trim();
  const stock = $("productStock").value.trim();
  if (!name && !number && !size && !color && !qty && !price && !stock) return;
  try {
    const data = await api("/api/sessions/products", {
      method: "POST",
      body: platformBody({ name, number, size, color, qty, price, stock })
    });
    if (data.skipped) return;
    ["productName", "productNumber", "productSize", "productColor", "productQty", "productPrice", "productStock"].forEach((id) => {
      $(id).value = "";
    });
    upsertProduct(data.registration);
    setCurrentProduct(data.registration, data.qtyMode);
    if (data.qtyMode?.enabled) $("qtyBtn").textContent = "이거모드 ON";
  } catch (err) {
    const message = String(err.message || "").trim();
    alert(message === "요청 실패" || /failed to fetch/i.test(message)
      ? "상품을 등록하지 못했습니다. 수집이 켜져 있는지 확인한 뒤 다시 등록하세요."
      : message);
  }
};

["productName", "productNumber", "productSize", "productColor", "productQty", "productPrice", "productStock"].forEach((id) => {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("registerBtn").click();
  });
});

$("productList").onclick = async (ev) => {
  const key = ev.target?.dataset?.remove;
  if (!key) return;
  const chip = ev.target.closest(".product-chip");
  const label = (chip?.textContent || "").replace("삭제", "").trim() || "이 상품";
  if (!confirm(`${label}\n등록에서 삭제할까요? 이미 접수된 주문은 그대로 둡니다.`)) return;
  try {
    const data = await api("/api/sessions/products/remove", {
      method: "POST",
      body: platformBody({ key })
    });
    applyProductState(data.products, data.qtyMode);
  } catch (err) {
    alert(err.message);
  }
};

$("resetProductsBtn").onclick = async () => {
  if (!confirm("등록한 상품을 모두 지울까요? 이미 접수된 주문은 그대로 둡니다.")) return;
  try {
    const data = await api("/api/sessions/products/reset", { method: "POST", body: platformBody() });
    applyProductState(data.products || [], data.qtyMode);
  } catch (err) {
    alert(err.message);
  }
};

$("qtyBtn").onclick = async () => {
  try {
    const data = await api("/api/sessions/qty-mode", { method: "POST", body: platformBody() });
    $("qtyBtn").textContent = data.qtyMode?.enabled ? "이거모드 ON" : "이거모드";
  } catch (err) {
    alert(err.message);
  }
};

$("shotBtn").onclick = async () => {
  if (!canUseShots()) return;
  const next = state.screenCapture === false;
  state.screenCapture = next;
  localStorage.setItem("livoraScreenCapture", next ? "1" : "0");
  setShotButton();
  if (!state.session) return;
  try {
    const data = await api("/api/sessions/screen-capture", { method: "POST", body: platformBody({ enabled: next }) });
    state.screenCapture = data.enabled !== false;
    setShotButton();
  } catch (err) {
    alert(err.message);
  }
};

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

$("liveOrders").addEventListener("click", handleLabelReprint);
$("orderTable").addEventListener("click", handleLabelReprint);

async function loadShots() {
  if (!canUseShots()) return;
  const session = exportSession();
  if (!session) return alert("받을 방송이 없습니다. 먼저 수집을 한 번 하세요.");
  try {
    const data = await api(`/api/sessions/${session.id}/shots`);
    $("fileList").innerHTML = (data.files || []).map((file) => `
      <a class="file-item" href="/api/sessions/${session.id}/shots/${encodeURIComponent(file)}" target="_blank">${file}</a>
    `).join("") || "<div class='file-item'>저장된 화면 캡처가 없습니다. 화면캡처를 켠 뒤 주문이 들어오면 여기에 쌓입니다.</div>";
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
      `금액 ${Number(a.amount || 0).toLocaleString("ko-KR")}원`
    ].join("\n");
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
  try {
    const q = selectedPlatform() ? `?platform=${encodeURIComponent(selectedPlatform())}` : "";
    const data = await api(`/api/sessions/summary${q}`);
    $("summaryBox").textContent = renderSummaryText(kind, data);
  } catch (err) {
    $("summaryBox").textContent = err.message;
  }
}

$("summaryAllBtn").onclick = () => showSummary("all");
$("summaryProductBtn").onclick = () => showSummary("product");
$("summaryBuyerBtn").onclick = () => showSummary("buyer");

$("clearChatBtn").onclick = async () => {
  if (!confirm("지금 고른 플랫폼의 채팅을 지울까요? 지운 채팅은 다시 불러오지 않습니다.")) return;
  try {
    await api("/api/sessions/chats/clear", { method: "POST", body: platformBody() });
    const platform = selectedPlatform();
    state.chats = state.chats.filter((c) => c.platform && c.platform !== platform);
    renderChats();
  } catch (err) {
    alert(err.message);
  }
};

$("clearOrdersBtn").onclick = async () => {
  if (!confirm("지금 고른 플랫폼의 주문 목록을 지울까요? 이미 받은 엑셀은 그대로입니다.")) return;
  try {
    await api("/api/sessions/orders/clear", { method: "POST", body: platformBody() });
    const platform = selectedPlatform();
    state.orders = state.orders.filter((o) => o.platform && o.platform !== platform);
    state.reviews = state.reviews.filter((r) => r.platform && r.platform !== platform);
    renderOrders();
    renderReviews();
    $("summaryBox").textContent = "주문 목록을 지웠습니다.";
  } catch (err) {
    alert(err.message);
  }
};

async function captureProductShot() {
  if (!canUseShots()) return;
  try {
    const data = await api("/api/sessions/product-shot", {
      method: "POST",
      body: platformBody({ name: $("productName").value.trim() || "F2" })
    });
    $("shotHint").textContent = `상품 확인 캡처 저장: ${data.shotFile}. 다음 상품 등록에 이 사진이 붙습니다.`;
  } catch (err) {
    alert(err.message);
  }
}

$("productShotBtn").onclick = captureProductShot;
document.addEventListener("keydown", (e) => {
  if (e.key !== "F2") return;
  if ($("appView").classList.contains("hidden")) return;
  e.preventDefault();
  captureProductShot();
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

$("excelBtn").onclick = async () => {
  const session = exportSession();
  if (!session) return alert("받을 방송이 없습니다. 먼저 수집을 한 번 하세요.");
  try {
    await downloadFile(`/api/sessions/${session.id}/export/excel`, exportFileName("orders"));
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
  const session = exportSession();
  if (!session) return alert("받을 방송이 없습니다. 먼저 수집을 한 번 하세요.");
  const data = await api(`/api/sessions/${session.id}/export/invoices`);
  $("fileList").innerHTML = (data.files || []).map((file) => `
    <a class="file-item" href="/api/sessions/${session.id}/invoices/${encodeURIComponent(file)}" target="_blank">${file}</a>
  `).join("") || "<div class='file-item'>생성된 정산서가 없습니다.</div>";
};

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
