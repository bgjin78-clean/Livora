const path = require("path");
const ExcelJS = require("exceljs");
const config = require("../config");
const db = require("../db");

const ORDER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF8E2A0" }
};

function orderSizeColor(o) {
  return {
    size: o.size || "",
    color: o.color || (!o.size && o.option_name ? o.option_name : "")
  };
}

function paintOrderCell(sheet, row, key) {
  const col = sheet.getColumn(key);
  const cell = row.getCell(col.number);
  cell.fill = ORDER_FILL;
}

async function writeExcel(sessionId) {
  const orders = db.listOrders(sessionId);
  const chats = db.listChats(sessionId, 5000);
  const products = db.listProducts(sessionId);
  const workbook = new ExcelJS.Workbook();

  const productSheet = workbook.addWorksheet("상품기준");
  productSheet.columns = [
    { header: "상품명", key: "product", width: 24 },
    { header: "사이즈", key: "size", width: 12 },
    { header: "색상", key: "color", width: 12 },
    { header: "수량", key: "qty", width: 10 },
    { header: "단가", key: "price", width: 12 },
    { header: "가격", key: "amount", width: 14 },
    { header: "주문자", key: "nick", width: 20 }
  ];
  const productRows = [...orders].sort((a, b) =>
    String(a.product || "").localeCompare(String(b.product || ""), "ko")
    || String(a.size || "").localeCompare(String(b.size || ""), "ko")
    || String(a.color || "").localeCompare(String(b.color || ""), "ko")
    || String(a.nick || "").localeCompare(String(b.nick || ""), "ko")
  );
  for (const o of productRows) {
    const sc = orderSizeColor(o);
    productSheet.addRow({
      product: o.product,
      size: sc.size,
      color: sc.color,
      qty: o.qty,
      price: o.price,
      amount: o.amount,
      nick: o.nick
    });
  }

  const buyerSheet = workbook.addWorksheet("구매자기준");
  buyerSheet.columns = [
    { header: "닉네임", key: "nick", width: 20 },
    { header: "상품명", key: "product", width: 24 },
    { header: "사이즈", key: "size", width: 12 },
    { header: "색상", key: "color", width: 12 },
    { header: "수량", key: "qty", width: 10 },
    { header: "단가", key: "price", width: 12 },
    { header: "가격", key: "amount", width: 14 },
    { header: "채팅", key: "msg", width: 40 }
  ];
  const buyerRows = [...orders].sort((a, b) =>
    String(a.nick || "").localeCompare(String(b.nick || ""), "ko")
    || String(a.product || "").localeCompare(String(b.product || ""), "ko")
  );
  for (const o of buyerRows) {
    const sc = orderSizeColor(o);
    buyerSheet.addRow({
      nick: o.nick,
      product: o.product,
      size: sc.size,
      color: sc.color,
      qty: o.qty,
      price: o.price,
      amount: o.amount,
      msg: o.msg
    });
  }

  const chatSheet = workbook.addWorksheet("채팅");
  chatSheet.columns = [
    { header: "시각", key: "created_at", width: 22 },
    { header: "닉네임", key: "nick", width: 20 },
    { header: "내용", key: "msg", width: 48 },
    { header: "주문여부", key: "is_order", width: 12 }
  ];
  for (const c of chats) {
    const row = chatSheet.addRow({
      created_at: c.created_at,
      nick: c.nick,
      msg: c.msg,
      is_order: c.is_order ? "주문" : ""
    });
    if (c.is_order) paintOrderCell(chatSheet, row, "msg");
  }

  const productReg = workbook.addWorksheet("등록상품");
  productReg.columns = [
    { header: "유형", key: "type", width: 12 },
    { header: "상품", key: "product", width: 20 },
    { header: "번호", key: "number", width: 10 },
    { header: "옵션", key: "options_json", width: 24 },
    { header: "가격", key: "price", width: 12 },
    { header: "재고", key: "stock", width: 10 },
    { header: "등록시각", key: "created_at", width: 22 }
  ];
  for (const p of products) productReg.addRow(p);

  const filePath = path.join(config.exportsDir, `${sessionId}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

function chatStamp(chat) {
  if (chat.created_at) return String(chat.created_at);
  if (chat.created_ms) {
    const d = new Date(chat.created_ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  return "";
}

function chatDate(chat) {
  return chatStamp(chat).slice(0, 10);
}

async function writeChatRows(chats, fileStem) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("채팅");
  sheet.columns = [
    { header: "일자", key: "date", width: 22 },
    { header: "ID", key: "id", width: 28 },
    { header: "채팅내용", key: "msg", width: 80 }
  ];
  for (const chat of chats) {
    const row = sheet.addRow({
      date: chatStamp(chat),
      id: chat.uid || chat.nick || "",
      msg: chat.msg || ""
    });
    if (chat.is_order) paintOrderCell(sheet, row, "msg");
  }
  const day = chatDate(chats[chats.length - 1] || {}) || new Date().toISOString().slice(0, 10);
  const filePath = path.join(config.exportsDir, `${fileStem}-chats-${day}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

async function writeChatExcel(sessionId) {
  return writeChatRows(db.listAllChats(sessionId), sessionId);
}

async function writeUserDayChatExcel(userId, { platform, channelId } = {}) {
  let chats = db.listChatsForUserToday(userId, { platform, channelId });
  if (!chats.length) chats = db.listChatsForUserToday(userId);
  const stem = ["user", userId, platform || "all", channelId || "chats"].join("-");
  return writeChatRows(chats, stem);
}

module.exports = { writeExcel, writeChatExcel, writeUserDayChatExcel };
