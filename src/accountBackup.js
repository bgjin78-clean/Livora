const fs = require("fs");
const path = require("path");
const config = require("./config");

function backupPath() {
  return path.join(config.dataDir, "accounts-backup.json");
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(backupPath(), "utf8"));
  } catch {
    return null;
  }
}

function save(snapshot) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${backupPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tmp, backupPath());
}

module.exports = { backupPath, load, save };
