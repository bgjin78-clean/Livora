const db = require("../db");
const {
  COLORS,
  SIZE_ALIAS,
  ORDER_SUFFIX_PATTERN,
  QUESTION_RE,
  CANCEL_WORDS,
  FOLLOW_WORDS,
  normalizeText,
  normalizeCompact,
  escapeRegex,
  hasOrderKeyword,
  isBrowseDesireOnly,
  isNonPurchaseRequest,
  stripIntentWords,
  now,
  makeChatId,
  normalizeOptionToSize,
  normalizeOptionToColor,
  getOptionAliases,
  extractFlexibleQty,
  splitOptions,
  composeRegistrationFields,
  parseRegistrationPayload,
  registrationKey,
  isManagerStyleMessage,
  hasExplicitQty,
  parseColorSizeQtyList,
  mentionsAssignedProduct,
  getOrderKey
} = require("./parse");

class OrderEngine {
  constructor({ sessionId, onEvent }) {
    this.sessionId = sessionId;
    this.onEvent = onEvent || (() => {});
    this.registrations = {};
    this.aliasMap = {};
    this.orders = {};
    this.recent = new Map();
    this.lastOrder = null;
    this.qtyMode = {
      enabled: false,
      product: "",
      price: 0,
      stock: 0,
      defaultQty: 1,
      shotFile: "",
      registeredAt: "",
      registeredAtMs: 0
    };
  }

  isDup(uid, msg) {
    const compact = normalizeCompact(msg);
    const key = `${uid}::${compact}`;
    const nowMs = Date.now();
    const isShortOrderLike =
      /^\.?\d+\.?$/.test(compact) ||
      /^\d+\.\d+$/.test(compact) ||
      /(\d+)\s+(\d+)/u.test(msg) ||
      /(\d+)\s*(개|장|세트|셋트|벌)/u.test(msg) ||
      /^[가-힣A-Za-z]+\d+$/u.test(compact);
    const blockMs = isShortOrderLike ? 800 : 300;
    if (this.recent.has(key) && nowMs - this.recent.get(key) < blockMs) return true;
    this.recent.set(key, nowMs);
    for (const [k, t] of this.recent.entries()) {
      if (nowMs - t > 6000) this.recent.delete(k);
    }
    return false;
  }

  getAllRegistrations() {
    return Object.values(this.registrations);
  }

  findRegistrationByProduct(productName) {
    return this.getAllRegistrations().find((reg) =>
      (reg.type === "product" || reg.type === "option") && reg.product === productName
    ) || null;
  }

  buildOptionOrder(reg, opt, qty) {
    return {
      product: reg.product,
      option: opt,
      color: normalizeOptionToColor(opt),
      size: normalizeOptionToSize(opt),
      qty: qty || 1,
      price: reg.price || 0,
      shotFile: reg.shotFile || ""
    };
  }

  parseAliasOrder(msg) {
    const text = normalizeText(msg);
    for (const alias of Object.keys(this.aliasMap)) {
      const mapped = this.aliasMap[alias];
      if (!mapped?.product) continue;
      const reg = this.findRegistrationByProduct(mapped.product);
      if (!reg) continue;
      if (text === alias || normalizeCompact(text) === normalizeCompact(alias)) {
        return {
          product: mapped.product, option: "", color: "", size: "",
          qty: 1, price: reg.price || 0, shotFile: reg.shotFile || ""
        };
      }
      if (normalizeCompact(text).startsWith(normalizeCompact(alias))) {
        return {
          product: mapped.product, option: "", color: "", size: "",
          qty: extractFlexibleQty(text.slice(alias.length).trim(), 1),
          price: reg.price || 0, shotFile: reg.shotFile || ""
        };
      }
    }
    return null;
  }

