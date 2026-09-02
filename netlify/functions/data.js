'use strict';

const { buildEnvelope } = require('../../lib/payload');
const webhook = require('../../lib/webhook');
const mailer = require('../../lib/mailer');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.length === 0
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function reply(statusCode, body, origin) {
  return { statusCode, headers: corsHeaders(origin), body: JSON.stringify(body) };
}

exports.handler = async function handler(event) {
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin || '';

  if (event.httpMethod === 'OPTIONS') return reply(204, {}, origin);
  if (event.httpMethod !== 'POST') {
    return reply(405, { ok: false, error: 'Method not allowed' }, origin);
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return reply(400, { ok: false, error: 'Invalid JSON body' }, origin);
  }

  // Honeypot: real visitors never fill a hidden field.
  if (body.website) return reply(200, { ok: true }, origin);

  const built = buildEnvelope(body, headers, event.httpMethod);
  if (built.errors) {
    return reply(422, { ok: false, errors: built.errors }, origin);
  }

  const { envelope } = built;
  console.log('lead envelope:', JSON.stringify(envelope));

  // The webhook and the email are independent — one failing must not lose the
  // other. The webhook is the only destination for the lead itself.
  const [hookResult, mailResult] = await Promise.allSettled([
    webhook.send(envelope),
    mailer.sendConfirmation(envelope.post),
  ]);

  const settled = (r) => (r.status === 'fulfilled'
    ? r.value
    : { error: r.reason && r.reason.message });

  const hook = settled(hookResult);
  const mail = settled(mailResult);

  if (hook.error) console.error('webhook failed:', hook.error);
  if (mail.error) console.error('email failed:', mail.error);

  // Delivery of the lead decides success for the visitor; a failed
  // confirmation email must not make them submit the form again.
  const ok = !hook.error;
  return reply(ok ? 200 : 502, { ok, webhook: hook, mail, envelope }, origin);
};
