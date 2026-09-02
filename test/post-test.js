'use strict';

/**
 * End-to-end check of the POST controller, run in-process against the real
 * handler. amoCRM and SMTP calls are stubbed unless the env vars are set, so
 * this is safe to run without credentials.
 */

const assert = require('assert');
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
function check(label, fn) {
  try {
    fn();
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

  check('ip comes from the forwarded header', () => assert.strictEqual(envelope.ip, '3.17.184.97'));
  check('method is POST', () => assert.strictEqual(envelope.method, 'POST'));
  check('URL is the ambassador link', () =>
    assert.strictEqual(envelope.URL, 'goglobal-uae.com/ambassador?=Sergey'));
  check('user_agent is passed through', () =>
    assert.strictEqual(envelope.user_agent, 'axios/1.13.2'));
  check('get is an empty object', () => assert.deepStrictEqual(envelope.get, {}));
  check('post has exactly the agreed keys', () =>
    assert.deepStrictEqual(Object.keys(envelope.post),
      ['title', 'name', 'email', 'phone', 'interest', 'comment']));
  check('title is the CRM lead title', () =>
    assert.strictEqual(envelope.post.title, 'Новый клиент'));
  check('all five form fields survive', () => {
    assert.strictEqual(envelope.post.name, 'Salim');
    assert.strictEqual(envelope.post.email, 'salimshorahmonov26@gmail.com');
    assert.strictEqual(envelope.post.phone, '+992300005588');
    assert.strictEqual(envelope.post.interest, 'Other programs');
    assert.ok(envelope.post.comment.startsWith('Hello, can you tell me'));
  });

  console.log('\n2. Ambassador name handling');
  check('messy phone is normalised', () =>
    assert.strictEqual(
      buildEnvelope({ ...SUBMISSION, phone: '+992 (300) 00-55-88' }, HEADERS, 'POST').envelope.post.phone,
      '+992300005588'));
  check('no ambassador falls back to the page URL', () =>
    assert.strictEqual(
      buildEnvelope({ ...SUBMISSION, ambassador: '', pageUrl: 'https://goglobal-uae.com/ambassador.html' }, HEADERS, 'POST').envelope.URL,
      'goglobal-uae.com/ambassador.html'));
  check('injection characters are stripped from the name', () =>
    assert.strictEqual(
      buildEnvelope({ ...SUBMISSION, ambassador: '<script>x</script>Sergey' }, HEADERS, 'POST').envelope.URL,
      'goglobal-uae.com/ambassador?=scriptxscriptSergey'));

  console.log('\n3. Validation');
  check('missing name is rejected', () =>
    assert.ok(buildEnvelope({ ...SUBMISSION, name: '' }, HEADERS, 'POST').errors));
  check('bad email is rejected', () =>
    assert.ok(buildEnvelope({ ...SUBMISSION, email: 'nope' }, HEADERS, 'POST').errors));
  check('short phone is rejected', () =>
    assert.ok(buildEnvelope({ ...SUBMISSION, phone: '12' }, HEADERS, 'POST').errors));

  console.log('\n4. Confirmation email');
  const msg = buildMessage(envelope.post);
  check('subject matches the spec', () =>
    assert.strictEqual(msg.subject, 'Thank you for registering Salim'));
  check('body greets the visitor', () =>
    assert.ok(msg.html.includes('<h1>Hi Salim, thank you for registering.</h1>')));
  check('body lists phone, interest and comment', () => {
    assert.ok(msg.html.includes('Your phone number: +992300005588'));
    assert.ok(msg.html.includes('Area of interest: Other programs'));
    assert.ok(msg.html.includes('Comment: Hello, can you tell me'));
  });
  check('html is escaped', () =>
    assert.ok(buildMessage({ name: '<b>x</b>', phone: '', interest: '', comment: '' })
      .html.includes('&lt;b&gt;x&lt;/b&gt;')));

  console.log('\n5. HTTP controller');
  const ok = await handler({ httpMethod: 'POST', headers: HEADERS, body: JSON.stringify(SUBMISSION) });
  const okBody = JSON.parse(ok.body);
  check('valid POST returns 200', () => assert.strictEqual(ok.statusCode, 200));
  check('response echoes the envelope', () =>
    assert.strictEqual(okBody.envelope.URL, 'goglobal-uae.com/ambassador?=Sergey'));
  check('CRM is skipped without credentials', () =>
    assert.ok(okBody.crm.skipped || okBody.crm.leadId));

  const bad = await handler({ httpMethod: 'POST', headers: HEADERS, body: JSON.stringify({ name: '' }) });
  check('invalid POST returns 422', () => assert.strictEqual(bad.statusCode, 422));

  const get = await handler({ httpMethod: 'GET', headers: HEADERS, body: '' });
  check('GET returns 405', () => assert.strictEqual(get.statusCode, 405));

  const opts = await handler({ httpMethod: 'OPTIONS', headers: HEADERS, body: '' });
  check('OPTIONS preflight returns 204', () => assert.strictEqual(opts.statusCode, 204));

  const pot = await handler({ httpMethod: 'POST', headers: HEADERS, body: JSON.stringify({ ...SUBMISSION, website: 'spam' }) });
  check('honeypot submission is silently accepted', () => assert.strictEqual(pot.statusCode, 200));

  console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}\n`);
})();
