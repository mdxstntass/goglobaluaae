'use strict';

/**
 * End-to-end check of the POST controller, run in-process against the real
 * handler. amoCRM and SMTP calls are stubbed unless the env vars are set, so
 * this is safe to run without credentials.
 */

const assert = require('assert');
const http = require('http');
const { buildEnvelope } = require('../lib/payload');
const { buildMessage } = require('../lib/mailer');
const { handler } = require('../netlify/functions/data');

const HEADERS = {
  'user-agent': 'axios/1.13.2',
  'x-forwarded-for': '3.17.184.97',
  'content-type': 'application/json',
};

const SUBMISSION = {
  name: 'Salim',
  email: 'salimshorahmonov26@gmail.com',
  phone: '+992300005588',
  interest: 'Other programs',
  comment: 'Hello, can you tell me what you can provide after finishing 9th grade with a good certificate?',
  ambassador: 'Sergey',
};

let passed = 0;
async function check(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${label}`);
  } catch (e) {
    console.error(`  FAIL  ${label}\n        ${e.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  console.log('\n1. Envelope shape');
  const { envelope } = buildEnvelope(SUBMISSION, HEADERS, 'POST');

  await check('ip comes from the forwarded header', () => assert.strictEqual(envelope.ip, '3.17.184.97'));
  await check('method is POST', () => assert.strictEqual(envelope.method, 'POST'));
  await check('URL is the ambassador link', () =>
    assert.strictEqual(envelope.URL, 'goglobal-uae.com/ambassador?=Sergey'));
  await check('user_agent is passed through', () =>
    assert.strictEqual(envelope.user_agent, 'axios/1.13.2'));
  await check('get is an empty object', () => assert.deepStrictEqual(envelope.get, {}));
  await check('post has exactly the agreed keys', () =>
    assert.deepStrictEqual(Object.keys(envelope.post),
      ['title', 'name', 'email', 'phone', 'interest', 'comment']));
  await check('title is the CRM lead title', () =>
    assert.strictEqual(envelope.post.title, 'Новый клиент'));
  await check('all five form fields survive', () => {
    assert.strictEqual(envelope.post.name, 'Salim');
    assert.strictEqual(envelope.post.email, 'salimshorahmonov26@gmail.com');
    assert.strictEqual(envelope.post.phone, '+992300005588');
    assert.strictEqual(envelope.post.interest, 'Other programs');
    assert.ok(envelope.post.comment.startsWith('Hello, can you tell me'));
  });

  console.log('\n2. Ambassador name handling');
  await check('messy phone is normalised', () =>
    assert.strictEqual(
      buildEnvelope({ ...SUBMISSION, phone: '+992 (300) 00-55-88' }, HEADERS, 'POST').envelope.post.phone,
      '+992300005588'));
  await check('no ambassador falls back to the page URL', () =>
    assert.strictEqual(
      buildEnvelope({ ...SUBMISSION, ambassador: '', pageUrl: 'https://goglobal-uae.com/ambassador.html' }, HEADERS, 'POST').envelope.URL,
      'goglobal-uae.com/ambassador.html'));
  await check('injection characters are stripped from the name', () =>
    assert.strictEqual(
      buildEnvelope({ ...SUBMISSION, ambassador: '<script>x</script>Sergey' }, HEADERS, 'POST').envelope.URL,
      'goglobal-uae.com/ambassador?=scriptxscriptSergey'));

  console.log('\n3. Validation');
  await check('missing name is rejected', () =>
    assert.ok(buildEnvelope({ ...SUBMISSION, name: '' }, HEADERS, 'POST').errors));
  await check('bad email is rejected', () =>
    assert.ok(buildEnvelope({ ...SUBMISSION, email: 'nope' }, HEADERS, 'POST').errors));
  await check('short phone is rejected', () =>
    assert.ok(buildEnvelope({ ...SUBMISSION, phone: '12' }, HEADERS, 'POST').errors));

  console.log('\n4. Confirmation email');
  const msg = buildMessage(envelope.post);
  await check('subject matches the spec', () =>
    assert.strictEqual(msg.subject, 'Thank you for registering Salim'));
  await check('body greets the visitor', () =>
    assert.ok(msg.html.includes('<h1>Hi Salim, thank you for registering.</h1>')));
  await check('body lists phone, interest and comment', () => {
    assert.ok(msg.html.includes('Your phone number: +992300005588'));
    assert.ok(msg.html.includes('Area of interest: Other programs'));
    assert.ok(msg.html.includes('Comment: Hello, can you tell me'));
  });
  await check('html is escaped', () =>
    assert.ok(buildMessage({ name: '<b>x</b>', phone: '', interest: '', comment: '' })
      .html.includes('&lt;b&gt;x&lt;/b&gt;')));

  console.log('\n5. HTTP controller');
  // A local stub stands in for the webhook: the suite must never post a test
  // lead to the real CRM, and must pass with no credentials present.
  const received = [];
  const stub = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      received.push(JSON.parse(data));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":true}');
    });
  });
  await new Promise((r) => stub.listen(0, r));
  process.env.WEBHOOK_URL = `http://localhost:${stub.address().port}/in/test`;

  const ok = await handler({ httpMethod: 'POST', headers: HEADERS, body: JSON.stringify(SUBMISSION) });
  const okBody = JSON.parse(ok.body);
  await check('valid POST returns 200', () => assert.strictEqual(ok.statusCode, 200));
  await check('response echoes the envelope', () =>
    assert.strictEqual(okBody.envelope.URL, 'goglobal-uae.com/ambassador?=Sergey'));
  await check('webhook result is reported', () =>
    assert.ok(okBody.webhook && (okBody.webhook.error || okBody.webhook.status)));
  await check('no amoCRM key is reported any more', () =>
    assert.strictEqual(okBody.crm, undefined));
  await check('an unconfigured webhook fails loudly instead of dropping the lead', () => {
    const saved = process.env.WEBHOOK_URL;
    delete process.env.WEBHOOK_URL;
    return handler({ httpMethod: 'POST', headers: HEADERS, body: JSON.stringify(SUBMISSION) })
      .then((r) => {
        if (saved !== undefined) process.env.WEBHOOK_URL = saved;
        assert.strictEqual(r.statusCode, 502, 'must not tell the visitor it succeeded');
        assert.strictEqual(JSON.parse(r.body).ok, false);
      });
  });

  const bad = await handler({ httpMethod: 'POST', headers: HEADERS, body: JSON.stringify({ name: '' }) });
  await check('invalid POST returns 422', () => assert.strictEqual(bad.statusCode, 422));

  const get = await handler({ httpMethod: 'GET', headers: HEADERS, body: '' });
  await check('GET returns 405', () => assert.strictEqual(get.statusCode, 405));

  const opts = await handler({ httpMethod: 'OPTIONS', headers: HEADERS, body: '' });
  await check('OPTIONS preflight returns 204', () => assert.strictEqual(opts.statusCode, 204));

  const pot = await handler({ httpMethod: 'POST', headers: HEADERS, body: JSON.stringify({ ...SUBMISSION, website: 'spam' }) });
  await check('honeypot submission is silently accepted', () => assert.strictEqual(pot.statusCode, 200));
  await check('the webhook received the envelope, honeypot excluded', () => {
    assert.strictEqual(received.length, 1, 'exactly one lead should be delivered');
    assert.strictEqual(received[0].URL, 'goglobal-uae.com/ambassador?=Sergey');
    assert.strictEqual(received[0].post.name, 'Salim');
  });

  stub.close();

  console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}\n`);
})();
