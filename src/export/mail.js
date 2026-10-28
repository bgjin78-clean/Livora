const nodemailer = require("nodemailer");
const config = require("../config");
const db = require("../db");

function adminRecipients() {
  const fromAccounts = db.listUsers()
    .filter((user) => user.role === "admin" && user.status !== "stopped")
    .map((user) => String(user.mail_to || "").trim())
    .filter((mail) => mail.includes("@"));
  const extra = String(config.mailTo || "").trim();
  return [...new Set(extra ? [...fromAccounts, extra] : fromAccounts)];
}

function mailEnabled() {
  return Boolean(config.smtpUser && config.smtpPass && adminRecipients().length);
}

async function sendSessionMail({ seller, platform, channelId, files = [] }) {
  const recipients = adminRecipients();
  const to = recipients.join(", ");
  if (!config.smtpUser || !config.smtpPass) return { ok: false, skipped: true, reason: "smtp" };
  if (!to) return { ok: false, skipped: true, reason: "no-target" };
  const attachments = (files || [])
    .filter((file) => file?.path)
    .map((file) => ({ filename: file.filename, path: file.path }));
  if (!attachments.length) return { ok: false, skipped: true, reason: "no-files" };

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: Number(config.smtpPort) === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass
    }
  });

  const who = seller?.name || seller?.username || "판매자";
  await transporter.sendMail({
    from: config.mailFrom || config.smtpUser,
    to,
    subject: `[Livora] ${who} ${platform || ""} 주문서`,
    text: `${who} / ${platform || ""} ${channelId || ""}\n방송이 끝나 주문 엑셀·채팅 엑셀·정산서를 첨부합니다.`,
    attachments
  });
  return { ok: true, to };
}

module.exports = { mailEnabled, sendSessionMail, adminRecipients };
