const state = {
  user: null,
  session: null,
  channels: [],
  chats: [],
  orders: [],
  products: [],
  guessOnly: false,
  editingUserId: null,
  adminUsers: [],
  lastSession: null,
  adminStatsTimer: null
};

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
  if (page === "admin") loadAdminStats();
}

function platformLabel(platform) {
  if (platform === "youtube") return "유튜브";
  if (platform === "tiktok") return "틱톡";
  return platform || "";
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
    $("channelIdsHint").textContent = isAdmin
      ? `승인된 전체 채널: ${bits.join(" · ")}`
      : `이 계정 채널: ${bits.join(" · ")}`;
  } else {
    $("channelIdsHint").textContent = isAdmin
      ? "승인된 틱톡/유튜브 채널이 없습니다."
      : "이 계정에 승인된 틱톡/유튜브 ID가 없습니다. 관리자에게 승인을 요청하세요.";
  }
}

function renderChats() {
  $("chatList").innerHTML = state.chats.slice(-80).reverse().map((c) => `
    <div class="chat-row ${c.is_order || c.isOrder ? "order" : ""}">
      <b>${c.nick || ""}</b>${c.msg || ""}
    </div>
  `).join("");
}

function matchSourceLabel(source) {
  return {
    "qty-mode": "이거모드",
    current: "현재상품 추정",
    follow: "따라가기",
    alias: "별칭",
    named: "상품명",
    option: "옵션",
    number: "번호"
  }[source] || "";
}

function isInferredOrder(o) {
  if (o.inferred === true || o.inferred === 1) return true;
  const src = o.matchSource || o.match_source || "";
  return Boolean(src) && src !== "named" && src !== "number";
}

