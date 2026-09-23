const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

async function sendEmail({ to, subject, text, html }) {
  if (!to) {
    throw new Error("Recipient email is required.");
  }

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html,
  });

  return info;
}

async function verifyEmailService() {
  await transporter.verify();
  return true;
}

module.exports = {
  sendEmail,
  verifyEmailService,
};