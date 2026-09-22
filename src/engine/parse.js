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

const ORDER_PHRASES = [
  "부탁드릴께요", "부탁드릴게요", "부탁드려요", "부탁드려용", "부탁할게요", "부탁할께",
  "부탁합니다", "부탁해요", "부탁해용", "부탁해여", "부탁해", "부탁",
  "보내주세요", "사주세요", "시켜주세요", "담아주세요", "시킬게요",
  "결제할게요", "결제할께요", "결제해요", "결제요",
  "신청할게요", "신청해요",
  "주문할게요", "주문할께요", "주문해요", "주문합니다", "주문요", "주문",
  "구매할게요", "구매해요", "구매합니다", "구매요", "구매",
  "살게요", "살께요", "살게여", "살게용", "살게",
  "할게요", "할께요", "할께여", "할게", "할께",
  "주세요", "주세용", "주세여", "주셔요",
  "하나요", "한개", "한장", "두개", "두장", "세개", "세장", "하나"
];

const NON_ORDER_PHRASES = [
  "입어보고싶어요", "입어보고싶어용", "입어보고싶어",
  "가지고싶어요", "가지고싶어용", "가지고싶어여", "가지고싶어", "가지고싶다",
  "갖고싶어요", "갖고싶어용", "갖고싶어여", "갖고싶어", "갖고싶다",
  "사고싶어요", "사고싶어용", "사고싶어여", "사고싶어",
  "입고싶어요", "입고싶어용", "입고싶어",
  "보여주세요", "보여주세용", "보여주세여", "보여줘요", "보여줄래요", "보여줄래", "보여주",
  "알려주세요", "알려줘요", "알려줄래",
  "설명해주세요", "해주세요", "해주세용", "해주세여", "해주셔요"
];

const ORDER_SUFFIX_PHRASES = [
  "부탁드릴께요", "부탁드릴게요", "부탁드려요", "부탁드려용", "부탁할게요",
  "부탁합니다", "부탁해요", "부탁해용", "부탁해여", "부탁해", "부탁",
  "보내주세요", "사주세요", "주세요", "주세용", "주세여",
  "주문요", "주문", "이요", "요"
];

function phrasePattern(phrases) {
  return phrases
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");
}

const ORDER_KEYWORD_RE = new RegExp(`(${phrasePattern(ORDER_PHRASES)})`, "u");
const ORDER_INTENT_RE = new RegExp(`(${phrasePattern([...ORDER_PHRASES, "개", "장"])})`, "u");
const ORDER_SUFFIX_PATTERN = `(?:${phrasePattern(ORDER_SUFFIX_PHRASES)})?`;
const COLOR_SIZE_TRAILING_RE = new RegExp(
  `(${phrasePattern([...ORDER_PHRASES, "사이즈", "컬러", "색상", "색", "번", "요", "개", "장"])})`,
  "g"
);
const QUESTION_RE = /[?？]|문의|있나요|가능|되나요|될까요|얼마|가격|재고|배송|언제|어디|어떻게|어케|맞나요|괜찮나요|입어도|안와요|안오네|문자|끝났나요|끝나나요|끝났어요|끝났습니까|마감인가요|품절인가요|주문하나요|하는법|하는방법/u;
const QUESTION_END_RE = /(나요|는가요|인가요|일까요|을까요|인지요|인지|예요|에요|죠)\s*$/u;

const STATUS_OR_INQUIRY_PHRASES = [
  "오늘도착", "도착했는", "도착했", "도착",
  "남았네요", "남았어요", "남아요", "남았", "남네요", "남음",
  "문자가안", "문자안", "문자가", "문자",
  "안와요", "안오네", "안옵니", "안와서", "안옴", "안떠요",
  "사이트에결제", "사이트에서결제", "사이트에", "사이트에서", "홈페이지에서", "홈페이지에",
  "송장", "운송장", "택배조회",
  "입금했", "입금완료", "결제완료",
  "잘받았", "받았어", "왔네요", "왔어요",
  "몇송이", "송이날",
  "끝났나요", "끝나나요", "끝났어요", "끝났습니까", "끝났음", "끝인가요", "끝났",
  "마감인가요", "마감됐", "마감되었", "마감이야",
  "다팔렸", "다됐나요", "다됐어요", "품절인가요", "품절이야", "품절"
];