  parseNumberRegistrationOrder(reg, msg) {
    const text = normalizeText(msg);
    const compact = normalizeCompact(msg).toLowerCase();
    const num = String(reg.number || "");
    const headMatch = text.match(new RegExp(`^\\s*\\.*${escapeRegex(num)}\\.*(?:번)?(?=$|[^0-9])\\s*(.*)$`, "u"));
    if (!headMatch) return null;
    let tail = normalizeText(headMatch[1] || "").replace(/^[-_:.,\s]+/, "").trim();
    const tailCompact = normalizeCompact(tail).toLowerCase();

    for (const alias of Object.keys(COLORS).sort((a, b) => b.length - a.length)) {
      if (tail.includes(alias)) {
        return { product: num, option: COLORS[alias], color: COLORS[alias], size: "", qty: extractFlexibleQty(tail, 1), price: reg.price || 0, shotFile: reg.shotFile || "" };
      }
    }
    for (const alias of Object.keys(SIZE_ALIAS).sort((a, b) => b.length - a.length)) {
      if (tailCompact.includes(alias)) {
        const size = SIZE_ALIAS[alias];
        return { product: num, option: size, color: "", size, qty: extractFlexibleQty(tail, 1), price: reg.price || 0, shotFile: reg.shotFile || "" };
      }
    }
    if (isBrowseDesireOnly(tail)) return null;
    if (hasOrderKeyword(tail) || (tail && hasExplicitQty(tail))) {
      return { product: num, option: "", color: "", size: "", qty: extractFlexibleQty(tail, 1), price: reg.price || 0, shotFile: reg.shotFile || "" };
    }
    const cleaned = stripIntentWords(text);
    if (cleaned === num) {
      return { product: num, option: "", color: "", size: "", qty: 1, price: reg.price || 0, shotFile: reg.shotFile || "" };
    }
    return null;
  }

  parseProductRegistrationOrder(reg, msg) {
    const text = normalizeText(msg);
    const compact = normalizeCompact(msg);
    const product = String(reg.product || "");
    const productCompact = normalizeCompact(product);
    const escProduct = escapeRegex(product);
    const escProductCompact = escapeRegex(productCompact);
    if (new RegExp(`^${escProductCompact}${ORDER_SUFFIX_PATTERN}[!?,.]*$`, "u").test(compact)) {
      return { product, option: "", color: "", size: "", qty: 1, price: reg.price || 0, shotFile: reg.shotFile || "" };
    }
    let m = text.match(new RegExp(`^\\s*${escProduct}(?:\\s*|\\s*-\\s*)(.+)$`, "u"));
    if (m?.[1]) {
      if (isBrowseDesireOnly(m[1])) return null;
      return { product, option: "", color: "", size: "", qty: extractFlexibleQty(m[1], 1), price: reg.price || 0, shotFile: reg.shotFile || "" };
    }
    m = compact.match(new RegExp(`^${escProductCompact}(.+)$`, "u"));
    if (m?.[1]) {
      if (isBrowseDesireOnly(m[1])) return null;
      return { product, option: "", color: "", size: "", qty: extractFlexibleQty(m[1], 1), price: reg.price || 0, shotFile: reg.shotFile || "" };
    }
    return null;
  }

  expandedOptions(reg) {
    const expanded = [];
    for (const opt of reg.options || []) {
      const pieces = splitOptions(opt);
      if (pieces.length) expanded.push(...pieces);
      else if (normalizeText(opt)) expanded.push(normalizeText(opt));
    }
    return [...new Set(expanded)].sort((a, b) => b.length - a.length);
  }

