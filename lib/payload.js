'use strict';

const SITE_HOST = process.env.SITE_HOST || 'goglobal-uae.com';

const INTERESTS = [
  'English courses in Dubai',
  'Admission to universities',
  'School abroad',
  'Other programs',
];

function str(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max || 500);
}

/**
 * Normalises a phone into +digits form. Returns '' when nothing usable is left.
 */
function normalizePhone(v) {
  const raw = str(v, 40);
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 6) return '';
  return '+' + digits;
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/**
 * Ambassador names arrive from the URL, so keep them to a safe, human shape.
 */
function normalizeAmbassador(v) {
  const raw = decodeURIComponent(str(v, 60)).replace(/[^\p{L}\p{N} .'\-_]/gu, '');
  return raw.trim().slice(0, 60);
}

/**
 * Builds the ambassador URL exactly in the agreed format:
 *   goglobal-uae.com/ambassador?=Sergey
 * Falls back to the page the visitor actually submitted from.
 */
function buildUrl(ambassador, pageUrl) {
  const name = normalizeAmbassador(ambassador);
  if (name) return `${SITE_HOST}/ambassador?=${encodeURIComponent(name)}`;
  const page = str(pageUrl, 300);
  if (page) return page.replace(/^https?:\/\//, '');
  return SITE_HOST;
}

function clientIp(headers) {
  const h = (k) => headers[k] || headers[k.toLowerCase()] || '';
  const fwd = h('x-nf-client-connection-ip') || h('x-forwarded-for') || h('x-real-ip');
  return str(fwd, 60).split(',')[0].trim() || '0.0.0.0';
}

/**
 * Validates the submitted form and wraps it in the envelope amoCRM receives.
 * Returns { errors: [...] } when the submission is unusable.
 */
function buildEnvelope(body, headers, method) {
  const errors = [];

  const name = str(body.name, 120);
  const email = str(body.email, 160).toLowerCase();
  const phone = normalizePhone(body.phone);
  const interest = str(body.interest, 120);
  const comment = str(body.comment, 2000);

  if (!name) errors.push('name is required');
  if (!isEmail(email)) errors.push('a valid email is required');
  if (!phone) errors.push('a valid phone is required');
  if (interest && !INTERESTS.includes(interest)) {
    // Unknown option: keep the value, it still tells the manager something.
  }
  if (errors.length) return { errors };

  return {
    envelope: {
      ip: clientIp(headers || {}),
      method: method || 'POST',
      URL: buildUrl(body.ambassador, body.pageUrl),
      user_agent: str(headers['user-agent'] || headers['User-Agent'], 300),
      get: {},
      post: {
        title: process.env.LEAD_TITLE || 'Новый клиент',
        name,
        email,
        phone,
        interest,
        comment,
      },
    },
    ambassador: normalizeAmbassador(body.ambassador),
  };
}

module.exports = { buildEnvelope, buildUrl, normalizePhone, normalizeAmbassador, isEmail, INTERESTS };
