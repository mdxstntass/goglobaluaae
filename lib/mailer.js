'use strict';

const nodemailer = require('nodemailer');

/**
 * Confirmation email to the visitor.
 *
 * Required env:
 *   SMTP_HOST, SMTP_USER, SMTP_PASS
 * Optional env:
 *   SMTP_PORT (default 465), SMTP_SECURE ("true"/"false", default port===465)
 *   MAIL_FROM (default "GoGlobal UAE <SMTP_USER>")
 *   MAIL_BCC  (e.g. the sales inbox, to get a copy of every submission)
 */

let cached = null;

function config() {
  const host = process.env.SMTP_HOST || '';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === 'true'
    : port === 465;
  return { host, user, pass, port, secure, enabled: Boolean(host && user && pass) };
}

function transporter() {
  if (cached) return cached;
  const c = config();
  cached = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
  });
  return cached;
}

/** Escapes user-supplied text before it goes into the HTML body. */
function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMessage(payload) {
  return {
    subject: `Thank you for registering ${payload.name}`,
    html: `<h1>Hi ${esc(payload.name)}, thank you for registering.</h1>
                 <p>Your phone number: ${esc(payload.phone)}</p>
                 <p>Area of interest: ${esc(payload.interest)}</p>
                 <p>Comment: ${esc(payload.comment)}<p>
                 <p>Our manager will contact you shortly.</p>`,
  };
}

async function sendConfirmation(payload) {
  const c = config();
  if (!c.enabled) {
    return { skipped: true, reason: 'SMTP_HOST / SMTP_USER / SMTP_PASS not configured' };
  }

  const msg = buildMessage(payload);
  const info = await transporter().sendMail({
    from: process.env.MAIL_FROM || `GoGlobal UAE <${c.user}>`,
    to: payload.email,
    ...(process.env.MAIL_BCC ? { bcc: process.env.MAIL_BCC } : {}),
    subject: msg.subject,
    html: msg.html,
  });

  return { messageId: info.messageId };
}

module.exports = { sendConfirmation, buildMessage, config, esc };