  parseOptionRegistrationOrder(reg, msg) {
    const text = normalizeText(msg);
    const compact = normalizeCompact(msg);
    const productCompact = normalizeCompact(reg.product);
    const options = this.expandedOptions(reg);
    for (const opt of options) {
      const optionAliases = getOptionAliases(opt);
      const compactAliases = optionAliases.map((v) => normalizeCompact(v)).filter(Boolean);
      const escOpt = optionAliases.map(escapeRegex).join("|");
      const escOptCompact = compactAliases.map(escapeRegex).join("|");
      const escProduct = escapeRegex(reg.product);
      const escProductCompact = escapeRegex(productCompact);
      if (new RegExp(`^\\.?${escOptCompact}\\.?((번)?${ORDER_SUFFIX_PATTERN})[!?,.]*$`, "u").test(compact)) {
        return this.buildOptionOrder(reg, opt, 1);
      }
      let m = text.match(new RegExp(`^\\s*(?:${escOpt})(?:번)?(?:\\s*|\\s*-\\s*)(.+)$`, "u"));
      if (m?.[1]) {
        if (isBrowseDesireOnly(m[1])) continue;
        return this.buildOptionOrder(reg, opt, extractFlexibleQty(m[1], 1));
      }
      m = text.match(new RegExp(`^\\s*${escProduct}\\s*(?:${escOpt})(?:번)?(?:\\s*|\\s*-\\s*)(.*)$`, "u"));
      if (m) {
        if (isBrowseDesireOnly(m[1])) continue;
        return this.buildOptionOrder(reg, opt, extractFlexibleQty(m[1], 1));
      }
      m = compact.match(new RegExp(`^${escProductCompact}(?:${escOptCompact})(.*)$`, "u"));
      if (m) {
        if (isBrowseDesireOnly(m[1])) continue;
        return this.buildOptionOrder(reg, opt, extractFlexibleQty(m[1], 1));
      }
    }

    const headMatch = text.match(new RegExp(`^\\s*${escapeRegex(reg.product)}(?:번)?\\s*(.*)$`, "u"));
    if (!headMatch) return null;
    const tail = normalizeText(headMatch[1] || "");
    const tailCompact = normalizeCompact(tail).toLowerCase();
    for (const opt of options) {
      if (tailCompact.includes(normalizeCompact(opt).toLowerCase())) {
        return this.buildOptionOrder(reg, opt, extractFlexibleQty(tail, 1));
      }
    }
    if (isBrowseDesireOnly(tail)) return null;
    if (!tail || hasOrderKeyword(tail) || hasExplicitQty(tail)) {
      return {
        product: reg.product,
        option: "",
        color: "",
        size: "",
        qty: extractFlexibleQty(tail, 1),
        price: reg.price || 0,
        shotFile: reg.shotFile || ""
      };
    }
    return null;
  }

  parseQtyModeOrders(msg) {
    const text = normalizeText(msg);
    if (!this.qtyMode.enabled || !this.qtyMode.product || !text) return null;
    if (QUESTION_RE.test(text) && !hasOrderKeyword(text)) return null;
    const items = parseColorSizeQtyList(text, { allowBareNumber: true, allowKeywordOnly: true });
    if (!items || !items.length) return null;
    return items.map((item) => this.toCurrentProductOrder(item, true));
  }

  parseCurrentProductShorthandList(msg) {
    const text = normalizeText(msg);
    if (!this.qtyMode.product || !text) return null;
    if (QUESTION_RE.test(text) && !hasOrderKeyword(text)) return null;
    const items = parseColorSizeQtyList(text, { allowBareNumber: false, allowKeywordOnly: false });
    if (!items || !items.length) return null;
    return items.map((item) => this.toCurrentProductOrder(item, false));
  }

  toCurrentProductOrder(parsed, fromQtyMode) {
    const option = [parsed.color, parsed.size].filter(Boolean).join(" ");
    return {
      product: this.qtyMode.product,
      option,
      color: parsed.color || "",
      size: parsed.size || "",
      qty: parsed.qty || 1,
      price: Number(this.qtyMode.price || 0),
      shotFile: this.qtyMode.shotFile || "",
      fromQtyMode
    };
  }

  parseMessageToOrders(msg) {
    const text = normalizeText(msg);
    if (!text) return [];
    if (isNonPurchaseRequest(text) || isBrowseDesireOnly(text)) return [];
    if (QUESTION_RE.test(text) && !hasOrderKeyword(text)) return [];
    if (isManagerStyleMessage(text) && !/\d/.test(text) && !hasOrderKeyword(text)) return [];
    const qtyModeParsed = this.parseQtyModeOrders(text);
    if (qtyModeParsed) return qtyModeParsed.map((item) => this.applyDefaultQty(this.withMatch(item, "qty-mode", text), text));
    const shorthand = this.parseCurrentProductShorthandList(text);
    if (shorthand) return shorthand.map((item) => this.applyDefaultQty(this.withMatch(item, "current", text), text));
    if (this.lastOrder && FOLLOW_WORDS.some((w) => normalizeCompact(text).includes(w))) {
      return [this.applyDefaultQty(this.withMatch({ ...this.lastOrder, qty: 1 }, "follow", text), text)];
    }
    const aliasParsed = this.parseAliasOrder(text);
    if (aliasParsed) return [this.applyDefaultQty(this.withMatch(aliasParsed, "alias", text), text)];
    for (const reg of this.getAllRegistrations()) {
      let parsed = null;
      if (reg.type === "number") parsed = this.parseNumberRegistrationOrder(reg, text);
      else if (reg.type === "product") parsed = this.parseProductRegistrationOrder(reg, text);
      else if (reg.type === "option") {
        parsed = this.parseOptionRegistrationOrder(reg, text);
        if (!parsed) parsed = this.parseProductRegistrationOrder(reg, text);
      }
      if (parsed) {
        const source = mentionsAssignedProduct(text, parsed.product) ? "named" : (reg.type === "number" ? "number" : "option");
        return [this.applyDefaultQty(this.withMatch(parsed, source, text), text)];
      }
    }
    return [];
  }

