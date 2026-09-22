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
  if (!config.smtpUser || !config.smtpPass || !to) return { ok: false, skipped: true };
  const attachments = (files || [])
    .filter((file) => file?.path)
    .map((file) => ({ filename: file.filename, path: file.path }));
  if (!attachments.length) return { ok: false, skipped: true };

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
    text: `${who} / ${platform || ""} ${channelId || ""}\n상품기준·구매자기준·채팅 엑셀을 첨부합니다.`,
    attachments
  });
  return { ok: true };
}

module.exports = { mailEnabled, sendSessionMail };
