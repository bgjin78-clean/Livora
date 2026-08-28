const COLORS = {
  "검정": "블랙", "검": "블랙", "블랙": "블랙",
  "흰": "화이트", "흰색": "화이트", "화이트": "화이트",
  "아이보리": "아이보리", "크림": "크림", "오트밀": "오트밀",
  "베이지": "베이지", "배이지": "베이지", "뻬이지": "베이지", "배이쥐": "베이지", "베": "베이지",
  "네이비": "네이비", "네": "네이비",
  "블루": "블루", "파": "블루", "파랑": "블루", "소라": "소라",
  "그레이": "그레이", "회": "그레이",
  "차콜": "차콜", "먹색": "차콜",
  "핑크": "핑크", "카키": "카키", "브라운": "브라운",
  "레드": "레드", "빨강": "레드",
  "연청": "연청", "중청": "중청", "진청": "진청",
  "민트": "민트"
};

const SIZE_LIST = ["xs", "s", "m", "l", "xl", "xxl", "free", "f", "55", "66", "77", "88"];

const SIZE_ALIAS = {
  s: "s", small: "s", 스몰: "s", 에스: "s", "90": "s",
  m: "m", medium: "m", 미듐: "m", 엠: "m", "95": "m",
  l: "l", large: "l", 라지: "l", 엘: "l", "100": "l",
  xl: "xl", xlarge: "xl", 엑라: "xl", 엑스라지: "xl", 엑스트라라지: "xl", "x라지": "xl", "105": "xl",
  xxl: "xxl", "2xl": "xxl", 투엑라: "xxl", 투엑스라지: "xxl", "2엑라": "xxl", "110": "xxl",
  프리: "free", free: "free", f: "f",
  "55": "55", "66": "66", "77": "77", "88": "88"
};

const QTY_WORDS = {
  한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4,
  다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10
};

const ORDER_KEYWORD_RE = /(주세요|주문요|주문|구매요|구매|살게요|살게|할게요|할게|할께요|할께|하나요|하나|한개|한장|두개|두장|세개|세장)/u;
const ORDER_INTENT_RE = /(주세요|주문|구매|살게|살게요|할게|할게요|할께|할께요|하나|한개|한장|두개|두장|세개|세장|개|장)/u;
const QUESTION_RE = /[?？]|문의|있나요|가능|되나요|될까요|얼마|가격|재고|배송|언제|어디|어떻게|맞나요|괜찮나요|입어도/u;
const CANCEL_WORDS = ["취소", "삭제", "빼주세요", "빼", "안할게"];
const FOLLOW_WORDS = ["저두요", "저도요", "저요", "주문요", "나도요", "나두요", "ㅈㅇ"];

function normalizeText(text) {
  return String(text || "").trim();
}

