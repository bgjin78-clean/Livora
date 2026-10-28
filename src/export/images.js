const fs = require("fs");
const path = require("path");
const { createCanvas, registerFont } = require("canvas");
const config = require("../config");

const FONT_FAMILY = "LivoraKR";

function registerKoreanFonts() {
  const bundled = path.join(__dirname, "..", "..", "fonts");
  const candidates = [
    { file: path.join(bundled, "NotoSansKR-Regular.otf"), weight: "normal" },
    { file: path.join(bundled, "NotoSansKR-Bold.otf"), weight: "bold" },
    { file: "C:\\Windows\\Fonts\\malgun.ttf", weight: "normal" },
    { file: "C:\\Windows\\Fonts\\malgunbd.ttf", weight: "bold" },
    { file: "/usr/share/fonts/truetype/nanum/NanumGothic.ttf", weight: "normal" },
    { file: "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf", weight: "bold" }
  ];
  const registered = new Set();
  for (const item of candidates) {
    if (registered.has(item.weight) || !fs.existsSync(item.file)) continue;
    try {
      registerFont(item.file, { family: FONT_FAMILY, weight: item.weight });
      registered.add(item.weight);
    } catch (err) {
      console.error("[font]", path.basename(item.file), err.message);
    }
  }
  if (!registered.size) {
    console.error("[font] 한글 폰트를 찾지 못했습니다. 정산서 글자가 깨질 수 있습니다.");
  }
}

registerKoreanFonts();

function krFont(size, weight = "normal") {
  return `${weight === "bold" ? "bold " : ""}${size}px "${FONT_FAMILY}", "Malgun Gothic", sans-serif`;
}

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
  ctx.font = krFont(22, "bold");
  ctx.fillText("LIVORA CHAT CAPTURE", 40, 48);
  ctx.fillStyle = "#f4f1ea";
  ctx.font = krFont(36, "bold");
  ctx.fillText(String(productLabel || "채팅 기록").slice(0, 28), 40, 98);
  ctx.fillStyle = "#8b8794";
  ctx.font = krFont(20);
  ctx.fillText(`${platform}  ·  ${channelId}  ·  ${new Date().toLocaleString("ko-KR")}`, 40, 138);

  rows.forEach((chat, i) => {
    const y = 180 + i * rowH;
    ctx.fillStyle = i % 2 === 0 ? "#14151c" : "#101218";
    ctx.fillRect(28, y, width - 56, rowH - 8);
    ctx.fillStyle = "#7ee0c6";
    ctx.font = krFont(20, "bold");
    ctx.fillText(String(chat.nick || "").slice(0, 16), 48, y + 32);
    ctx.fillStyle = "#f4f1ea";
    ctx.font = krFont(20);
    ctx.fillText(String(chat.msg || "").slice(0, 42), 250, y + 32);
  });

  const dir = path.join(config.shotsDir, sessionId);
  ensureDir(dir);
  const filePath = path.join(dir, `${stamp()}_chat.jpg`);
  fs.writeFileSync(filePath, canvas.toBuffer("image/jpeg", { quality: 0.92 }));
  return filePath;
}

function invoiceOptionText(item) {
  const parts = [item.option, item.option_name, item.color, item.size]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return [...new Set(parts)].join(" ");
}

