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
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

async function renderInvoices(sessionId, orders) {
  const grouped = {};
  for (const order of orders || []) {
    const nick = String(order.nickname || order.nick || "").trim() || "구매자";
    if (!grouped[nick]) grouped[nick] = [];
    grouped[nick].push(order);
  }

  const dir = path.join(config.invoicesDir, sessionId);
  ensureDir(dir);
  const files = [];
  const width = 900;
  const pad = 48;

  for (const nick of Object.keys(grouped)) {
    const items = grouped[nick];
    const measure = createCanvas(width, 200).getContext("2d");
    measure.font = krFont(28);
    const rows = items.map((item) => {
      const option = invoiceOptionText(item);
      const title = option ? `${item.product || "상품"}  ${option}` : String(item.product || "상품");
      const lines = wrapText(measure, title, 520);
      const qty = Number(item.qty || 0);
      const amount = Number(item.amount || qty * Number(item.price || 0));
      return { lines, qty, amount, height: Math.max(72, lines.length * 36 + 28) };
    });
    const height = 280 + rows.reduce((sum, row) => sum + row.height, 0) + 180;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#6f42c1";
    ctx.fillRect(0, 0, width, 12);

    const dateText = `${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월 ${new Date().getDate()}일`;
    ctx.fillStyle = "#6f42c1";
    ctx.font = krFont(26, "bold");
    ctx.fillText("구매 정산서", pad, 64);
    ctx.fillStyle = "#222222";
    ctx.font = krFont(40, "bold");
    ctx.fillText(`${nick} 님`, pad, 122);
    ctx.fillStyle = "#666666";
    ctx.font = krFont(22);
    ctx.fillText(dateText, pad, 164);
    ctx.fillText("구매해 주셔서 감사합니다.", pad, 200);

    let y = 250;
    ctx.fillStyle = "#f6f3fb";
    ctx.fillRect(pad, y, width - pad * 2, 48);
    ctx.fillStyle = "#555555";
    ctx.font = krFont(20, "bold");
    ctx.fillText("상품", pad + 16, y + 32);
    ctx.fillText("수량", 600, y + 32);
    ctx.textAlign = "right";
    ctx.fillText("금액", width - pad - 16, y + 32);
    ctx.textAlign = "left";
    y += 48;

    let total = 0;
    for (const row of rows) {
      ctx.strokeStyle = "#eee8f6";
      ctx.beginPath();
      ctx.moveTo(pad, y + row.height);
      ctx.lineTo(width - pad, y + row.height);
      ctx.stroke();
      ctx.fillStyle = "#222222";
      ctx.font = krFont(26);
      row.lines.forEach((line, index) => ctx.fillText(line, pad + 16, y + 40 + index * 36));
      ctx.font = krFont(26);
      ctx.fillText(String(row.qty), 616, y + 40);
      ctx.textAlign = "right";
      ctx.fillText(money(row.amount), width - pad - 16, y + 40);
      ctx.textAlign = "left";
      total += row.amount;
      y += row.height;
    }

    y += 28;
    ctx.fillStyle = "#222222";
    ctx.font = krFont(28, "bold");
    ctx.fillText("합계", pad + 16, y + 36);
    ctx.fillStyle = "#6f42c1";
    ctx.font = krFont(36, "bold");
    ctx.textAlign = "right";
    ctx.fillText(money(total), width - pad - 16, y + 38);
    ctx.textAlign = "left";
    ctx.fillStyle = "#777777";
    ctx.font = krFont(20);
    ctx.fillText("배송비는 별도입니다.", pad, y + 88);
    ctx.fillText("감사합니다.", pad, y + 122);

    const safeNick = String(nick).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "구매자";
    const filePath = path.join(dir, `정산서_${safeNick}.jpg`);
    fs.writeFileSync(filePath, canvas.toBuffer("image/jpeg", { quality: 0.92 }));
    files.push(filePath);
  }

  return { dir, files };
}

module.exports = { renderChatShot, renderInvoices };
