'use strict';

/**
 * Posts the lead envelope to the webhook that feeds amoCRM.
 *
 * Required env:
 *   WEBHOOK_URL       e.g. https://hooks.tglk.ru/in/XXXX
 * Optional env:
 *   WEBHOOK_TOKEN     sent as "Authorization: Bearer ..." when set
 *   WEBHOOK_TIMEOUT_MS (default 10000)
 *   WEBHOOK_RETRIES    (default 2 retries after the first attempt)
 */

const TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS || 10000);
const RETRIES = Number(process.env.WEBHOOK_RETRIES || 2);

function config() {
  const url = process.env.WEBHOOK_URL || '';
  return { url, token: process.env.WEBHOOK_TOKEN || '', enabled: Boolean(url) };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postOnce(url, token, envelope) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(envelope),
    });
    const text = (await res.text()).slice(0, 400);
    if (!res.ok) {
      const err = new Error(`webhook ${res.status}: ${text}`);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, response: text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A lost lead is worse than a duplicate, so transient failures are retried
 * with a short backoff. 4xx (other than 429) is not retried — it will not
 * succeed on a second attempt.
 */
async function send(envelope) {
  const cfg = config();
  // The webhook is the only destination, so an unset URL is not something to
  // skip past — it means the lead has nowhere to go. Fail loudly instead of
  // telling the visitor their request was submitted.
  if (!cfg.enabled) {
    throw new Error('WEBHOOK_URL is not configured — the lead has no destination');
  }

  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const result = await postOnce(cfg.url, cfg.token, envelope);
      return attempt ? { ...result, attempts: attempt + 1 } : result;
    } catch (e) {
      lastError = e;
      // Log every failed attempt: a silent retry hides a degrading endpoint.
      console.warn(`webhook attempt ${attempt + 1}/${RETRIES + 1} failed: ${e.message}`);
      const permanent = e.status >= 400 && e.status < 500 && e.status !== 429;
      if (permanent || attempt === RETRIES) break;
      await wait(300 * (attempt + 1));
    }
  }
  throw lastError;
}

module.exports = { send, config };