function normalizeCompact(text) {
  return String(text || "").replace(/\s+/g, "");
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toMoney(v) {
  return Number(String(v || "0").replace(/[^0-9]/g, "")) || 0;
}

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function makeChatId(uid, msg, timeMs) {
  return `${uid}::${normalizeCompact(msg)}::${timeMs}`;
}

function normalizeOptionAlias(input) {
  const t = String(input || "").toLowerCase().replace(/\s+/g, "");
  return SIZE_ALIAS[t] || t;
}

function normalizeOptionToSize(option) {
  const normalized = normalizeOptionAlias(option);
  return SIZE_LIST.includes(normalized) ? normalized : "";
}

function normalizeOptionToColor(option) {
  return COLORS[option] || "";
}

function getOptionAliases(opt) {
  const raw = String(opt || "").toLowerCase().replace(/\s+/g, "");
  const aliases = new Set([raw]);
  const add = (...vals) => vals.forEach((v) => {
    const t = String(v || "").toLowerCase().replace(/\s+/g, "");
    if (t) aliases.add(t);
  });

  const numToAlpha = { "90": "s", "95": "m", "100": "l", "105": "xl", "110": "xxl" };
  const alphaToNum = { s: "90", m: "95", l: "100", xl: "105", xxl: "110" };
  const normalized = normalizeOptionAlias(raw);
  add(normalized);
  if (numToAlpha[raw]) add(numToAlpha[raw]);
  if (alphaToNum[raw]) add(alphaToNum[raw]);
  if (alphaToNum[normalized]) add(alphaToNum[normalized]);
  if (raw === "90" || normalized === "s") add("90", "s", "small", "스몰", "에스");
  if (raw === "95" || normalized === "m") add("95", "m", "medium", "미듐", "엠");
  if (raw === "100" || normalized === "l") add("100", "l", "large", "라지", "엘");
  if (raw === "105" || normalized === "xl") add("105", "xl", "xlarge", "엑라", "엑스라지");
  if (raw === "110" || normalized === "xxl") add("110", "xxl", "2xl", "xxlarge", "투엑라", "투엑스라지", "2엑라");
  return Array.from(aliases);
}

function extractFlexibleQty(text, def = 1) {
  if (!text) return def;
  const compact = normalizeCompact(text);
  let m = compact.match(/^(\d+)$/);
  if (m) return parseInt(m[1], 10);
  m = String(text).match(/(\d+)\s*(개|장|세트|벌)?/);
  if (m) return parseInt(m[1], 10);
  if (QTY_WORDS[compact]) return QTY_WORDS[compact];
  const nums = String(text).match(/(\d+\.?|\.\d+)/g);
  if (nums?.length) return parseInt(String(nums[nums.length - 1]).replace(".", ""), 10);
  return def;
}

function splitOptions(raw) {
  return String(raw || "")
    .split(/[,./|\s]+/)
    .map((v) => normalizeText(v))
    .filter(Boolean);
}

function digitsOrEmpty(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function composeRegistrationFields({ name, number, option, size, color, qty, price, stock, fallbackProduct } = {}) {
  const numberText = digitsOrEmpty(number);
  let product = numberText || normalizeText(name);
  const sizeParts = splitOptions(size);
  const colorParts = splitOptions(color);
  const optionParts = splitOptions(option);
  const optionList = [...new Set([...sizeParts, ...colorParts, ...optionParts])];
  let options = optionList.join(".");
  const priceText = digitsOrEmpty(price);
  const stockText = digitsOrEmpty(stock);
  const qtyText = digitsOrEmpty(qty);

  if (!product && options && /^\d+$/.test(options) && optionList.length === 1) {
    product = options;
    options = "";
  }
  if (!product && options && optionList.length === 1 && sizeParts.length + colorParts.length === 0) {
    product = optionList[0];
    options = "";
  }
  if (!product && fallbackProduct) product = normalizeText(fallbackProduct);
  if (!product) {
    return { ok: true, empty: true, payload: "", defaultQty: 1, sizes: [], colors: [], label: "" };
  }

  if (product.includes("=") && !options && !priceText && !stockText) {
    return { ok: true, payload: product, defaultQty: 1, sizes: sizeParts, colors: colorParts, label: product };
  }

  const parts = [product];
  const isNumberProduct = Boolean(numberText) || /^\d+$/.test(product);

  if (!isNumberProduct && options) {
    parts.push(options);
    if (priceText || stockText) parts.push(priceText || "0");
    if (stockText) parts.push(stockText);
  } else {
    if (priceText) parts.push(priceText);
    else if (stockText) parts.push("0");
    if (stockText) parts.push(stockText);
  }

  const nameText = normalizeText(name);
  const label = isNumberProduct && nameText && nameText !== product
    ? `${product} ${nameText}`
    : "";

  return {
    ok: true,
    payload: parts.join("|"),
    defaultQty: Number(qtyText || 1),
    sizes: sizeParts,
    colors: colorParts,
    label
  };
}

function parseRegistrationPayload(payload) {
  const text = normalizeText(payload);
  if (!text) return null;

  if (text.includes("=") && !text.includes("|")) {
    const [productRaw, aliasRaw] = text.split("=");
    const product = normalizeText(productRaw);
    const alias = normalizeText(aliasRaw);
    if (!product || !alias) return null;
    return { type: "alias", product, alias, displayName: `${product}=${alias}` };
  }

  const parts = text.split("|").map((v) => normalizeText(v)).filter(Boolean);
  if (!parts.length) return null;

  if (/^\d+$/.test(parts[0])) {
    if (parts.length === 1) return { type: "number", number: parts[0], price: 0, stock: 0, displayName: parts[0] };
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      return { type: "number", number: parts[0], price: toMoney(parts[1]), stock: 0, displayName: `${parts[0]}|${parts[1]}` };
    }
    if (parts.length === 3 && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
      return { type: "number", number: parts[0], price: toMoney(parts[1]), stock: toMoney(parts[2]), displayName: `${parts[0]}|${parts[1]}|${parts[2]}` };
    }
    return null;
  }

  if (parts.length === 1) return { type: "product", product: parts[0], price: 0, stock: 0, displayName: parts[0] };
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { type: "product", product: parts[0], price: toMoney(parts[1]), stock: 0, displayName: `${parts[0]}|${parts[1]}` };
  }
  if (parts.length === 3 && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
    return { type: "product", product: parts[0], price: toMoney(parts[1]), stock: toMoney(parts[2]), displayName: `${parts[0]}|${parts[1]}|${parts[2]}` };
  }
  if (parts.length === 2) {
    const options = splitOptions(parts[1]);
    if (!options.length) return null;
    return { type: "option", product: parts[0], options, price: 0, stock: 0, displayName: `${parts[0]}|${parts[1]}` };
  }
  if (parts.length === 3 && /^\d+$/.test(parts[2])) {
    const options = splitOptions(parts[1]);
    if (!options.length) return null;
    return { type: "option", product: parts[0], options, price: toMoney(parts[2]), stock: 0, displayName: `${parts[0]}|${parts[1]}|${parts[2]}` };
  }
  if (parts.length === 4 && /^\d+$/.test(parts[2]) && /^\d+$/.test(parts[3])) {
    const options = splitOptions(parts[1]);
    if (!options.length) return null;
    return { type: "option", product: parts[0], options, price: toMoney(parts[2]), stock: toMoney(parts[3]), displayName: `${parts[0]}|${parts[1]}|${parts[2]}|${parts[3]}` };
  }
  return null;
}