  parseMessageToOrder(msg) {
    return this.parseMessageToOrders(msg)[0] || null;
  }

  withMatch(parsed, matchSource, msg) {
    if (!parsed) return null;
    const inferred = !mentionsAssignedProduct(msg, parsed.product);
    return { ...parsed, matchSource, inferred };
  }

  applyDefaultQty(parsed, msg) {
    if (!parsed) return null;
    const reg = this.getRegistrationByOrder(parsed);
    const def = Number(reg?.defaultQty || this.qtyMode.defaultQty || 1);
    if (def > 1 && Number(parsed.qty || 1) === 1 && !hasExplicitQty(msg)) {
      parsed.qty = def;
    }
    return parsed;
  }

  getRegistrationByOrder(orderObj) {
    return this.getAllRegistrations().find((reg) => {
      if (reg.type === "option") return reg.product === orderObj.product && (reg.options || []).includes(orderObj.option || "");
      if (reg.type === "product") return reg.product === orderObj.product;
      if (reg.type === "number") return reg.number === orderObj.product;
      return false;
    }) || null;
  }

  getCurrentSoldQtyForRegistration(reg) {
    let total = 0;
    for (const user of Object.values(this.orders)) {
      for (const item of Object.values(user.items)) {
        if (reg.type === "number" && item.product === reg.number) total += Number(item.qty || 0);
        if ((reg.type === "product" || reg.type === "option") && item.product === reg.product) total += Number(item.qty || 0);
      }
    }
    return total;
  }

  getStockMetaByOrder(orderObj) {
    const reg = this.getRegistrationByOrder(orderObj);
    if (!reg) return { hasStock: false, stock: 0, sold: 0, remain: null };
    const stock = Number(reg.stock || 0);
    const sold = this.getCurrentSoldQtyForRegistration(reg);
    if (stock <= 0) return { hasStock: false, stock: 0, sold, remain: null };
    return { hasStock: true, stock, sold, remain: stock - sold };
  }

  canAcceptOrder(orderObj) {
    const meta = this.getStockMetaByOrder(orderObj);
    return !meta.hasStock || meta.remain > 0;
  }

  ensureUser(uid, nick) {
    if (!this.orders[uid]) this.orders[uid] = { nick, items: {} };
    else this.orders[uid].nick = nick;
  }

  persistOrder(uid, nick, item, removed = false) {
    const identityKey = getOrderKey(item);
    if (removed) {
      db.deleteOrder(this.sessionId, String(uid), identityKey);
      return;
    }
    db.upsertOrder({
      session_id: this.sessionId,
      uid: String(uid),
      nick,
      product: item.product || "",
      option_name: item.option || "",
      color: item.color || "",
      size: item.size || "",
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      amount: Number(item.qty || 0) * Number(item.price || 0),
      msg: item.msg || "",
      shot_path: item.shotFile || "",
      identity_key: identityKey,
      match_source: item.matchSource || "",
      inferred: item.inferred ? 1 : 0
    });
  }

