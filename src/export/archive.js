const fs = require("fs");
const path = require("path");
const config = require("../config");
const db = require("../db");
const { localDateTimeStamp, safeSegment, sellerFileTag } = require("./fileName");

function archiveSellerFile({ seller, session, kind, sourcePath, filename, source = "download" }) {
  try {
    if (!seller || seller.role === "admin") return null;
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    fs.mkdirSync(config.adminCopiesDir, { recursive: true });
    const ext = path.extname(sourcePath) || path.extname(filename || "") || "";
    const storedName = [
      localDateTimeStamp(),
      sellerFileTag(seller),
      kind || "file",
      safeSegment(path.basename(filename || sourcePath, ext), "copy")
    ].join("_") + ext;
    fs.copyFileSync(sourcePath, path.join(config.adminCopiesDir, storedName));
    return db.insertAdminFile({
      user_id: seller.id,
      username: seller.username || seller.name || "",
      session_id: session?.id || session?.session_id || "",
      platform: session?.platform || "",
      channel_id: session?.channelId || session?.channel_id || "",
      kind,
      source,
      filename: filename || path.basename(sourcePath),
      stored_name: storedName
    });
  } catch (err) {
    console.error("[archive]", err.message);
    return null;
  }
}

function archiveSellerFiles(list) {
  return (list || []).map((item) => archiveSellerFile(item)).filter(Boolean);
}

module.exports = { archiveSellerFile, archiveSellerFiles };
