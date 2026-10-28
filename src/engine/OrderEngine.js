const db = require("../db");
const {
  COLORS,
  SIZE_ALIAS,
  ORDER_SUFFIX_PATTERN,
  QUESTION_RE,
  CANCEL_WORDS,
  isCancelIntent,
  parseCancelQty,
  stripCancelWords,
  isChangeIntent,
  revisionBody,
  parseBareRevisionQty,
  parseQtyChangeMessage,
  isSafeImmediateQty,
  normalizeText,
  normalizeCompact,
  dottedSelfQtyKey,
  normalizeMatchText,
  escapeRegex,
  hasOrderKeyword,
  hasOrderIntent,
  leftoverAfterOrderWords,
  extractSpokenProductName,
  isBrowseDesireOnly,
  isNonPurchaseRequest,
  isStatusOrInquiry,
  isDeferredPurchase,
  isReactionComment,
  isQuestionLike,
  isNonOrderChat,
  isNoiseChat,
  isOrderSuffixOnly,
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
  hasUnitQty,
  parseFollowOrder,
  startsWithFollowWord,
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
    this.reviews = [];
    this.reprocessing = false;
    this.qtyMode = {
      enabled: false,
      key: "",
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
    const compact = dottedSelfQtyKey(normalizeCompact(msg));
    const key = `${uid}::${compact}`;
    const nowMs = Date.now();
    const isShortOrderLike =
      /^\d+$/.test(compact) ||
      /^\.?\d+\.?$/.test(normalizeCompact(msg)) ||
      /^\d+\.\d+$/.test(normalizeCompact(msg)) ||
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
    const matches = this.getAllRegistrations().filter((reg) =>
      (reg.type === "product" || reg.type === "option") && reg.product === productName
    );
    if (!matches.length) return null;
    if (this.qtyMode.key) {
      const current = matches.find((reg) => reg.key === this.qtyMode.key);
      if (current) return current;
    }
    return matches[0];
  }

  sameNameRegistrations(productName) {
    return this.getAllRegistrations().filter((reg) =>
      (reg.type === "product" || reg.type === "option") && reg.product === productName
    );
  }

  isCurrentRegistration(reg) {
    if (!reg) return false;
    if (this.qtyMode.key && reg.key === this.qtyMode.key) return true;
    const name = reg.type === "number" ? reg.number : reg.product;
    if (!name || this.qtyMode.product !== name) return false;
    return this.sameNameRegistrations(name).length <= 1;
  }

  messageMentionsOptions(text, options) {
    const compact = normalizeCompact(text).toLowerCase();
    return (options || []).some((opt) => {
      return getOptionAliases(opt).some((alias) => compact.includes(normalizeCompact(alias).toLowerCase()));
    });
  }

  buildOptionOrder(reg, opt, qty) {
    const colorName = normalizeOptionToColor(opt);
    return {
      product: reg.product,
      option: opt,
      color: colorName ? opt : "",
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
    const compact = normalizeMatchText(msg);
    const product = String(reg.product || "");
    const productCompact = normalizeMatchText(product);
    if (!productCompact || !compact.includes(productCompact)) return null;
    const escProductCompact = escapeRegex(productCompact);
    if (new RegExp(`^${escProductCompact}${ORDER_SUFFIX_PATTERN}[!?,.]*$`, "u").test(compact)) {
      return { product, option: "", color: "", size: "", qty: 1, price: reg.price || 0, shotFile: reg.shotFile || "" };
    }
    if (isStatusOrInquiry(text) || isQuestionLike(text) || isDeferredPurchase(text) || isReactionComment(text) || isNonOrderChat(text)) return null;
    const atStart = compact.startsWith(productCompact);
    const tail = atStart ? compact.slice(productCompact.length) : "";
    if (isBrowseDesireOnly(tail)) return null;
    if (atStart && (hasOrderIntent(text) || isOrderSuffixOnly(tail))) {
      return {
        product,
        option: "",
        color: "",
        size: "",
        qty: extractFlexibleQty(text, 1),
        price: reg.price || 0,
        shotFile: reg.shotFile || ""
      };
    }
    if (!atStart && hasOrderIntent(text)) {
      return {
        product,
        option: "",
        color: "",
        size: "",
        qty: extractFlexibleQty(text, 1),
        price: reg.price || 0,
        shotFile: reg.shotFile || ""
      };
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

  parseOptionRegistrationOrder(reg, msg, { requireOption = false } = {}) {
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
      if (new RegExp(`^\\.?(?:${escOptCompact})\\.?(?:(?:번)?${ORDER_SUFFIX_PATTERN})[!?,.]*$`, "u").test(compact)) {
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
    const siblings = this.sameNameRegistrations(reg.product).filter((other) => other.key !== reg.key);
    const siblingOptions = siblings.flatMap((other) => other.options || []);
    if (this.messageMentionsOptions(tail, siblingOptions) && !this.messageMentionsOptions(tail, options)) {
      return null;
    }
    if (requireOption) return null;
    const allowBareProduct = this.sameNameRegistrations(reg.product).length <= 1 || this.isCurrentRegistration(reg);
    if (allowBareProduct && (!tail || hasOrderKeyword(tail) || hasExplicitQty(tail))) {
      return {
        product: reg.product,
        option: options.length === 1 ? options[0] : "",
        color: options.length === 1 ? normalizeOptionToColor(options[0]) : "",
        size: options.length === 1 ? normalizeOptionToSize(options[0]) : "",
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

  labelForCanonicalColor(reg, canon) {
    if (!canon) return "";
    if (!reg) return canon;
    const pool = [...(reg.colors || []), ...this.expandedOptions(reg)];
    const matches = [];
    const seen = new Set();
    for (const opt of pool) {
      const text = normalizeText(opt);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      if (normalizeOptionToColor(text) === canon) matches.push(text);
    }
    if (!matches.length) return canon;
    matches.sort((a, b) => a.length - b.length || a.localeCompare(b, "ko"));
    return matches[0];
  }

  toCurrentProductOrder(parsed, fromQtyMode) {
    const current = this.qtyMode.key ? this.registrations[this.qtyMode.key] : null;
    const fallback = current?.options?.length === 1 ? current.options[0] : "";
    const colorLabel = parsed.color ? this.labelForCanonicalColor(current, parsed.color) : "";
    const sizeLabel = parsed.size || "";
    const option = [colorLabel, sizeLabel].filter(Boolean).join(" ") || fallback;
    return {
      product: this.qtyMode.product,
      option,
      color: colorLabel || (fallback ? normalizeOptionToColor(fallback) : ""),
      size: sizeLabel || (fallback ? normalizeOptionToSize(fallback) : ""),
      qty: parsed.qty || 1,
      price: Number(this.qtyMode.price || 0),
      shotFile: this.qtyMode.shotFile || "",
      fromQtyMode
    };
  }

  namedRegistrations() {
    return this.getAllRegistrations().slice().sort((a, b) => {
      const an = normalizeMatchText(a.product || a.number || "");
      const bn = normalizeMatchText(b.product || b.number || "");
      return bn.length - an.length;
    });
  }

  currentRegistration() {
    if (this.qtyMode.key && this.registrations[this.qtyMode.key]) {
      return this.registrations[this.qtyMode.key];
    }
    return this.getAllRegistrations()
      .slice()
      .sort((a, b) => Number(b.registeredAtMs || 0) - Number(a.registeredAtMs || 0))[0] || null;
  }

  orderFromRegistration(reg, qty) {
    const options = this.expandedOptions(reg);
    const fallback = options.length === 1 ? options[0] : "";
    return {
      product: reg.type === "number" ? reg.number : reg.product,
      option: fallback,
      color: fallback ? normalizeOptionToColor(fallback) : "",
      size: fallback ? normalizeOptionToSize(fallback) : "",
      qty: Number(qty || 1) || 1,
      price: Number(reg.price || 0),
      shotFile: reg.shotFile || ""
    };
  }

  mentionsRegisteredProduct(text) {
    return this.getAllRegistrations().some((reg) => {
      const name = reg.product || reg.number || "";
      return Boolean(name && mentionsAssignedProduct(text, name));
    });
  }

  mentionsOtherRegisteredProduct(text, current) {
    const currentName = current?.type === "number" ? current.number : current?.product;
    return this.getAllRegistrations().some((reg) => {
      const name = reg.type === "number" ? reg.number : reg.product;
      return Boolean(name && name !== currentName && mentionsAssignedProduct(text, name));
    });
  }

  parseLatestProductOrder(msg) {
    if (isNonOrderChat(msg) || isQuestionLike(msg)) return null;
    const follow = parseFollowOrder(msg);
    const reg = this.currentRegistration();
    if (follow && reg && !this.mentionsOtherRegisteredProduct(msg, reg)) {
      return this.orderFromRegistration(reg, follow.qty);
    }
    if (!follow && startsWithFollowWord(msg)) return null;
    const spoken = extractSpokenProductName(msg);
    const hasBareIntent = Boolean(follow) || hasOrderKeyword(msg) || hasUnitQty(msg);
    if (spoken && spoken.length >= 2 && hasBareIntent) {
      return {
        product: spoken,
        option: "",
        color: "",
        size: "",
        qty: follow ? follow.qty : extractFlexibleQty(msg, 1),
        price: 0,
        shotFile: "",
        unregistered: true
      };
    }
    if (!reg) return null;
    if (this.mentionsRegisteredProduct(msg)) return null;
    if (follow) return this.orderFromRegistration(reg, follow.qty);
    if (leftoverAfterOrderWords(msg)) return null;
    if (!hasOrderKeyword(msg) && !hasUnitQty(msg)) return null;
    return this.orderFromRegistration(reg, extractFlexibleQty(msg, 1));
  }

  parseMessageToOrders(msg) {
    const text = normalizeText(msg);
    if (!text) return [];
    if (isNonPurchaseRequest(text) || isBrowseDesireOnly(text)) return [];
    if (isNoiseChat(text) || isNonOrderChat(text) || isQuestionLike(text) || isStatusOrInquiry(text) || isDeferredPurchase(text) || isReactionComment(text)) return [];
    if (QUESTION_RE.test(text) && !hasOrderKeyword(text)) return [];
    const mentionsRegistered = this.getAllRegistrations().some((reg) => {
      const name = reg.product || reg.number || "";
      if (name && mentionsAssignedProduct(text, name)) return true;
      return reg.type === "option" && this.messageMentionsOptions(text, reg.options);
    });
    if (isManagerStyleMessage(text) && !/\d/.test(text) && !hasOrderKeyword(text) && !mentionsRegistered) return [];
    const qtyModeParsed = this.parseQtyModeOrders(text);
    if (qtyModeParsed) return qtyModeParsed.map((item) => this.applyDefaultQty(this.withMatch(item, "qty-mode", text), text));
    const shorthand = this.parseCurrentProductShorthandList(text);
    if (shorthand) return shorthand.map((item) => this.applyDefaultQty(this.withMatch(item, "current", text), text));
    const aliasParsed = this.parseAliasOrder(text);
    if (aliasParsed) return [this.applyDefaultQty(this.withMatch(aliasParsed, "alias", text), text)];
    const optionHits = [];
    for (const reg of this.namedRegistrations()) {
      if (reg.type !== "option") continue;
      const parsed = this.parseOptionRegistrationOrder(reg, text, { requireOption: true });
      if (parsed?.option) optionHits.push(parsed);
    }
    if (optionHits.length) {
      optionHits.sort((a, b) => String(b.option || "").length - String(a.option || "").length);
      const parsed = optionHits[0];
      const source = mentionsAssignedProduct(text, parsed.product) ? "named" : "option";
      return [this.applyDefaultQty(this.withMatch(parsed, source, text), text)];
    }
    for (const reg of this.namedRegistrations()) {
      let parsed = null;
      if (reg.type === "number") parsed = this.parseNumberRegistrationOrder(reg, text);
      else if (reg.type === "product") parsed = this.parseProductRegistrationOrder(reg, text);
      else if (reg.type === "option") {
        parsed = this.parseOptionRegistrationOrder(reg, text);
        if (!parsed && this.sameNameRegistrations(reg.product).length <= 1) {
          parsed = this.parseProductRegistrationOrder(reg, text);
        }
      }
      if (parsed) {
        const source = mentionsAssignedProduct(text, parsed.product) ? "named" : (reg.type === "number" ? "number" : "option");
        return [this.applyDefaultQty(this.withMatch(parsed, source, text), text)];
      }
    }
    const latestBare = this.parseLatestProductOrder(text);
    if (latestBare) {
      const source = latestBare.unregistered ? "unregistered" : "current";
      return [this.applyDefaultQty(this.withMatch(latestBare, source, text), text)];
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
    if (parsed.unregistered || parsed.matchSource === "unregistered") return parsed;
    const def = Number(reg?.defaultQty || this.qtyMode.defaultQty || 1);
    if (def > 1 && Number(parsed.qty || 1) === 1 && !hasExplicitQty(msg)) {
      parsed.qty = def;
    }
    return parsed;
  }

  getRegistrationByOrder(orderObj) {
    return this.getAllRegistrations().find((reg) => {
      if (reg.type === "option") {
        if (reg.product !== orderObj.product) return false;
        if (Number(reg.price || 0) !== Number(orderObj.price || 0)) return false;
        if (orderObj.option) return (reg.options || []).includes(orderObj.option);
        return this.isCurrentRegistration(reg) || (reg.options || []).length <= 1;
      }
      if (reg.type === "product") return reg.product === orderObj.product;
      if (reg.type === "number") return reg.number === orderObj.product;
      return false;
    }) || null;
  }

  getCurrentSoldQtyForRegistration(reg) {
    let total = 0;
    for (const user of Object.values(this.orders)) {
      for (const item of Object.values(user.items)) {
        if (item.status === "shortage") continue;
        if (reg.type === "number" && item.product === reg.number) total += Number(item.qty || 0);
        if (reg.type === "product" && item.product === reg.product) total += Number(item.qty || 0);
        if (reg.type === "option" && item.product === reg.product && Number(item.price || 0) === Number(reg.price || 0)) {
          if (!item.option || (reg.options || []).includes(item.option) || (reg.options || []).includes(item.size)) {
            total += Number(item.qty || 0);
          }
        }
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

  orderStorageKey(item) {
    const base = getOrderKey(item);
    return item?.status === "shortage" ? `${base}||shortage` : base;
  }

  persistOrder(uid, nick, item, removed = false) {
    const identityKey = this.orderStorageKey(item);
    if (removed) {
      db.deleteOrder(this.sessionId, String(uid), identityKey);
      return;
    }
    const shortage = item.status === "shortage";
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
      amount: shortage ? 0 : Number(item.qty || 0) * Number(item.price || 0),
      msg: item.msg || "",
      shot_path: item.shotFile || "",
      identity_key: identityKey,
      match_source: item.matchSource || "",
      inferred: item.inferred ? 1 : 0,
      stock_status: shortage ? "shortage" : ""
    });
  }

  addOrderItem(uid, nick, orderObj, msg, mode = "add", keyOverride = "") {
    this.ensureUser(uid, nick);
    const key = keyOverride || this.orderStorageKey(orderObj);
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
    const prevQty = Number(item.qty || 0);
    item.qty = mode === "set" ? Number(orderObj.qty || 0) : prevQty + Number(orderObj.qty || 0);
    item.price = orderObj.price || item.price || 0;
    item.msg = msg;
    item.time = now();
    if (orderObj.shotFile) item.shotFile = orderObj.shotFile;
    if (orderObj.matchSource) item.matchSource = orderObj.matchSource;
    item.inferred = Boolean(orderObj.inferred);
    item.status = orderObj.status === "shortage" ? "shortage" : "";
    this.persistOrder(uid, nick, item);
    const delta = Number(item.qty) - prevQty;
    const shortage = item.status === "shortage";
    const printQty = !this.reprocessing && !shortage && delta > 0 && delta <= 10 ? delta : 0;
    const payload = {
      uid: String(uid),
      nickname: nick,
      product: item.product,
      option: item.option,
      color: item.color,
      size: item.size,
      qty: item.qty,
      printQty,
      price: item.price,
      amount: shortage ? 0 : item.qty * item.price,
      message: item.msg,
      time: item.time,
      shotFile: item.shotFile,
      matchSource: item.matchSource || "",
      inferred: Boolean(item.inferred),
      stockStatus: item.status || "",
      captureScreen: false
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

  orderItemMatchesIdentity(item, identity) {
    if (!item || !identity) return false;
    return (
      item.product === identity.product &&
      item.option === identity.option &&
      item.color === identity.color &&
      item.size === identity.size &&
      Number(item.price || 0) === Number(identity.price || 0)
    );
  }

  getLatestUserOrderItem(uid) {
    const user = this.orders[uid];
    if (!user) return null;
    let latest = null;
    for (const [key, item] of Object.entries(user.items || {})) {
      if (item.status === "shortage") continue;
      if (!latest || String(item.time || "") > String(latest.item.time || "")) {
        latest = { key, item };
      }
    }
    return latest;
  }

  canAcceptQtyChange(item, newQty) {
    const meta = this.getStockMetaByOrder(item);
    if (!meta.hasStock) return true;
    const current = Number(item.qty || 0);
    const delta = Number(newQty) - current;
    if (delta <= 0) return true;
    return meta.remain >= delta;
  }

  setItemQty(uid, nick, item, qty, msg) {
    return this.addOrderItem(uid, nick, {
      product: item.product,
      productKey: item.productKey,
      option: item.option,
      color: item.color,
      size: item.size,
      qty,
      price: item.price,
      shotFile: item.shotFile,
      matchSource: item.matchSource,
      inferred: item.inferred
    }, msg, "set");
  }

  removeItem(uid, nick, key, msg) {
    const user = this.orders[uid];
    const item = user?.items?.[key];
    if (!item) return false;
    this.persistOrder(uid, nick, item, true);
    delete user.items[key];
    if (this.lastOrder && this.orderItemMatchesIdentity(this.lastOrder, item)) this.lastOrder = null;
    this.onEvent("cancel", {
      uid: String(uid),
      nickname: nick,
      product: item.product,
      option: item.option,
      color: item.color,
      size: item.size,
      stockStatus: item.status || "",
      removed: true,
      message: msg
    });
    if (item.status !== "shortage") {
      const twin = `${getOrderKey(item)}||shortage`;
      if (user.items[twin]) this.removeItem(uid, nick, twin, msg);
    }
    return true;
  }

  applyPartialOrFullCancel(uid, nick, key, item, cancelQty, msg) {
    const currentQty = Number(item.qty || 0);
    if (cancelQty > 0 && cancelQty < currentQty) {
      this.setItemQty(uid, nick, item, currentQty - cancelQty, msg);
      this.onEvent("cancel", {
        uid: String(uid),
        nickname: nick,
        product: item.product,
        option: item.option,
        qty: currentQty - cancelQty,
        reducedBy: cancelQty,
        remaining: currentQty - cancelQty,
        stockStatus: item.status || "",
        message: msg
      });
      return true;
    }
    return this.removeItem(uid, nick, key, msg);
  }

  handleCancel(uid, nick, msg) {
    const user = this.orders[uid];
    if (!user?.items) return false;
    const cancelQty = parseCancelQty(msg);
    const cleaned = stripCancelWords(msg);
    const identity = cleaned ? this.resolveOrderIdentityFromMessage(cleaned) : null;

    if (identity) {
      const keys = Object.keys(user.items).sort((a, b) =>
        Number(user.items[a]?.status === "shortage") - Number(user.items[b]?.status === "shortage")
      );
      for (const key of keys) {
        const item = user.items[key];
        if (!item || !this.orderItemMatchesIdentity(item, identity)) continue;
        return this.applyPartialOrFullCancel(uid, nick, key, item, cancelQty, msg);
      }
    }

    if (this.qtyMode.enabled && this.qtyMode.product) {
      const matchedKeys = Object.keys(user.items)
        .filter((key) => user.items[key]?.product === this.qtyMode.product)
        .sort((a, b) => Number(user.items[a]?.status === "shortage") - Number(user.items[b]?.status === "shortage"));
      if (cancelQty > 0 && matchedKeys.length === 1) {
        const key = matchedKeys[0];
        return this.applyPartialOrFullCancel(uid, nick, key, user.items[key], cancelQty, msg);
      }
      if (cancelQty <= 0 && matchedKeys.length) {
        let removed = false;
        for (const key of matchedKeys) {
          if (this.removeItem(uid, nick, key, msg)) removed = true;
        }
        return removed;
      }
    }

    const latest = this.getLatestUserOrderItem(uid);
    if (latest) {
      if (cancelQty > 0) return this.applyPartialOrFullCancel(uid, nick, latest.key, latest.item, cancelQty, msg);
      if (!cleaned || isCancelIntent(msg)) return this.removeItem(uid, nick, latest.key, msg);
    }
    return false;
  }

  sameOrderLine(item, parsed) {
    if (!item || !parsed) return false;
    if ((item.product || "") !== (parsed.product || "")) return false;
    const left = item.color || item.option || "";
    const right = parsed.color || parsed.option || "";
    if (!left && !right) return !(item.size || parsed.size);
    const leftColor = normalizeOptionToColor(left);
    const rightColor = normalizeOptionToColor(right);
    if (leftColor && rightColor) return leftColor === rightColor && (item.size || "") === (parsed.size || "");
    return normalizeCompact(left) === normalizeCompact(right) && (item.size || "") === (parsed.size || "");
  }

  productEntries(uid, product) {
    const found = this.orderUser(uid);
    if (!found) return { uidKey: uid, entries: [] };
    const entries = Object.entries(found.user.items || {}).filter(([, item]) =>
      item.status !== "shortage" && (!product || item.product === product)
    );
    return { uidKey: found.key, nick: found.user.nick, entries };
  }

  latestEntry(entries) {
    let latest = null;
    for (const pair of entries) {
      if (!latest || String(pair[1].time || "") > String(latest[1].time || "")) latest = pair;
    }
    return latest;
  }

  setRevisionQty(uid, nick, key, item, qty, msg) {
    const next = Number(qty || 0);
    const current = Number(item.qty || 0);
    if (next === current) return true;
    if (next <= 0) return this.removeItem(uid, nick, key, msg);
    this.applyStockedQty(uid, nick, item, next, msg);
    return true;
  }

  applyQtyRevision(uid, nick, qty, msg) {
    const product = this.qtyMode.product || "";
    const found = this.productEntries(uid, product);
    const pool = found.entries.length ? found.entries : this.productEntries(uid, "").entries;
    if (!pool.length) return false;
    const target = pool.length === 1 ? pool[0] : this.latestEntry(pool);
    if (!target) return false;
    return this.setRevisionQty(found.uidKey || uid, nick, target[0], target[1], qty, msg);
  }

  applyDesiredRevision(uid, nick, msg, body, desired) {
    const product = desired[0]?.product || this.qtyMode.product || "";
    const found = this.productEntries(uid, product);
    const explicitQty = hasExplicitQty(body);
    if (!found.entries.length) {
      for (const item of desired) this.applyStockedQty(uid, nick, item, item.qty, msg);
      return true;
    }
    const touches = desired.some((item) => found.entries.some(([, existing]) => this.sameOrderLine(existing, item)));
    if (!touches) {
      const target = found.entries.length === 1 ? found.entries[0] : this.latestEntry(found.entries);
      if (!target) return false;
      const first = desired[0];
      const qty = explicitQty ? first.qty : target[1].qty;
      this.removeItem(found.uidKey, nick, target[0], msg);
      this.applyStockedQty(found.uidKey, nick, { ...first, qty }, qty, msg);
      for (const extra of desired.slice(1)) this.applyStockedQty(found.uidKey, nick, extra, extra.qty, msg);
      return true;
    }
    for (const item of desired) {
      const match = found.entries.find(([, existing]) => this.sameOrderLine(existing, item));
      if (!match) {
        this.applyStockedQty(found.uidKey, nick, item, item.qty, msg);
        continue;
      }
      this.setRevisionQty(found.uidKey, nick, match[0], match[1], item.qty, msg);
    }
    return true;
  }

  handleRevision(uid, nick, msg) {
    const body = revisionBody(msg);
    if (!body) return false;
    const bareQty = parseBareRevisionQty(body);
    if (bareQty) return this.applyQtyRevision(uid, nick, bareQty, msg);
    const savedEnabled = this.qtyMode.enabled;
    if (this.qtyMode.product) this.qtyMode.enabled = true;
    let desired = [];
    try {
      desired = this.parseMessageToOrders(body).filter(Boolean);
    } finally {
      this.qtyMode.enabled = savedEnabled;
    }
    if (!desired.length) return false;
    return this.applyDesiredRevision(uid, nick, msg, body, desired);
  }

  handleQtyChange(uid, nick, msg) {
    const qty = parseQtyChangeMessage(msg);
    if (!qty) return false;
    const latest = this.getLatestUserOrderItem(uid);
    if (!latest) return false;
    if (qty === Number(latest.item.qty || 0)) return true;
    this.applyStockedQty(uid, nick, latest.item, qty, msg);
    this.lastOrder = { ...latest.item, qty: 1 };
    return true;
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

  pushReview(chat, reason, parsed) {
    const row = {
      id: chat.id,
      uid: String(chat.uid || ""),
      nickname: chat.nick,
      message: chat.msg,
      reason,
      product: parsed?.product || "",
      option: parsed?.option || "",
      qty: parsed?.qty || 0,
      time: chat.time
    };
    this.reviews.unshift(row);
    this.reviews = this.reviews.slice(0, 80);
    this.onEvent("review", row);
    return true;
  }

  applyStockedQty(uid, nick, template, targetQty, msg) {
    this.ensureUser(uid, nick);
    const baseKey = getOrderKey({ ...template, status: "" });
    const shortageKey = `${baseKey}||shortage`;
    const existing = this.orders[uid].items[baseKey];
    const target = Math.max(0, Number(targetQty || 0));
    const meta = this.getStockMetaByOrder(template);
    const confirmedQty = Number(existing?.qty || 0);
    const available = meta.hasStock ? Math.max(0, Number(meta.remain || 0) + confirmedQty) : target;
    const accept = Math.min(target, available);
    const short = meta.hasStock ? Math.max(0, target - accept) : 0;
    if (accept > 0) {
      this.addOrderItem(uid, nick, { ...template, qty: accept, status: "" }, msg, "set", baseKey);
    } else if (existing) {
      this.removeItem(uid, nick, baseKey, msg);
    }
    if (short > 0) {
      this.addOrderItem(uid, nick, { ...template, qty: short, status: "shortage" }, msg, "set", shortageKey);
      this.onEvent("stock-block", {
        nickname: nick,
        product: template.product || "",
        option: template.option || "",
        remain: Math.max(0, Number(meta.remain || 0)),
        shortage: short
      });
    } else if (this.orders[uid]?.items[shortageKey]) {
      this.removeItem(uid, nick, shortageKey, msg);
    }
  }

  recordIncoming(uid, nick, parsed, msg) {
    this.ensureUser(uid, nick);
    const baseKey = getOrderKey(parsed);
    const shortageKey = `${baseKey}||shortage`;
    const existing = this.orders[uid].items[baseKey];
    const shortage = this.orders[uid].items[shortageKey];
    const requested = Math.max(1, Number(parsed.qty || 1));
    const confirmedQty = Number(existing?.qty || 0);
    const shortageQty = Number(shortage?.qty || 0);
    const explicit = hasExplicitQty(msg);
    if (!parsed.option && !parsed.color && !parsed.size) {
      const lines = Object.values(this.orders[uid].items).filter((item) =>
        item.status !== "shortage" && item.product === (parsed.product || "")
      );
      if (lines.length === 1 && explicit && requested !== Number(lines[0].qty || 0)) {
        this.applyStockedQty(uid, nick, lines[0], requested, msg);
        return "ok";
      }
      if (lines.length >= 1) {
        this.onEvent("duplicate-order", {
          nickname: nick,
          product: parsed.product || "",
          option: lines[0].option || lines[0].color || "",
          qty: Number(lines[0].qty || 0)
        });
        return "duplicate";
      }
    }
    if (confirmedQty > 0 && (!explicit || requested === confirmedQty + shortageQty)) {
      this.onEvent("duplicate-order", {
        nickname: nick,
        product: parsed.product || "",
        option: parsed.option || "",
        qty: confirmedQty
      });
      return "duplicate";
    }
    if (!confirmedQty && shortage && (!explicit || requested === shortageQty)) {
      const meta = this.getStockMetaByOrder(parsed);
      if (meta.hasStock && Number(meta.remain || 0) <= 0) {
        this.onEvent("duplicate-order", {
          nickname: nick,
          product: parsed.product || "",
          option: parsed.option || "",
          qty: 0,
          shortage: true
        });
        return "duplicate";
      }
    }
    this.applyStockedQty(uid, nick, parsed, requested, msg);
    return "ok";
  }

  handleIncomingOrder(chat) {
    if (isCancelIntent(chat.msg) || CANCEL_WORDS.some((w) => chat.msg.includes(w))) {
      return this.handleCancel(chat.uid, chat.nick, chat.msg);
    }
    if (isChangeIntent(chat.msg)) {
      return this.handleRevision(chat.uid, chat.nick, chat.msg);
    }
    if (parseQtyChangeMessage(chat.msg)) {
      return this.handleQtyChange(chat.uid, chat.nick, chat.msg);
    }
    const parsedList = this.parseMessageToOrders(chat.msg).filter(Boolean);
    if (!parsedList.length) return false;
    let accepted = false;
    for (const parsed of parsedList) {
      if (!isSafeImmediateQty(parsed.qty) && hasExplicitQty(chat.msg)) {
        this.pushReview(chat, `수량 ${parsed.qty}개는 자동 확정하지 않습니다 (1~10개만 바로 접수)`, parsed);
        accepted = true;
        continue;
      }
      const recorded = this.recordIncoming(chat.uid, chat.nick, parsed, chat.msg);
      if (recorded !== "duplicate") this.lastOrder = parsed;
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
    this.qtyMode.key = key;
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
    this.claimOrdersJustBeforeRegistration();
    return { ok: true, registration: this.registrations[key], qtyMode: this.qtyMode };
  }

  attachShot(shotPath) {
    const key = this.qtyMode.key;
    const reg = key && this.registrations[key];
    if (!reg || !shotPath) return { ok: false, message: "먼저 상품을 등록하세요." };
    reg.shotFile = shotPath;
    this.qtyMode.shotFile = shotPath;
    db.updateProductShot(this.sessionId, reg, shotPath);
    this.onEvent("product", { ...reg, qtyMode: this.qtyMode });
    return { ok: true, registration: { ...reg }, qtyMode: this.qtyMode, shotFile: shotPath };
  }

  resolveRegistrationKey(input = {}) {
    if (input.key && this.registrations[input.key]) return input.key;
    const product = String(input.product || input.number || "").trim();
    const exact = [input.key, `P:${product}`, `N:${product}`].filter(Boolean);
    const found = exact.find((key) => this.registrations[key]);
    if (found) return found;
    const optionKeys = Object.keys(this.registrations).filter((key) => key === `O:${product}` || key.startsWith(`O:${product}:`));
    if (optionKeys.length === 1) return optionKeys[0];
    if (this.qtyMode.key && optionKeys.includes(this.qtyMode.key)) return this.qtyMode.key;
    return optionKeys[0] || "";
  }

  applyLatestAsCurrent() {
    const remaining = this.getAllRegistrations().sort((a, b) => Number(b.registeredAtMs || 0) - Number(a.registeredAtMs || 0));
    if (!remaining.length) {
      this.qtyMode = {
        enabled: false,
        key: "",
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
    this.qtyMode.key = next.key || "";
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
    if (this.lastOrder && this.getRegistrationByOrder(this.lastOrder)?.key === reg.key) {
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

  orderUser(uid) {
    if (this.orders[uid]) return { key: uid, user: this.orders[uid] };
    const text = String(uid || "");
    if (this.orders[text]) return { key: text, user: this.orders[text] };
    return null;
  }

  chatAlreadyOnCurrentProduct(chat) {
    const found = this.orderUser(chat.uid);
    if (!found) return false;
    return Object.values(found.user.items || {}).some((item) =>
      item.product === this.qtyMode.product && String(item.msg || "") === String(chat.msg || "")
    );
  }

  releaseForeignOrder(chat, parsedList) {
    const found = this.orderUser(chat.uid);
    if (!found) return false;
    let left = parsedList.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    if (left <= 0) return false;
    let released = false;
    for (const key of Object.keys(found.user.items || {})) {
      if (left <= 0) break;
      const item = found.user.items[key];
      if (!item || item.product === this.qtyMode.product) continue;
      if (String(item.msg || "") !== String(chat.msg || "")) continue;
      if (mentionsAssignedProduct(chat.msg, item.product)) continue;
      const have = Number(item.qty || 0);
      const take = Math.min(have, left);
      if (take <= 0) continue;
      if (take >= have) this.removeItem(found.key, found.user.nick || chat.nick, key, chat.msg);
      else this.setItemQty(found.key, found.user.nick || chat.nick, item, have - take, chat.msg);
      left -= take;
      released = true;
    }
    return released;
  }

  claimOrdersJustBeforeRegistration() {
    const until = Number(this.qtyMode.registeredAtMs || Date.now());
    const since = until - 10000;
    const chats = db.listChats(this.sessionId, 300).filter((chat) => {
      const at = Number(chat.created_ms || 0);
      return at >= since && at <= until;
    });
    const savedEnabled = this.qtyMode.enabled;
    this.qtyMode.enabled = true;
    this.reprocessing = true;
    try {
      for (const chat of chats) {
        if (!chat?.msg) continue;
        if (isCancelIntent(chat.msg) || CANCEL_WORDS.some((word) => String(chat.msg).includes(word))) continue;
        if (parseQtyChangeMessage(chat.msg)) continue;
        if (String(chat.msg).includes("->") || String(chat.msg).includes("→")) continue;
        const parsed = this.parseMessageToOrders(chat.msg).filter(Boolean);
        if (!parsed.length) continue;
        if (parsed.some((item) => item.product !== this.qtyMode.product)) continue;
        if (chat.is_order) {
          if (this.chatAlreadyOnCurrentProduct(chat)) continue;
          if (!this.releaseForeignOrder(chat, parsed)) continue;
        }
        const handled = this.handleIncomingOrder({
          uid: chat.uid,
          nick: chat.nick,
          msg: chat.msg,
          id: chat.chat_key
        });
        if (handled) db.markChatAsOrder(this.sessionId, chat.chat_key);
      }
    } finally {
      this.qtyMode.enabled = savedEnabled;
      this.reprocessing = false;
    }
  }

  toggleQtyMode() {
    if (!this.qtyMode.product) return { ok: false, message: "먼저 상품을 등록하세요." };
    this.qtyMode.enabled = !this.qtyMode.enabled;
    this.onEvent("qty-mode", this.qtyMode);
    return { ok: true, qtyMode: this.qtyMode };
  }

  resetProducts() {
    this.registrations = {};
    this.aliasMap = {};
    db.deleteProductsForSession(this.sessionId);
    this.applyLatestAsCurrent();
    this.onEvent("products-reset", { qtyMode: this.qtyMode, products: [] });
    return { ok: true, qtyMode: this.qtyMode, products: [] };
  }

  clearOrders() {
    this.orders = {};
    this.lastOrder = null;
    this.reviews = [];
    db.deleteOrdersForSession(this.sessionId);
    this.onEvent("orders-cleared", {});
    return { ok: true };
  }

  clearChats() {
    db.deleteChatsForSession(this.sessionId);
    this.onEvent("chats-cleared", {});
    return { ok: true };
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
        amount: item.status === "shortage" ? 0 : item.qty * item.price,
        message: item.msg,
        time: item.time,
        shotFile: item.shotFile,
        matchSource: item.matchSource || "",
        inferred: Boolean(item.inferred),
        stockStatus: item.status || ""
      }))
    );
    const confirmed = orderList.filter((o) => o.stockStatus !== "shortage");
    return {
      products: this.getAllRegistrations(),
      qtyMode: this.qtyMode,
      orders: orderList,
      reviews: this.reviews,
      stats: {
        buyers: new Set(confirmed.map((o) => o.uid)).size,
        orderCount: confirmed.length,
        amount: confirmed.reduce((sum, o) => sum + Number(o.amount || 0), 0)
      }
    };
  }
}

module.exports = { OrderEngine };
