function safeSegment(text, fallback = "file") {
  return String(text || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || fallback;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDateStamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function localDateTimeStamp(d = new Date()) {
  return `${localDateStamp(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sellerFileTag(user) {
  return safeSegment(user?.username || user?.name || (user?.id != null ? `id${user.id}` : ""), "seller");
}

function orderShotFileName({ seller, nick, product, at } = {}) {
  return [
    localDateTimeStamp(at),
    sellerFileTag(seller),
    safeSegment(nick, "buyer"),
    safeSegment(product, "item")
  ].join("_") + ".jpg";
}

function productShotFileName({ seller, product, at } = {}) {
  return [
    localDateTimeStamp(at),
    sellerFileTag(seller),
    "F2",
    safeSegment(product, "product")
  ].join("_") + ".jpg";
}

function excelFileName({ seller, kind, at } = {}) {
  return `${localDateStamp(at)}_${sellerFileTag(seller)}_${kind || "orders"}.xlsx`;
}

module.exports = {
  safeSegment,
  localDateStamp,
  localDateTimeStamp,
  sellerFileTag,
  orderShotFileName,
  productShotFileName,
  excelFileName
};
