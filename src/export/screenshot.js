const fs = require("fs");
const path = require("path");
const config = require("../config");
const db = require("../db");
const { getOrderKey } = require("../engine/parse");
const { orderShotFileName, productShotFileName } = require("./fileName");

const MAX_PENDING = 12;
let queue = Promise.resolve();
let pending = 0;

async function grabDesktop() {
  const screenshot = require("screenshot-desktop");
  return screenshot({ format: "jpg" });
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

async function writeShot(sessionId, payload, seller) {
  const dir = path.join(config.shotsDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = orderShotFileName({
    seller,
    nick: payload.nickname || payload.uid,
    product: payload.product
  });
  const filePath = path.join(dir, fileName);
  const buf = await grabDesktop();
  fs.writeFileSync(filePath, buf);
  return fileName;
}

function captureOrderScreen({ engine, seller, onShot, onFail }, payload) {
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

async function captureProductScreen({ sessionId, seller, productName = "F2" }) {
  const dir = path.join(config.shotsDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = productShotFileName({ seller, product: productName });
  const buf = await grabDesktop();
  fs.writeFileSync(path.join(dir, fileName), buf);
  return fileName;
}

module.exports = { captureOrderScreen, captureProductScreen, listShotFiles };