  addOrderItem(uid, nick, orderObj, msg, mode = "add") {
    this.ensureUser(uid, nick);
    const key = getOrderKey(orderObj);
    if (!this.orders[uid].items[key]) {
      this.orders[uid].items[key] = {
        product: orderObj.product || "",
        productKey: orderObj.productKey || `${orderObj.product || ""}__${orderObj.shotFile || ""}`,
        option: orderObj.option || "",
        color: orderObj.color || "",
        size: orderObj.size || "",
        qty: 0,
        price: orderObj.price || 0,
        msg,
        time: now(),
        shotFile: orderObj.shotFile || "",
        matchSource: orderObj.matchSource || "",
        inferred: Boolean(orderObj.inferred)
      };
    }
    const item = this.orders[uid].items[key];
    item.qty = mode === "set" ? orderObj.qty : item.qty + orderObj.qty;
    item.price = orderObj.price || item.price || 0;
    item.msg = msg;
    item.time = now();
    if (orderObj.shotFile) item.shotFile = orderObj.shotFile;
    if (orderObj.matchSource) item.matchSource = orderObj.matchSource;
    item.inferred = Boolean(orderObj.inferred);
    this.persistOrder(uid, nick, item);
    const payload = {
      uid: String(uid),
      nickname: nick,
      product: item.product,
      option: item.option,
      color: item.color,
      size: item.size,
      qty: item.qty,
      price: item.price,
      amount: item.qty * item.price,
      message: item.msg,
      time: item.time,
      shotFile: item.shotFile,
      matchSource: item.matchSource || "",
      inferred: Boolean(item.inferred)
    };
    this.onEvent("order", payload);
    return payload;
  }

  resolveOrderIdentityFromMessage(msg) {
    const parsed = this.parseMessageToOrder(msg);
    if (!parsed) return null;
    return {
      product: parsed.product || "",
      option: parsed.option || "",
      color: parsed.color || "",
      size: parsed.size || "",
      price: parsed.price || 0
    };
  }

  removeOrderByIdentity(uid, identity) {
    if (!this.orders[uid]) return false;
    let removed = false;
    for (const key of Object.keys(this.orders[uid].items)) {
      const item = this.orders[uid].items[key];
      if (
        item.product === identity.product &&
        item.option === identity.option &&
        item.color === identity.color &&
        item.size === identity.size &&
        Number(item.price || 0) === Number(identity.price || 0)
      ) {
        this.persistOrder(uid, this.orders[uid].nick, item, true);
        delete this.orders[uid].items[key];
        removed = true;
      }
    }
    return removed;
  }

  handleCancel(uid, nick, msg) {
    const identity = this.resolveOrderIdentityFromMessage(msg);
    if (!identity) {
      if (this.qtyMode.enabled && this.qtyMode.product && this.orders[uid]) {
        let removed = false;
        for (const key of Object.keys(this.orders[uid].items)) {
          const item = this.orders[uid].items[key];
          if (item.product === this.qtyMode.product) {
            this.persistOrder(uid, nick, item, true);
            delete this.orders[uid].items[key];
            removed = true;
          }
        }
        if (removed) {
          this.onEvent("cancel", { uid, nickname: nick, product: this.qtyMode.product });
          return true;
        }
      }
      return false;
    }
    const ok = this.removeOrderByIdentity(uid, identity);
    if (ok) this.onEvent("cancel", { uid, nickname: nick, product: identity.product, option: identity.option });
    return ok;
  }

  handleChange(uid, nick, msg) {
    const m = msg.match(/(.+?)\s*(?:->|→)\s*(.+)/u);
    if (!m || !this.orders[uid]) return false;
    const fromIdentity = this.resolveOrderIdentityFromMessage(normalizeText(m[1]));
    const toParsed = this.parseMessageToOrder(normalizeText(m[2]));
    if (!fromIdentity || !toParsed) return false;
    let foundItem = null;
    let foundKey = null;
    for (const key of Object.keys(this.orders[uid].items)) {
      const item = this.orders[uid].items[key];
      if (
        item.product === fromIdentity.product &&
        item.option === fromIdentity.option &&
        item.color === fromIdentity.color &&
        item.size === fromIdentity.size &&
        Number(item.price || 0) === Number(fromIdentity.price || 0)
      ) {
        foundItem = { ...item };
        foundKey = key;
        break;
      }
    }
    if (!foundItem) return false;
    this.persistOrder(uid, nick, foundItem, true);
    delete this.orders[uid].items[foundKey];
    this.addOrderItem(uid, nick, {
      product: toParsed.product,
      productKey: `${toParsed.product}__${toParsed.shotFile || ""}`,
      option: toParsed.option,
      color: foundItem.color || toParsed.color || "",
      size: foundItem.size || toParsed.size || "",
      qty: foundItem.qty,
      price: toParsed.price || 0,
      shotFile: toParsed.shotFile || ""
    }, msg, "set");
    return true;
  }

