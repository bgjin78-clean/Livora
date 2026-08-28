const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

module.exports = {
  port: Number(process.env.PORT || 4173),
  jwtSecret: process.env.JWT_SECRET || "livora-dev-secret-change-me",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "livora-admin",
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  rootDir: path.join(__dirname, ".."),
  dataDir: path.join(__dirname, "..", "data"),
  dbPath: path.join(__dirname, "..", "data", "livora.db"),
  shotsDir: path.join(__dirname, "..", "data", "shots"),
  invoicesDir: path.join(__dirname, "..", "data", "invoices"),
  exportsDir: path.join(__dirname, "..", "data", "exports")
};
