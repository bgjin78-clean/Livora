const http = require("http");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const config = require("./config");
const db = require("./db");
const { createRouter } = require("./routes");
const { attachRealtime, broadcastToUser } = require("./realtime");
const { purgeExpiredShots } = require("./export/screenshot");
const { purgeExpiredFiles } = require("./export/keep");

db.open();

function startShotCleanup() {
  const run = () => {
    try {
      purgeExpiredShots();
      purgeExpiredFiles();
    } catch (err) {
      console.error("[shot cleanup]", err.message);
    }
  };
  run();
  setInterval(run, 60 * 60 * 1000);
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));
app.use(cookieParser());
app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "livora" });
});
app.use("/api", createRouter(broadcastToUser));
app.use(express.static(path.join(config.rootDir, "public")));
app.use((err, req, res, next) => {
  console.error("[http]", err.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, message: String(err.message || "").trim() || "요청을 처리하지 못했습니다." });
});

const server = http.createServer(app);
attachRealtime(server);

server.listen(config.port, config.host, () => {
  startShotCleanup();
  console.log(`Livora  http://${config.host}:${config.port}`);
});