  handleIncomingOrder(chat) {
    if (CANCEL_WORDS.some((w) => chat.msg.includes(w))) {
      return this.handleCancel(chat.uid, chat.nick, chat.msg);
    }
    if (chat.msg.includes("->") || chat.msg.includes("→")) {
      return this.handleChange(chat.uid, chat.nick, chat.msg);
    }
    const parsedList = this.parseMessageToOrders(chat.msg).filter(Boolean);
    if (!parsedList.length) return false;
    let accepted = false;
    for (const parsed of parsedList) {
      if (!this.canAcceptOrder(parsed)) {
        this.onEvent("stock-block", {
          nickname: chat.nick,
          product: parsed.product,
          remain: this.getStockMetaByOrder(parsed).remain
        });
        accepted = true;
        continue;
      }
      const key = getOrderKey(parsed);
      const exists = this.orders[chat.uid]?.items[key];
      if (exists && hasExplicitQty(chat.msg)) {
        this.addOrderItem(chat.uid, chat.nick, parsed, chat.msg, "set");
      } else {
        this.addOrderItem(chat.uid, chat.nick, parsed, chat.msg, "add");
      }
      this.lastOrder = parsed;
      accepted = true;
    }
    return accepted;
  }

  ingestChat({ uid, nick, msg }) {
    if (this.isDup(uid, msg)) return { dup: true };
    const chat = {
      time: now(),
      timeMs: Date.now(),
      nick,
      uid,
      msg,
      id: makeChatId(uid, msg, Date.now())
    };
    const handled = this.handleIncomingOrder(chat);
    db.insertChat({
      session_id: this.sessionId,
      chat_key: chat.id,
      uid: String(uid || ""),
      nick,
      msg,
      is_order: handled ? 1 : 0,
      created_at: chat.time,
      created_ms: chat.timeMs
    });
    this.onEvent("chat", { ...chat, isOrder: handled });
    return { chat, handled };
  }

  registerProduct(input, shotPath = "") {
    let payload = "";
    let composed = { defaultQty: 1, sizes: [], colors: [] };
    if (typeof input === "string") {
      payload = input;
    } else {
      composed = composeRegistrationFields({
        ...(input || {}),
        fallbackProduct: this.qtyMode.product
      });
      if (composed.empty) return { ok: true, skipped: true };
      payload = composed.payload;
    }
    const reg = parseRegistrationPayload(payload);
    if (!reg) return { ok: false, message: "상품 등록 형식이 올바르지 않습니다." };
    if (reg.type === "alias") {
      this.aliasMap[reg.alias] = { product: reg.product };
      db.insertAlias({ session_id: this.sessionId, alias: reg.alias, product: reg.product });
      this.onEvent("alias", reg);
      return { ok: true, registration: reg };
    }
    const key = registrationKey(reg);
    this.registrations[key] = {
      ...reg,
      key,
      displayName: composed.label || reg.displayName,
      defaultQty: Number(composed.defaultQty || 1),
      sizes: composed.sizes || [],
      colors: composed.colors || [],
      shotFile: shotPath,
      registeredAt: now(),
      registeredAtMs: Date.now()
    };
    db.insertProduct({
      session_id: this.sessionId,
      type: reg.type,
      product: reg.product || "",
      number: reg.number || "",
      options_json: JSON.stringify(reg.options || []),
      price: Number(reg.price || 0),
      stock: Number(reg.stock || 0),
      default_qty: Number(composed.defaultQty || 1),
      display_name: composed.label || reg.displayName,
      shot_path: shotPath
    });
    this.qtyMode.product = reg.type === "number" ? reg.number : reg.product;
    this.qtyMode.price = Number(reg.price || 0);
    this.qtyMode.stock = Number(reg.stock || 0);
    this.qtyMode.defaultQty = Number(composed.defaultQty || 1);
    this.qtyMode.shotFile = shotPath;
    this.qtyMode.registeredAt = now();
    this.qtyMode.registeredAtMs = Date.now();
    if ((reg.type === "product" || reg.type === "option") && String(reg.product).includes("이거")) {
      this.qtyMode.enabled = true;
    }
    this.onEvent("product", { ...this.registrations[key], qtyMode: this.qtyMode });
    this.reprocessRecentChats();
    return { ok: true, registration: this.registrations[key], qtyMode: this.qtyMode };
  }