const DEFERRED_PURCHASE_PHRASES = [
  "담에살게요", "다음에살게요", "나중에살게요",
  "담에살께요", "다음에살께요", "나중에살께요",
  "담에살게", "다음에살게", "나중에살게",
  "담에살께", "다음에살께", "나중에살께",
  "담에살래요", "다음에살래요", "나중에살래요",
  "담에살래", "다음에살래", "나중에살래",
  "담에살거요", "다음에살거요", "나중에살거요",
  "담에살거", "다음에살거", "나중에살거",
  "담에살", "다음에살", "나중에살",
  "담에주문", "다음에주문", "나중에주문",
  "담에구매", "다음에구매", "나중에구매",
  "담에할게", "다음에할게", "나중에할게",
  "다음번에살", "다음번엔살", "다음번에요"
];

const REACTION_PHRASES = [
  "너무좋네요", "너무좋아요", "너무좋아", "너무맛있",
  "좋네요", "좋아요", "맛있네요", "맛있어요", "맛있어보여", "맛있어",
  "달아요", "달네요", "달콤", "예쁘네요", "예뻐요", "이쁘네요",
  "최고예요", "최고에요", "최고", "대박", "존맛", "굿이요"
];
const CANCEL_WORDS = ["취소", "삭제", "빼주세요", "빼줘", "안할게", "제외", "필요없어"];
const CANCEL_PHRASES = [
  "취소해주세요", "취소할께요", "취소할게요", "취소해줘", "취소할게", "취소할께", "취소요", "주문취소요", "주문취소", "취소",
  "삭제해주세요", "삭제해줘", "삭제요", "삭제",
  "빼주세요", "빼주세용", "빼주시고", "빼줘요", "빼주라", "빼줘",
  "제외해주세요", "제외해줘", "제외",
  "안할게요", "안할께요", "안살게요", "안살께요", "안할게", "안할께", "안살게", "안살께",
  "필요없어요", "필요없어"
];
const CANCEL_TAIL_PATTERN = "(?:취소해주세요|취소할께요|취소할게요|취소해줘|취소할게|취소할께|취소요|주문취소요|주문취소|취소|삭제해주세요|삭제해줘|삭제요|삭제|빼주세요|빼주세용|빼주시고|빼줘요|빼주라|빼줘|제외해주세요|제외해줘|제외|안할게요|안할께요|안살게요|안살께요|안할게|안할께|안살게|안살께|필요없어요|필요없어)";
const FOLLOW_WORDS = [
  "저도주문요", "저두주문요", "나도주문요", "나두주문요",
  "저도주문", "저두주문", "나도주문", "나두주문",
  "저두요", "저도요", "저요",
  "나도요", "나두요",
  "주문요", "ㅈㅇ"
];

function normalizeText(text) {
  return String(text || "").trim();
}

