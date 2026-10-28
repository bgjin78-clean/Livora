const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("../config");
const db = require("../db");
const { safeSegment } = require("./fileName");

function keepSessionFiles(sessionId, files = []) {
  const dir = path.join(config.keptDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const names = [];
  for (const file of files) {
    const name = path.basename(file.filename || file.path || "");
    if (!name || !file.path || !fs.existsSync(file.path)) continue;
    fs.copyFileSync(file.path, path.join(dir, name));
    names.push(name);
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    at: new Date().toISOString(),
    files: names
  }));
  return names;
}

function desktopCandidates(home = os.homedir()) {
  return [
    path.join(home, "Desktop"),
    path.join(home, "OneDrive", "Desktop"),
    path.join(home, "OneDrive", "바탕 화면")
  ];
}

function saveToUserDesktop(username, files = [], home = os.homedir()) {
  const desktop = desktopCandidates(home).find((dir) => fs.existsSync(dir));
  if (!desktop) return { ok: false, skipped: true, reason: "no-desktop" };
  const folderName = safeSegment(username, "seller");
  const dir = path.join(desktop, folderName);
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const file of files) {
    const name = path.basename(file.filename || file.path || "");
    if (!name || !file.path || !fs.existsSync(file.path)) continue;
    fs.copyFileSync(file.path, path.join(dir, name));
    saved.push(name);
  }
  return { ok: saved.length > 0, dir, files: saved };
}

function isOlderThan(target, keepMs) {
  try {
    return Date.now() - fs.statSync(target).mtimeMs > keepMs;
  } catch {
    return false;
  }
}

function removeTree(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function purgeExpiredFiles(nowMs = Date.now()) {
  const keepMs = Number(config.keepMs || 7 * 24 * 60 * 60 * 1000);
  const cutoff = new Date(nowMs - keepMs).toISOString();
  let removed = 0;

  if (fs.existsSync(config.keptDir)) {
    for (const name of fs.readdirSync(config.keptDir)) {
      const target = path.join(config.keptDir, name);
      if (isOlderThan(target, keepMs)) {
        removeTree(target);
        removed += 1;
      }
    }
  }

  if (fs.existsSync(config.exportsDir)) {
    for (const name of fs.readdirSync(config.exportsDir)) {
      const target = path.join(config.exportsDir, name);
      if (fs.statSync(target).isFile() && isOlderThan(target, keepMs)) {
        fs.unlinkSync(target);
        removed += 1;
      }
    }
  }

  if (fs.existsSync(config.invoicesDir)) {
    for (const name of fs.readdirSync(config.invoicesDir)) {
      const target = path.join(config.invoicesDir, name);
      if (fs.statSync(target).isDirectory() && isOlderThan(target, keepMs)) {
        removeTree(target);
        removed += 1;
      }
    }
  }

  for (const row of db.deleteAdminFilesBefore(cutoff)) {
    const stored = path.join(config.adminCopiesDir, row.stored_name || "");
    if (row.stored_name && fs.existsSync(stored)) fs.unlinkSync(stored);
    removed += 1;
  }

  if (removed) console.log(`[keep] removed ${removed} file set(s) older than 7 days`);
  return removed;
}

module.exports = {
  keepSessionFiles,
  saveToUserDesktop,
  purgeExpiredFiles
};
