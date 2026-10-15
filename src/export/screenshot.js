const fs = require("fs");
const path = require("path");
const config = require("../config");
const db = require("../db");
const { getOrderKey } = require("../engine/parse");
const { orderShotFileName, productShotFileName } = require("./fileName");

const MAX_PENDING = 12;
let queue = Promise.resolve();
let pending = 0;

function canGrabDesktop() {
  if (process.env.DISABLE_SCREEN_CAPTURE === "1") return false;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return false;
  }
  return true;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

async function grabDesktop() {
  if (!canGrabDesktop()) {
    throw new Error("클라우드 서버에서는 판매자 PC 화면을 찍을 수 없습니다.");
  }
  const screenshot = require("screenshot-desktop");
  return withTimeout(screenshot({ format: "jpg" }), 2500, "화면 캡처가 시간 초과되었습니다.");
}

function findOrderItem(engine, payload) {
  const user = engine.orders[String(payload.uid)];
  if (!user) return null;
  const option = payload.option || "";
  const matches = Object.values(user.items).filter(
    (item) => item.product === payload.product && (item.option || "") === option
  );
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  return matches.find((item) => item.msg === payload.message) || matches[0];
}

function attachShot(engine, payload, fileName) {
  const item = findOrderItem(engine, payload);
  if (!item) return;
  item.shotFile = fileName;
  db.updateOrderShot(engine.sessionId, String(payload.uid), getOrderKey(item), fileName);
}

const MAX_UPLOAD = 3_500_000;

function decodeImage(dataUrl) {
  const raw = String(dataUrl || "").replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
  if (!raw) throw new Error("캡처 이미지가 없습니다.");
  const buf = Buffer.from(raw, "base64");
  if (!buf.length) throw new Error("캡처 이미지가 없습니다.");
  if (buf.length > MAX_UPLOAD) throw new Error("캡처 파일이 너무 큽니다.");
  return buf;
}

function writeShotFile(sessionId, fileName, buffer) {
  const dir = path.join(config.shotsDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), buffer);
  return fileName;
}

async function writeShot(sessionId, payload, seller) {
  const fileName = orderShotFileName({
    seller,
    nick: payload.nickname || payload.uid,
    product: payload.product
  });
  const buf = await grabDesktop();
  return writeShotFile(sessionId, fileName, buf);
}

function saveUploadedOrderShot({ engine, seller, payload, buffer }) {
  const fileName = orderShotFileName({
    seller,
    nick: payload.nickname || payload.uid,
    product: payload.product
  });
  writeShotFile(engine.sessionId, fileName, buffer);
  attachShot(engine, payload, fileName);
  return fileName;
}

function saveUploadedProductShot({ sessionId, seller, productName = "F2", buffer }) {
  const fileName = productShotFileName({ seller, product: productName });
  writeShotFile(sessionId, fileName, buffer);
  return fileName;
}

function captureOrderScreen({ engine, seller, onShot, onFail }, payload) {
  if (!canGrabDesktop()) return;
  if (pending >= MAX_PENDING) return;
  pending += 1;
  queue = queue
    .then(async () => {
      const fileName = await writeShot(engine.sessionId, payload, seller);
      attachShot(engine, payload, fileName);
      if (onShot) onShot({ ...payload, shotFile: fileName });
    })
    .catch((err) => {
      const message = String(err?.message || "").trim() || "화면 캡처에 실패했습니다.";
      console.error("[screenshot]", message);
      if (onFail) onFail(message);
    })
    .finally(() => {
      pending -= 1;
    });
}

function listShotFiles(sessionId) {
  const dir = path.join(config.shotsDir, sessionId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => /\.(jpe?g|png)$/i.test(file))
    .map((file) => {
      const stat = fs.statSync(path.join(dir, file));
      return { file, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map((row) => row.file);
}

const SHOT_KEEP_MS = 24 * 60 * 60 * 1000;

function isShotFolderExpired(session, dirStat, now = Date.now()) {
  if (session && session.status === "running" && !session.stopped_at) return false;
  const stoppedAt = session?.stopped_at || "";
  if (stoppedAt) {
    const t = Date.parse(stoppedAt);
    return Number.isFinite(t) && now - t >= SHOT_KEEP_MS;
  }
  if (session && session.status !== "running") {
    const t = Date.parse(session.started_at || "");
    return Number.isFinite(t) && now - t >= SHOT_KEEP_MS;
  }
  if (session) return false;
  return now - Number(dirStat?.mtimeMs || now) >= SHOT_KEEP_MS;
}

function purgeExpiredShots() {
  const root = config.shotsDir;
  if (!fs.existsSync(root)) return { removed: 0 };
  const now = Date.now();
  let removed = 0;
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const session = db.getLiveSession(name);
    if (!isShotFolderExpired(session, stat, now)) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed += 1;
    } catch (err) {
      console.error("[shot cleanup]", name, err.message);
    }
  }
  if (removed) console.log(`[shot cleanup] removed ${removed} session folder(s)`);
  return { removed };
}

async function captureProductScreen({ sessionId, seller, productName = "F2" }) {
  if (!canGrabDesktop()) {
    throw new Error("클라우드 서버에서는 판매자 PC 화면을 찍을 수 없습니다. 상품 등록은 그대로 할 수 있습니다.");
  }
  const dir = path.join(config.shotsDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = productShotFileName({ seller, product: productName });
  const buf = await grabDesktop();
  fs.writeFileSync(path.join(dir, fileName), buf);
  return fileName;
}

module.exports = {
  canGrabDesktop,
  captureOrderScreen,
  captureProductScreen,
  decodeImage,
  listShotFiles,
  purgeExpiredShots,
  saveUploadedOrderShot,
  saveUploadedProductShot
};