function normalizeCompact(text) {
  return String(text || "").replace(/\s+/g, "");
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removePhrases(text, phrases) {
  let work = String(text || "");
  for (const phrase of phrases.slice().sort((a, b) => b.length - a.length)) {
    work = work.split(phrase).join("");
  }
  return work;
}

function compactForIntent(text) {
  return normalizeCompact(text).replace(/[~!.,?？♡♥❤^ㅋㅎㅠㅜ]/g, "");
}

function normalizeMatchText(text) {
  return compactForIntent(text).toLowerCase().replace(/[/\-_.·•]/g, "");
}

function hasOrderKeyword(text) {
  return ORDER_KEYWORD_RE.test(removePhrases(compactForIntent(text), NON_ORDER_PHRASES));
}

function isBrowseDesireOnly(text) {
  const compact = compactForIntent(text);
  if (!compact) return false;
  return !removePhrases(compact, NON_ORDER_PHRASES);
}

function isNonPurchaseRequest(text) {
  const compact = compactForIntent(text);
  const withoutBrowse = removePhrases(compact, NON_ORDER_PHRASES);
  if (withoutBrowse === compact) return false;
  return !ORDER_KEYWORD_RE.test(withoutBrowse);
}

function isReactionComment(text) {
  if (hasOrderKeyword(text) || isFollowPhrase(text) || hasUnitQty(text)) return false;
  const compact = normalizeMatchText(text);
  if (!compact) return false;
  return REACTION_PHRASES.some((phrase) => compact.includes(normalizeMatchText(phrase)));
}

function isDeferredPurchase(text) {
  const compact = normalizeMatchText(text);
  if (!compact) return false;
  return DEFERRED_PURCHASE_PHRASES.some((phrase) => compact.includes(normalizeMatchText(phrase)));
}

function isStatusOrInquiry(text) {
  const compact = normalizeMatchText(text);
  if (!compact) return false;
  if (!STATUS_OR_INQUIRY_PHRASES.some((phrase) => compact.includes(normalizeMatchText(phrase)))) {
    return false;
  }
  return !hasOrderKeyword(text);
}

function isReplayRequest(text) {
  if (hasUnitQty(text)) return false;
  const compact = normalizeMatchText(text);
  if (/(한번더|한번 더|다시한번|다시해|다시보여|또보여|또한번)/u.test(compact) && !/주문/.test(compact)) return true;
  return false;
}

function isStoreOrAppComplaint(text) {
  const compact = normalizeMatchText(text);
  if (/(안되네|안돼요|안됩니다|안돼요|안됨)/u.test(compact)) return true;
  if (/(네이버|앱|스토어|스마트스토어|탐보|쿠팡|톡스토어|사이트)/u.test(compact)
    && /(없네|없어요|없습니다|없네요|안되)/u.test(compact)) return true;
  return false;
}

function isExistingOrderInquiry(text) {
  const compact = normalizeMatchText(text);
  if (/주문했/.test(compact) && /(오나|언제|배송|추석|추석|도착|이후)/u.test(compact)) return true;
  if (/(추석이후|추석이후|언제와요|언제오나|이후오나)/u.test(compact) && !hasUnitQty(text)) return true;
  return false;
}

function isNonOrderChat(text) {
  return isHowToOrderQuestion(text)
    || isDeferredPurchase(text)
    || isReactionComment(text)
    || isReplayRequest(text)
    || isStoreOrAppComplaint(text)
    || isExistingOrderInquiry(text);
}

function isHowToOrderQuestion(text) {
  const compact = normalizeMatchText(text);
  if (!compact) return false;
  if (/(어케|어떻게|어떡해|어떤게|어떤거).{0,10}(주문|구매|사요|살수|결제)/u.test(compact)) return true;
  if (/(주문|구매)(하나요|하는법|하는방법|은어떻게|은어케|는어떻게|는어케)/u.test(compact)) return true;
  if (/[?？]/.test(String(text)) && /(어케|어떻게|어떡해|하나요|일까요|인가요)$/u.test(compact) && !hasUnitQty(text)) return true;
  return false;
}

function isQuestionLike(text) {
  if (isHowToOrderQuestion(text)) return true;
  if (hasOrderKeyword(text) || isFollowPhrase(text)) return false;
  const compact = normalizeMatchText(text);
  if (!compact) return false;
  if (QUESTION_RE.test(text) || QUESTION_RE.test(compact)) return true;
  if (QUESTION_END_RE.test(compact)) return true;
  return isStatusOrInquiry(text);
}

function isNoiseChat(text) {
  const compact = normalizeMatchText(text);
  if (!compact) return true;
  return compact.length <= 3 && /^[xovㅇㅋㅎㅠㅜw]+$/i.test(compact);
}

function isFollowPhrase(text) {
  return Boolean(parseFollowOrder(text));
}

function parseFollowOrder(text) {
  const compact = normalizeMatchText(text);
  if (!compact) return null;
  const words = FOLLOW_WORDS
    .map((word) => normalizeMatchText(word))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const word of words) {
    if (compact === word) return { qty: 1 };
    if (!compact.startsWith(word)) continue;
    const rest = compact.slice(word.length);
    if (!rest) return { qty: 1 };
    if (/^\d{1,3}(?:개|장|박스|상자|세트|셋트|벌)?$/.test(rest)) {
      return { qty: extractFlexibleQty(rest, 1) };
    }
    if (hasOrderKeyword(rest)) {
      return { qty: extractFlexibleQty(rest, 1) };
    }
  }
  return null;
}

