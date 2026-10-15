const nodemailer = require("nodemailer");
const config = require("../config");

function mailTarget(seller) {
  return String(seller?.mail_to || seller?.mailTo || config.mailTo || "").trim();
}

function mailEnabled(seller) {
  return Boolean(config.smtpUser && config.smtpPass && mailTarget(seller));
}

async function sendSessionMail({ seller, platform, channelId, files = [] }) {
  const to = mailTarget(seller);
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
    text: `${who} / ${platform || ""} ${channelId || ""}\n주문 엑셀·채팅 엑셀·닉네임 정산서 JPG를 첨부합니다.`,
    attachments
  });
  return { ok: true, to };
}

module.exports = { mailEnabled, sendSessionMail };
