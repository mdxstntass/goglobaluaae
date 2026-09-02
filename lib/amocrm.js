'use strict';

/**
 * amoCRM v4 client.
 *
 * Auth uses a long-lived access token (amoCRM: Settings -> Integrations ->
 * your integration -> "Long-lived token"). That token IS the "API key" —
 * amoCRM retired the old user-hash API, so there is nothing else to use.
 *
 * Required env:
 *   AMOCRM_BASE_URL   e.g. https://yourcompany.amocrm.ru
 *   AMOCRM_TOKEN      long-lived access token
 * Optional env (custom field ids from amoCRM -> Settings -> Fields):
 *   AMOCRM_PIPELINE_ID, AMOCRM_RESPONSIBLE_USER_ID
 *   AMOCRM_FIELD_PHONE, AMOCRM_FIELD_EMAIL      (contact fields)
 *   AMOCRM_FIELD_INTEREST, AMOCRM_FIELD_URL,
 *   AMOCRM_FIELD_AMBASSADOR, AMOCRM_FIELD_COMMENT  (lead fields)
 */

const TIMEOUT_MS = Number(process.env.AMOCRM_TIMEOUT_MS || 10000);

function config() {
  const baseUrl = (process.env.AMOCRM_BASE_URL || '').replace(/\/+$/, '');
  const token = process.env.AMOCRM_TOKEN || '';
  return { baseUrl, token, enabled: Boolean(baseUrl && token) };
}

async function request(path, options) {
  const { baseUrl, token } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl + path, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options && options.headers),
      },
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON error body */ }
    if (!res.ok) {
      const err = new Error(`amoCRM ${res.status} on ${path}: ${text.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** Only emits a custom field entry when the field id is actually configured. */
function field(envId, value, enumCode) {
  const id = process.env[envId];
  if (!id || value === undefined || value === null || value === '') return null;
  const entry = { field_id: Number(id), values: [{ value }] };
  if (enumCode) entry.values[0].enum_code = enumCode;
  return entry;
}

function compact(arr) {
  return arr.filter(Boolean);
}

/**
 * Creates a lead with an embedded contact via /leads/complex, then attaches the
 * raw envelope as a note so nothing from the submission is ever lost.
 */
async function createLead(envelope, ambassador) {
  const cfg = config();
  if (!cfg.enabled) {
    return { skipped: true, reason: 'AMOCRM_BASE_URL / AMOCRM_TOKEN not configured' };
  }

  const p = envelope.post;

  const leadFields = compact([
    field('AMOCRM_FIELD_INTEREST', p.interest),
    field('AMOCRM_FIELD_URL', envelope.URL),
    field('AMOCRM_FIELD_AMBASSADOR', ambassador),
    field('AMOCRM_FIELD_COMMENT', p.comment),
  ]);

  const contactFields = compact([
    field('AMOCRM_FIELD_PHONE', p.phone, 'WORK'),
    field('AMOCRM_FIELD_EMAIL', p.email, 'WORK'),
  ]);

  const lead = {
    name: p.title,
    _embedded: {
      contacts: [{
        first_name: p.name,
        ...(contactFields.length ? { custom_fields_values: contactFields } : {}),
      }],
    },
  };
  if (leadFields.length) lead.custom_fields_values = leadFields;
  if (process.env.AMOCRM_PIPELINE_ID) lead.pipeline_id = Number(process.env.AMOCRM_PIPELINE_ID);
  if (process.env.AMOCRM_RESPONSIBLE_USER_ID) {
    lead.responsible_user_id = Number(process.env.AMOCRM_RESPONSIBLE_USER_ID);
  }

  const created = await request('/api/v4/leads/complex', {
    method: 'POST',
    body: JSON.stringify([lead]),
  });

  const leadId = Array.isArray(created) && created[0] && created[0].id;
  if (!leadId) return { leadId: null, note: false, raw: created };

  // The note carries the full envelope, so the manager sees the exact payload.
  let note = false;
  try {
    await request(`/api/v4/leads/${leadId}/notes`, {
      method: 'POST',
      body: JSON.stringify([{
        note_type: 'common',
        params: { text: buildNoteText(envelope, ambassador) },
      }]),
    });
    note = true;
  } catch (e) {
    // A missing note must not fail the lead itself.
    console.error('amoCRM note failed:', e.message);
  }

  return { leadId, note };
}

function buildNoteText(envelope, ambassador) {
  const p = envelope.post;
  return [
    ambassador ? `Ambassador: ${ambassador}` : null,
    `URL: ${envelope.URL}`,
    `Name: ${p.name}`,
    `Phone: ${p.phone}`,
    `Email: ${p.email}`,
    `Interest: ${p.interest || '—'}`,
    `Comment: ${p.comment || '—'}`,
    `IP: ${envelope.ip}`,
    `User agent: ${envelope.user_agent}`,
    '',
    JSON.stringify(envelope, null, 2),
  ].filter((l) => l !== null).join('\n');
}

module.exports = { createLead, config, buildNoteText };
