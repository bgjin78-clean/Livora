const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const rootDir = path.join(__dirname, "..");
const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
const isProd = process.env.NODE_ENV === "production";

module.exports = {
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || "0.0.0.0",
  isProd,
  jwtSecret: process.env.JWT_SECRET || "livora-dev-secret-change-me",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "livora-admin",
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  cookieSecure: process.env.COOKIE_SECURE === "true" || (isProd && process.env.COOKIE_SECURE !== "false"),
  smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
  smtpPort: Number(process.env.SMTP_PORT || 465),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  mailFrom: process.env.MAIL_FROM || process.env.SMTP_USER || "",
  mailTo: process.env.MAIL_TO || "",
  publicUrl: String(process.env.PUBLIC_URL || "").replace(/\/$/, ""),
  rootDir,
  dataDir,
  dbPath: path.join(dataDir, "livora.db"),
  shotsDir: path.join(dataDir, "shots"),
  invoicesDir: path.join(dataDir, "invoices"),
  exportsDir: path.join(dataDir, "exports"),
  adminCopiesDir: path.join(dataDir, "admin-copies")
};