function isOrderSuffixOnly(tail) {
  const compact = normalizeMatchText(tail);
  if (!compact) return true;
  if (isFollowPhrase(compact)) return true;
  return new RegExp(`^(?:${phrasePattern(ORDER_SUFFIX_PHRASES)})+$`, "u").test(compact);
}

function leftoverAfterOrderWords(text) {
  let compact = normalizeMatchText(text);
  compact = removePhrases(compact, [...FOLLOW_WORDS, ...ORDER_PHRASES]);
  compact = compact.replace(/\d+(?:개|장|박스|상자|세트|셋트|벌)?/g, "");
  compact = removePhrases(compact, Object.keys(QTY_WORDS));
  compact = removePhrases(compact, ["조금만", "조금", "빨리", "바로", "지금", "제발", "많이"]);
  return compact.replace(/[0-9]/g, "");
}

function extractSpokenProductName(text) {
  let work = ` ${normalizeText(text)} `;
  const phrases = [...FOLLOW_WORDS, ...ORDER_PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    work = work.split(phrase).join(" ");
  }
  work = work.replace(/\d+\s*(개|장|박스|상자|세트|셋트|벌)?/gu, " ");
  work = work.replace(/[~!.,?？♡♥❤^]/g, " ");
  return work.replace(/\s+/g, " ").trim();
}

function hasOrderIntent(text) {
  return hasOrderKeyword(text) || hasExplicitQty(text) || isFollowPhrase(text);
}

function stripIntentWords(text) {
  return removePhrases(String(text || "").replace(/[@.,!?\s]/g, ""), [...ORDER_PHRASES, "번"]);
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
  const weight = raw.match(/^(\d+(?:\.\d+)?)(kg|키로|킬로|근)$/i);
  if (weight) {
    const n = weight[1];
    add(`${n}kg`, `${n}키로`, `${n}킬로`, `${n}근`);
  }
  return Array.from(aliases);
}

