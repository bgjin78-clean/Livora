const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");
const config = require("../config");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function renderChatShot({ sessionId, platform, channelId, productLabel, chats }) {
  const width = 1080;
  const rows = (chats || []).slice(-16);
  const rowH = 52;
  const height = 220 + rows.length * rowH;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0c0d12";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#e8c37a";
  ctx.fillRect(0, 0, 8, height);

  ctx.fillStyle = "#e8c37a";
  ctx.font = "600 22px sans-serif";
  ctx.fillText("LIVORA CHAT CAPTURE", 40, 48);
  ctx.fillStyle = "#f4f1ea";
  ctx.font = "bold 36px sans-serif";
  ctx.fillText(String(productLabel || "채팅 기록").slice(0, 28), 40, 98);
  ctx.fillStyle = "#8b8794";
  ctx.font = "20px sans-serif";
  ctx.fillText(`${platform}  ·  ${channelId}  ·  ${new Date().toLocaleString("ko-KR")}`, 40, 138);

  rows.forEach((chat, i) => {
    const y = 180 + i * rowH;
    ctx.fillStyle = i % 2 === 0 ? "#14151c" : "#101218";
    ctx.fillRect(28, y, width - 56, rowH - 8);
    ctx.fillStyle = "#7ee0c6";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(String(chat.nick || "").slice(0, 16), 48, y + 32);
    ctx.fillStyle = "#f4f1ea";
    ctx.font = "20px sans-serif";
    ctx.fillText(String(chat.msg || "").slice(0, 42), 250, y + 32);
  });

  const dir = path.join(config.shotsDir, sessionId);
  ensureDir(dir);
  const filePath = path.join(dir, `${stamp()}_chat.jpg`);
  fs.writeFileSync(filePath, canvas.toBuffer("image/jpeg", { quality: 0.92 }));
  return filePath;
}

async function renderInvoices(sessionId, orders) {
  const grouped = {};
  for (const o of orders) {
    const nick = o.nickname || o.nick || "unknown";
    if (!grouped[nick]) grouped[nick] = [];
    grouped[nick].push(o);
  }

  const dir = path.join(config.invoicesDir, sessionId);
  ensureDir(dir);
  const files = [];

  for (const nick of Object.keys(grouped)) {
    const items = grouped[nick];
    const width = 1400;
    const rowHeight = 56;
    const headerHeight = 210;
    const footerHeight = 100;
    const tableHeaderHeight = 54;
    const totalHeight = headerHeight + tableHeaderHeight + items.length * rowHeight + footerHeight;
    const canvas = createCanvas(width, totalHeight);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, totalHeight);
    ctx.strokeStyle = "#d9d0ea";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, width - 40, totalHeight - 40);

    const dateText = `${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월 ${new Date().getDate()}일`;
    const total = items.reduce((sum, i) => sum + Number(i.amount || 0), 0);

    ctx.fillStyle = "#6f42c1";
    ctx.font = "bold 42px sans-serif";
    ctx.fillText(`${nick}님`, 60, 85);
    ctx.font = "bold 32px sans-serif";
    ctx.fillText(dateText, 60, 145);
    ctx.fillStyle = "#222222";
    ctx.font = "28px sans-serif";
    ctx.fillText("구매해 주셔서 감사합니다", 60, 195);

    ctx.fillStyle = "#7d65b1";
    ctx.font = "24px sans-serif";
    ctx.fillText("(기본배송비 3,500원 별도)", 1010, 70);
    ctx.fillStyle = "#222222";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText("합계", 1030, 125);
    ctx.fillStyle = "#6f42c1";
    ctx.font = "bold 54px sans-serif";
    ctx.fillText(`₩${Number(total).toLocaleString("ko-KR")}`, 980, 190);

    const tableX = 40;
    const tableY = 240;
    const colNick = 180;
    const colProduct = 650;
    const colQty = 130;
    const colPrice = 150;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(tableX, tableY, width - 80, tableHeaderHeight);
    ctx.strokeStyle = "#d9d0ea";
    ctx.strokeRect(tableX, tableY, width - 80, tableHeaderHeight);
    ctx.fillStyle = "#222222";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("닉네임", tableX + 28, tableY + 35);
    ctx.fillText("상품명", tableX + colNick + 140, tableY + 35);
    ctx.fillText("수량", tableX + colNick + colProduct + 35, tableY + 35);
    ctx.fillText("단가", tableX + colNick + colProduct + colQty + 35, tableY + 35);
    ctx.fillText("금액", tableX + colNick + colProduct + colQty + colPrice + 35, tableY + 35);

    items.forEach((item, idx) => {
      const y = tableY + tableHeaderHeight + idx * rowHeight;
      ctx.strokeStyle = "#e5e5e5";
      ctx.beginPath();
      ctx.moveTo(tableX, y);
      ctx.lineTo(width - 40, y);
      ctx.stroke();
      const productText = item.option ? `${item.product} ${item.option}` : `${item.product}`;
      ctx.fillStyle = "#222222";
      ctx.font = "24px sans-serif";
      ctx.fillText(String(nick), tableX + 28, y + 37);
      ctx.fillText(String(productText).slice(0, 32), tableX + colNick + 20, y + 37);
      ctx.fillText(String(item.qty), tableX + colNick + colProduct + 45, y + 37);
      ctx.fillText(Number(item.price || 0).toLocaleString("ko-KR"), tableX + colNick + colProduct + colQty + 20, y + 37);
      ctx.fillText(Number(item.amount || 0).toLocaleString("ko-KR"), tableX + colNick + colProduct + colQty + colPrice + 20, y + 37);
    });

    ctx.fillStyle = "#222222";
    ctx.font = "28px sans-serif";
    ctx.fillText("언제나 감사합니다 :)", width / 2 - 110, totalHeight - 45);

    const safeNick = String(nick).replace(/[\\/:*?"<>|]/g, "_");
    const filePath = path.join(dir, `${safeNick}.jpg`);
    fs.writeFileSync(filePath, canvas.toBuffer("image/jpeg", { quality: 0.92 }));
    files.push(filePath);
  }

  return { dir, files };
}

module.exports = { renderChatShot, renderInvoices };