function renderOrders() {
  const all = state.orders;
  const rows = state.guessOnly ? all.filter(isInferredOrder) : all;
  $("liveOrders").innerHTML = all.slice(0, 80).map((o) => {
    const inferred = isInferredOrder(o);
    const src = matchSourceLabel(o.matchSource || o.match_source);
    const chat = o.msg || o.message || "";
    return `
    <div class="order-row ${inferred ? "guess" : ""}">
      <b>${o.nick || o.nickname || ""}</b>
      ${o.product || ""} ${o.option_name || o.option || ""} · ${o.qty}개 · ${(o.amount || 0).toLocaleString("ko-KR")}원
      ${src ? `<span class="match-tag ${inferred ? "guess" : ""}">${inferred ? "추정 · " : ""}${src}</span>` : ""}
      ${chat ? `<small>채팅: ${chat}</small>` : ""}
    </div>`;
  }).join("");
  $("orderTable").innerHTML = rows.map((o) => {
    const inferred = isInferredOrder(o);
    const src = matchSourceLabel(o.matchSource || o.match_source) || "-";
    return `
    <tr>
      <td>${o.nick || o.nickname || ""}</td>
      <td>${o.product || ""}</td>
      <td>${o.option_name || o.option || ""}</td>
      <td>${o.qty}</td>
      <td>${(o.amount || 0).toLocaleString("ko-KR")}원</td>
      <td>${inferred ? `추정 · ${src}` : src}</td>
      <td>${o.msg || o.message || ""}</td>
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
  const session = exportSession();
  if (!session) {
    hint.textContent = "아직 받을 방송이 없습니다. 수집을 한 번 하면 종료 후에도 받을 수 있습니다.";
    return;
  }
  const live = Boolean(state.session);
  hint.textContent = live
    ? `지금 방송: ${platformLabel(session.platform)} ${session.channelId || session.channel_id || ""}`
    : `직전 방송: ${platformLabel(session.platform)} ${session.channelId || session.channel_id || ""} · 다음 수집 전까지 이 방송을 받습니다.`;
}

function setLiveBadge() {
  const live = Boolean(state.session);
  $("liveBadge").textContent = live ? `${platformLabel(state.session.platform)} ${state.session.channelId}` : "대기";
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
        is_order: msg.payload.isOrder
      });
      renderChats();
    }
    if (msg.type === "order") {
      const incoming = {
        uid: msg.payload.uid,
        nick: msg.payload.nickname,
        product: msg.payload.product,
        option_name: msg.payload.option,
        qty: msg.payload.qty,
        amount: msg.payload.amount,
        msg: msg.payload.message,
        matchSource: msg.payload.matchSource,
        inferred: msg.payload.inferred
      };
      const idx = state.orders.findIndex((o) => o.uid === incoming.uid && o.product === incoming.product && (o.option_name || "") === (incoming.option_name || ""));
      if (idx >= 0) state.orders[idx] = incoming;
      else state.orders.unshift(incoming);
      renderOrders();
    }
    if (msg.type === "status") {
      if (msg.payload.status === "connected") $("liveBadge").textContent = "LIVE";
      if (msg.payload.status === "error") $("liveBadge").textContent = String(msg.payload.error || "오류").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    if (msg.type === "product") {
      upsertProduct(msg.payload);
      setCurrentProduct(msg.payload, msg.payload.qtyMode);
      if (msg.payload.qtyMode?.enabled) $("qtyBtn").textContent = "이거모드 ON";
    }
    if (msg.type === "product-removed") {
      applyProductState(msg.payload.products, msg.payload.qtyMode);
    }
  };
}

async function bootApp() {
  const data = await api("/api/me");
  state.user = data.user;
  state.channels = data.channels || [];
  state.session = data.session;
  setLastSession(data.session || data.lastSession);
  $("sideName").textContent = data.user.name;
  $("sideMeta").textContent = `${data.user.role} · ${data.user.expireDate || ""}`;
  $("adminNavWrap").classList.toggle("hidden", data.user.role !== "admin");
  renderChannels();
  setLiveBadge();
  if (state.session) {
    const cur = await api("/api/sessions/current");
    state.chats = cur.chats || [];
    state.orders = cur.orders || [];
    renderChats();
    renderOrders();
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
    "seller-data": "adminTabSellerData"
  };
  Object.entries(pages).forEach(([name, id]) => {
    $(id).classList.toggle("hidden", name !== tab);
  });
  document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.adminTab === tab);
  });
  if (tab === "seller-data" && $("sellerDataUser").value) loadSellerData();
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
      <span>${escapeAttr(u.username)} · ${escapeAttr(u.role)} · ${escapeAttr(u.status)}</span>
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
  await loadAdminStats();
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

$("loginBtn").onclick = async () => {
  $("loginError").textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: { username: $("loginId").value, password: $("loginPw").value }
    });
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

$("platformSelect").onchange = renderChannelIds;

$("startBtn").onclick = async () => {
  const platform = $("platformSelect").value;
  const channelId = $("channelSelect").value;
  if (!platform || !channelId) return alert("승인된 채널이 없습니다.");
  try {
    const data = await api("/api/sessions/start", { method: "POST", body: { platform, channelId } });
    state.session = data.session;
    setLastSession(data.session);
    state.chats = [];
    state.orders = [];
    renderChats();
    renderOrders();
    setLiveBadge();
  } catch (err) {
    alert(err.message);
  }
};

$("stopBtn").onclick = async () => {
  const data = await api("/api/sessions/stop", { method: "POST" });
  setLastSession(data.lastSession || data.session || state.session);
  state.session = null;
  setLiveBadge();
};

function productKey(p) {
  if (p?.key) return p.key;
  if (p?.type === "number" || p?.number) return `N:${p.number}`;
  if (p?.type === "option" || p?.options || p?.options_json) return `O:${p.product}`;
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
  const current = qtyMode?.product
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
    items.push({ ...p, key, name, current: name === current });
  }
  el.innerHTML = items.map((p) => {
    const extra = [p.sizes?.length ? p.sizes.join("/") : "", p.colors?.length ? p.colors.join("/") : ""].filter(Boolean).join(" ");
    return `
      <span class="product-chip ${p.current ? "current" : ""}" data-key="${p.key}">
        ${p.name}${extra ? ` ${extra}` : ""}${p.current ? " · 현재" : ""}
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
      body: { name, number, size, color, qty, price, stock }
    });
    if (data.skipped) return;
    ["productName", "productNumber", "productSize", "productColor", "productQty", "productPrice", "productStock"].forEach((id) => {
      $(id).value = "";
    });
    upsertProduct(data.registration);
    setCurrentProduct(data.registration, data.qtyMode);
    if (data.qtyMode?.enabled) $("qtyBtn").textContent = "이거모드 ON";
  } catch (err) {
    alert(err.message);
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
      body: { key }
    });
    applyProductState(data.products, data.qtyMode);
  } catch (err) {
    alert(err.message);
  }
};

$("qtyBtn").onclick = async () => {
  try {
    const data = await api("/api/sessions/qty-mode", { method: "POST" });
    $("qtyBtn").textContent = data.qtyMode?.enabled ? "이거모드 ON" : "이거모드";
  } catch (err) {
    alert(err.message);
  }
};

$("guessOnly").onchange = () => {
  state.guessOnly = $("guessOnly").checked;
  renderOrders();
};

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
    await downloadFile(`/api/sessions/${session.id}/export/excel`, "livora-orders.xlsx");
  } catch (err) {
    alert(err.message);
  }
};

async function downloadChatExcel() {
  try {
    await downloadFile("/api/export/chats", `livora-chats-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    alert(err.message);
  }
}

$("chatExcelFilesBtn").onclick = downloadChatExcel;

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
      expireDate: $("newExpire").value
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

$("sellerDataSession").onchange = () => {
  loadSellerData().catch((err) => alert(err.message));
};

$("sellerExcelBtn").onclick = async () => {
  const sessionId = $("sellerDataSession").value;
  if (!sessionId) return alert("방송 기록이 없습니다.");
  try {
    await downloadFile(`/api/sessions/${sessionId}/export/excel`, "livora-orders.xlsx");
  } catch (err) {
    alert(err.message);
  }
};

$("sellerChatExcelBtn").onclick = async () => {
  const userId = $("sellerDataUser").value;
  if (!userId) return alert("셀러를 선택하세요.");
  try {
    await downloadFile(`/api/admin/users/${userId}/export/chats`, "livora-chats.xlsx");
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