function extractFlexibleQty(text, def = 1) {
  if (!text) return def;
  const compact = normalizeCompact(text);
  let m = compact.match(/^(\d+)$/);
  if (m) return parseInt(m[1], 10);
  m = String(text).match(/(\d+)\s*(개|장|세트|셋트|벌|박스|상자)?/);
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

function optionKeyPart(reg) {
  return (reg?.options || [])
    .map((opt) => normalizeCompact(opt).toLowerCase())
    .filter(Boolean)
    .sort()
    .join(".");
}

function registrationKey(reg) {
  if (!reg) return "";
  if (reg.type === "product") return `P:${reg.product}`;
  if (reg.type === "number") return `N:${reg.number}`;
  if (reg.type === "option") return `O:${reg.product}:${optionKeyPart(reg)}:${Number(reg.price || 0)}`;
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
  if (/(\d+)\s*(개|장|세트|셋트|벌|박스|상자)/u.test(msg)) return true;
  if (/[가-힣A-Za-z]+\s*\d+/u.test(msg)) return true;
  return false;
}

function hasUnitQty(msg) {
  const compact = normalizeCompact(msg);
  return /(\d+)\s*(개|장|세트|셋트|벌|박스|상자)/u.test(msg)
    || /(\d+)(개|장|세트|셋트|벌|박스|상자)/u.test(compact)
    || /(한개|두개|세개|네개|한장|두장)/u.test(compact);
}

function isCancelIntent(msg) {
  const compact = normalizeCompact(msg);
  if (!compact) return false;
  if (["취소", "주문취소", "취소요", "주문취소요"].includes(compact)) return true;
  return CANCEL_PHRASES.some((phrase) => compact.includes(phrase));
}

function parseCancelQty(msg) {
  const text = normalizeText(msg);
  const numberQty = text.match(new RegExp(`(\\d+)\\s*(?:개|장|세트|셋트|벌)?\\s*${CANCEL_TAIL_PATTERN}`, "u"));
  if (numberQty) return Number(numberQty[1] || 0);
  const koreanQty = text.match(new RegExp(`(한\\s*개|한개|하나|두\\s*개|두개|둘|세\\s*개|세개|셋|네\\s*개|네개|넷)\\s*${CANCEL_TAIL_PATTERN}`, "u"));
  if (!koreanQty) return 0;
  const key = String(koreanQty[1] || "").replace(/\s+/g, "");
  return ({ 한개: 1, 하나: 1, 두개: 2, 둘: 2, 세개: 3, 셋: 3, 네개: 4, 넷: 4 })[key] || 0;
}

function stripCancelWords(msg) {
  let work = normalizeText(msg);
  for (const phrase of CANCEL_PHRASES.slice().sort((a, b) => b.length - a.length)) {
    work = work.split(phrase).join(" ");
  }
  return normalizeText(work);
}

function parseQtyChangeMessage(text) {
  const compact = normalizeCompact(text);
  if (!compact) return null;
  let match = compact.match(/^수량(\d{1,3})(?:개|장)?$/);
  if (!match) match = compact.match(/^(\d{1,3})(?:개|장)?(?:로)?변경$/);
  if (!match) return null;
  const qty = Number(match[1]);
  if (!Number.isInteger(qty) || qty <= 0) return null;
  return qty;
}

function isSafeImmediateQty(qty) {
  const n = Number(qty);
  return Number.isInteger(n) && n >= 1 && n <= 10;
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

  work = work.replace(COLOR_SIZE_TRAILING_RE, "");
  if (work) return null;
  if (!items.length) {
    if (allowKeywordOnly && hasOrderKeyword(raw)) return [{ color: "", size: "", qty: extractFlexibleQty(raw, 1) }];
    return null;
  }
  return items;
}

function parseColorSizeQty(text, opts = {}) {
  const items = parseColorSizeQtyList(text, opts);
  return items && items[0] ? items[0] : null;
}

function mentionsAssignedProduct(msg, product) {
  const productCompact = normalizeMatchText(product);
  if (!productCompact) return false;
  return normalizeMatchText(msg).includes(productCompact);
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
  ORDER_PHRASES,
  NON_ORDER_PHRASES,
  ORDER_KEYWORD_RE,
  ORDER_INTENT_RE,
  ORDER_SUFFIX_PATTERN,
  QUESTION_RE,
  CANCEL_WORDS,
  CANCEL_PHRASES,
  FOLLOW_WORDS,
  hasOrderKeyword,
  isBrowseDesireOnly,
  isNonPurchaseRequest,
  isStatusOrInquiry,
  isDeferredPurchase,
  isReactionComment,
  isQuestionLike,
  isHowToOrderQuestion,
  isNonOrderChat,
  isNoiseChat,
  isFollowPhrase,
  parseFollowOrder,
  isOrderSuffixOnly,
  hasOrderIntent,
  leftoverAfterOrderWords,
  extractSpokenProductName,
  stripIntentWords,
  normalizeText,
  normalizeCompact,
  normalizeMatchText,
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
  hasUnitQty,
  isCancelIntent,
  parseCancelQty,
  stripCancelWords,
  parseQtyChangeMessage,
  isSafeImmediateQty,
  parseColorSizeQty,
  parseColorSizeQtyList,
  mentionsAssignedProduct,
  getOrderKey
};
