const http = require("http");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const config = require("./config");
const db = require("./db");
const { createRouter } = require("./routes");
const { attachRealtime, broadcastToUser } = require("./realtime");

db.open();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", createRouter(broadcastToUser));
app.use(express.static(path.join(config.rootDir, "public")));

const server = http.createServer(app);
attachRealtime(server);

server.listen(config.port, () => {
  console.log(`Livora  http://localhost:${config.port}`);
});