  resolveRegistrationKey(input = {}) {
    if (input.key && this.registrations[input.key]) return input.key;
    const product = String(input.product || input.number || "").trim();
    const candidates = [input.key, `P:${product}`, `O:${product}`, `N:${product}`].filter(Boolean);
    return candidates.find((key) => this.registrations[key]) || "";
  }

  applyLatestAsCurrent() {
    const remaining = this.getAllRegistrations().sort((a, b) => Number(b.registeredAtMs || 0) - Number(a.registeredAtMs || 0));
    if (!remaining.length) {
      this.qtyMode = {
        enabled: false,
        product: "",
        price: 0,
        stock: 0,
        defaultQty: 1,
        shotFile: "",
        registeredAt: "",
        registeredAtMs: 0
      };
      return;
    }
    const next = remaining[0];
    this.qtyMode.product = next.type === "number" ? next.number : next.product;
    this.qtyMode.price = Number(next.price || 0);
    this.qtyMode.stock = Number(next.stock || 0);
    this.qtyMode.defaultQty = Number(next.defaultQty || 1);
    this.qtyMode.shotFile = next.shotFile || "";
    this.qtyMode.registeredAt = next.registeredAt || now();
    this.qtyMode.registeredAtMs = next.registeredAtMs || Date.now();
    if (!String(this.qtyMode.product || "").includes("이거")) this.qtyMode.enabled = false;
  }

  removeProduct(input = {}) {
    const key = this.resolveRegistrationKey(input);
    const reg = this.registrations[key];
    if (!reg) return { ok: false, message: "삭제할 등록 상품을 찾지 못했습니다." };
    delete this.registrations[key];
    db.deleteProduct(this.sessionId, reg);
    const productName = reg.type === "number" ? reg.number : reg.product;
    if (productName) {
      db.deleteAliasesForProduct(this.sessionId, productName);
      for (const alias of Object.keys(this.aliasMap)) {
        if (this.aliasMap[alias]?.product === productName) delete this.aliasMap[alias];
      }
    }
    if (this.lastOrder && (this.lastOrder.product === productName || this.lastOrder.product === reg.product || this.lastOrder.product === reg.number)) {
      this.lastOrder = null;
    }
    const currentName = this.qtyMode.product;
    if (currentName && (currentName === productName || currentName === reg.product || currentName === reg.number)) {
      this.applyLatestAsCurrent();
    }
    this.onEvent("product-removed", {
      key,
      registration: reg,
      qtyMode: this.qtyMode,
      products: this.getAllRegistrations()
    });
    return {
      ok: true,
      removed: { ...reg, key },
      qtyMode: this.qtyMode,
      products: this.getAllRegistrations()
    };
  }

  reprocessRecentChats() {
    const chats = db.listChats(this.sessionId, 120);
    for (const chat of chats) {
      if (chat.is_order) continue;
      const handled = this.handleIncomingOrder({
        uid: chat.uid,
        nick: chat.nick,
        msg: chat.msg,
        id: chat.chat_key
      });
      if (handled) db.markChatAsOrder(this.sessionId, chat.chat_key);
    }
  }

  toggleQtyMode() {
    if (!this.qtyMode.product) return { ok: false, message: "먼저 상품을 등록하세요." };
    this.qtyMode.enabled = !this.qtyMode.enabled;
    this.onEvent("qty-mode", this.qtyMode);
    return { ok: true, qtyMode: this.qtyMode };
  }

  snapshot() {
    const orderList = Object.entries(this.orders).flatMap(([uid, user]) =>
      Object.values(user.items).map((item) => ({
        uid,
        nickname: user.nick,
        product: item.product,
        option: item.option,
        color: item.color,
        size: item.size,
        qty: item.qty,
        price: item.price,
        amount: item.qty * item.price,
        message: item.msg,
        time: item.time,
        shotFile: item.shotFile,
        matchSource: item.matchSource || "",
        inferred: Boolean(item.inferred)
      }))
    );
    return {
      products: this.getAllRegistrations(),
      qtyMode: this.qtyMode,
      orders: orderList,
      stats: {
        buyers: Object.keys(this.orders).length,
        orderCount: orderList.length,
        amount: orderList.reduce((sum, o) => sum + Number(o.amount || 0), 0)
      }
    };
  }
}

module.exports = { OrderEngine };