function registrationKey(reg) {
  if (!reg) return "";
  if (reg.type === "product") return `P:${reg.product}`;
  if (reg.type === "number") return `N:${reg.number}`;
  if (reg.type === "option") return `O:${reg.product}`;
  return "";
}

function isManagerStyleMessage(msg) {
  const compact = normalizeCompact(msg);
  if (normalizeText(msg).length >= 18) return true;
  const managerWords = [
    "원", "가격", "택배", "택배비", "배송비", "남았", "남아요", "남음", "재고",
    "오픈", "시작", "종료", "이벤트", "행사", "가능", "있어요", "있습니다", "안내", "공지",
    "사이즈표", "주문방법", "주문은", "댓글", "문의", "명", "인", "제한", "이상", "이하",
    "부터", "까지", "시", "분", "초", "번째", "차", "컬러는", "색상은"
  ];
  return managerWords.some((w) => compact.includes(w));
}

function hasExplicitQty(msg) {
  const compact = normalizeCompact(msg);
  if (/^\d+\.\d+$/u.test(compact)) return true;
  if (/^\.*\d+\.?$/u.test(compact)) return true;
  if (/^\d+\s+\d+/u.test(msg)) return true;
  if (/(\d+)\s*(개|장|세트|셋트|벌)/u.test(msg)) return true;
  if (/[가-힣A-Za-z]+\s*\d+/u.test(msg)) return true;
  return false;
}