function wrapText(ctx, text, maxWidth) {
  const chars = [...String(text || "")];
  const lines = [];
  let line = "";
  for (const ch of chars) {
    const next = line + ch;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function money(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function parseShipping(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function invoiceDate(items) {
  const raw = String((items || []).map((item) => item.time || item.created_at || "").find(Boolean) || "");
  const match = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  const date = match
    ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
    : { y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: new Date().getDate() };
  return `${date.y}년 ${date.m}월 ${date.d}일`;
}

function buyerLabel(nick) {
  const name = String(nick || "구매자").trim() || "구매자";
  return name.startsWith("@") ? name : `@${name}`;
}

async function renderInvoices(sessionId, orders, options = {}) {
  const shipping = parseShipping(options.shipping);
  const grouped = {};
  for (const order of orders || []) {
    const nick = String(order.nickname || order.nick || "").trim() || "구매자";
    if (!grouped[nick]) grouped[nick] = [];
    grouped[nick].push(order);
  }

  const dir = path.join(config.invoicesDir, sessionId);
  ensureDir(dir);
  const files = [];
  const width = 1500;
  const pad = 40;
  const tableW = width - pad * 2;
  const columns = [
    { label: "닉네임", x: 0, w: 340, align: "left" },
    { label: "상품명", x: 340, w: 520, align: "left" },
    { label: "수량", x: 860, w: 140, align: "right" },
    { label: "단가", x: 1000, w: 180, align: "right" },
    { label: "금액", x: 1180, w: 240, align: "right" }
  ];

  for (const nick of Object.keys(grouped)) {
    const items = grouped[nick];
    const label = buyerLabel(nick);
    const measure = createCanvas(width, 200).getContext("2d");
    measure.font = krFont(22);
    const rows = items.map((item) => {
      const option = invoiceOptionText(item);
      const title = option ? `${item.product || "상품"} ${option}` : String(item.product || "상품");
      const lines = wrapText(measure, title, columns[1].w - 28);
      const qty = Number(item.qty || 0);
      const price = Number(item.price || 0);
      const amount = Number(item.amount || qty * price);
      return {
        nick: label,
        lines,
        qty,
        price,
        amount,
        height: Math.max(54, lines.length * 30 + 24)
      };
    });
    rows.push(shipping
      ? {
          nick: label,
          lines: ["배송비"],
          qty: 1,
          price: shipping,
          amount: shipping,
          height: 54,
          shipping: true
        }
      : {
          nick: label,
          lines: ["무료배송"],
          qtyText: "",
          priceText: "",
          amountText: "무료",
          qty: 0,
          price: 0,
          amount: 0,
          height: 54,
          shipping: true
        });
    const goods = rows.filter((row) => !row.shipping).reduce((sum, row) => sum + row.amount, 0);
    const total = goods + (shipping || 0);
    const tableH = 48 + rows.reduce((sum, row) => sum + row.height, 0);
    const height = 210 + tableH + 90;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#6f42c1";
    ctx.font = krFont(34, "bold");
    ctx.fillText(`${label}님`, pad, 62);
    ctx.font = krFont(28, "bold");
    ctx.fillText(invoiceDate(items), pad, 108);
    ctx.fillStyle = "#666666";
    ctx.font = krFont(22);
    ctx.fillText("구매해 주셔서 감사합니다", pad, 148);

    ctx.textAlign = "right";
    ctx.fillStyle = "#666666";
    ctx.font = krFont(20);
    ctx.fillText("합계", width - pad, 58);
    ctx.fillStyle = "#6f42c1";
    ctx.font = krFont(48, "bold");
    ctx.fillText(`₩${money(total)}`, width - pad, 112);
    ctx.fillStyle = "#888888";
    ctx.font = krFont(18);
    ctx.fillText(shipping ? `배송비 ${money(shipping)}원 포함` : "무료배송", width - pad, 146);
    ctx.textAlign = "left";

    let y = 186;
    const tableTop = y;
    const drawText = (text, col, top, color) => {
      ctx.fillStyle = color;
      ctx.textAlign = col.align;
      const textX = col.align === "right" ? pad + col.x + col.w - 16 : pad + col.x + 16;
      ctx.fillText(text, textX, top);
      ctx.textAlign = "left";
    };
    ctx.strokeStyle = "#d9d3e6";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, y, tableW, tableH);
    ctx.fillStyle = "#f7f4fb";
    ctx.fillRect(pad, y, tableW, 48);
    ctx.font = krFont(20, "bold");
    columns.forEach((col) => drawText(col.label, col, y + 31, "#555555"));
    y += 48;

    for (const row of rows) {
      ctx.beginPath();
      ctx.moveTo(pad, y + row.height);
      ctx.lineTo(pad + tableW, y + row.height);
      ctx.stroke();
      ctx.font = krFont(22);
      drawText(row.nick, columns[0], y + 34, "#333333");
      row.lines.forEach((line, index) => {
        drawText(line, columns[1], y + 34 + index * 30, "#333333");
      });
      drawText(row.qtyText != null ? row.qtyText : String(row.qty), columns[2], y + 34, "#333333");
      drawText(row.priceText != null ? row.priceText : money(row.price), columns[3], y + 34, "#333333");
      drawText(row.amountText != null ? row.amountText : money(row.amount), columns[4], y + 34, "#333333");
      y += row.height;
    }
    ctx.beginPath();
    columns.slice(1).forEach((col) => {
      ctx.moveTo(pad + col.x, tableTop);
      ctx.lineTo(pad + col.x, tableTop + tableH);
    });
    ctx.stroke();
    ctx.strokeRect(pad, tableTop, tableW, tableH);

    ctx.fillStyle = "#777777";
    ctx.font = krFont(22);
    ctx.textAlign = "center";
    ctx.fillText("언제나 감사합니다 :)", width / 2, y + 48);
    ctx.textAlign = "left";

    const safeNick = String(nick).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "구매자";
    const filePath = path.join(dir, `정산서_${safeNick}.jpg`);
    fs.writeFileSync(filePath, canvas.toBuffer("image/jpeg", { quality: 0.92 }));
    files.push(filePath);
  }

  return { dir, files };
}

module.exports = { renderChatShot, renderInvoices, parseShipping };