const AMBIGUOUS_COLORS = new Set(["네", "베", "파", "회"]);

function aliasKeys(map) {
  return Object.keys(map).sort((a, b) => b.length - a.length);
}

function takeAliasFromStart(work, map, skip) {
  const lower = String(work || "").toLowerCase();
  for (const alias of aliasKeys(map)) {
    if (skip && skip.has(alias)) continue;
    const needle = alias.toLowerCase();
    if (!lower.startsWith(needle)) continue;
    if (alias.length === 1 && /[가-힣]/.test(alias)) {
      const after = work.slice(alias.length);
      const sizeFollows = aliasKeys(SIZE_ALIAS).some((size) =>
        after.toLowerCase().startsWith(String(size).toLowerCase())
      );
      if (!sizeFollows) continue;
    }
    return { value: map[alias], rest: work.slice(alias.length) };
  }
  return null;
}

function parseColorSizeQtyList(text, { allowBareNumber = false, allowKeywordOnly = false } = {}) {
  const raw = normalizeText(text);
  if (!raw) return null;
  let work = normalizeCompact(raw).replace(/[~!.,?？♡♥❤]/g, "");
  if (!work) return null;

  if (allowBareNumber && /^\d+$/.test(work)) {
    return [{ color: "", size: "", qty: Number(work) }];
  }

  const items = [];
  while (work) {
    work = work.replace(/^[,./]+/, "");
    if (!work) break;
    const colorHit = takeAliasFromStart(work, COLORS, AMBIGUOUS_COLORS);
    if (colorHit) work = colorHit.rest;
    const sizeHit = takeAliasFromStart(work, SIZE_ALIAS);
    if (sizeHit) work = sizeHit.rest;
    if (!colorHit && !sizeHit) break;
    let qty = 1;
    const qtyHit = work.match(/^(\d+)/);
    if (qtyHit) {
      qty = Number(qtyHit[1]);
      work = work.slice(qtyHit[1].length);
    }
    work = work.replace(/^(개|장|세트|셋트|벌)/, "");
    items.push({
      color: colorHit ? colorHit.value : "",
      size: sizeHit ? sizeHit.value : "",
      qty
    });
  }

  work = work.replace(/(주세요|주문요|주문|구매요|구매|살게요|살게|할게요|할게|할께요|할께|하나요|한개|한장|두개|두장|세개|세장|사이즈|컬러|색상|색|번|요|개|장)/g, "");
  if (work) return null;
  if (!items.length) {
    if (allowKeywordOnly && ORDER_KEYWORD_RE.test(raw)) return [{ color: "", size: "", qty: extractFlexibleQty(raw, 1) }];
    return null;
  }
  return items;
}

function parseColorSizeQty(text, opts = {}) {
  const items = parseColorSizeQtyList(text, opts);
  return items && items[0] ? items[0] : null;
}

function mentionsAssignedProduct(msg, product) {
  const productCompact = normalizeCompact(product).toLowerCase();
  if (!productCompact) return false;
  return normalizeCompact(msg).toLowerCase().includes(productCompact);
}

function getOrderKey(orderObj) {
  return [
    orderObj.productKey || `${orderObj.product || ""}__${orderObj.shotFile || ""}`,
    orderObj.option || "",
    orderObj.color || "",
    orderObj.size || "",
    orderObj.price || 0
  ].join("||");
}

module.exports = {
  COLORS,
  SIZE_ALIAS,
  ORDER_KEYWORD_RE,
  ORDER_INTENT_RE,
  QUESTION_RE,
  CANCEL_WORDS,
  FOLLOW_WORDS,
  normalizeText,
  normalizeCompact,
  escapeRegex,
  toMoney,
  now,
  makeChatId,
  normalizeOptionAlias,
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
  parseColorSizeQty,
  parseColorSizeQtyList,
  mentionsAssignedProduct,
  getOrderKey
};
