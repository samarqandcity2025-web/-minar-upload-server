'use strict';
// Phone check for new registrations (2 Nov 2026): bot code (api/telegram.js), register with the code (api/account.js).
// Telegram and Vercel Blob are in-memory stand-ins: nothing leaves this computer.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const blobs = new Map();
let serial = 0;
const fakeBlob = {
  async put(pathname, body) { const name = pathname.replace(/\.json$/, '-' + (++serial) + '.json'), url = 'https://blob.test/' + name; blobs.set(name, { url, body: String(body), at: new Date(Date.now() + serial) }); return { url, pathname: name }; },
  async list({ prefix }) { return { blobs: [...blobs.entries()].filter(([k]) => k.startsWith(prefix)).map(([pathname, b]) => ({ pathname, url: b.url, uploadedAt: b.at })) }; },
  async del(urls) { for (const [k, b] of [...blobs]) if ([].concat(urls).includes(b.url)) blobs.delete(k); },
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === '@vercel/blob' ? '@vercel/blob' : resolve.call(this, req, ...rest); };
require.cache['@vercel/blob'] = { id: '@vercel/blob', filename: '@vercel/blob', loaded: true, exports: fakeBlob };

const sent = [];
global.fetch = async (url, o) => {
  const hit = [...blobs.values()].find((b) => b.url === url);
  if (hit) return new Response(hit.body, { status: 200 });
  const m = /api\.telegram\.org\/bot[^/]+\/(\w+)/.exec(String(url));
  if (m) {
    const body = o && o.body ? JSON.parse(o.body) : {};
    sent.push({ method: m[1], body });
    return new Response(JSON.stringify(m[1] === 'getMe' ? { ok: true, result: { username: 'minar_test_bot' } } : { ok: true, result: {} }), { status: 200 });
  }
  throw new Error('unexpected fetch ' + url);
};

process.env.MINAR_APP_KEY = 'test-key';
process.env.TELEGRAM_BOT_TOKEN = '123:test';
process.env.BLOB_READ_WRITE_TOKEN = 'test';
process.env.TELEGRAM_CHAT_ID = '900000001';
process.env.MINAR_ACCOUNT_PEPPER = 'pepper-for-tests';

const phone = require('../lib/phone-code');
const account = require('../api/account.js');
const telegram = require('../api/telegram.js');
const store = require('../lib/bot-store');

function call(handler, body, headers) {
  return new Promise((done) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
      json(j) { done({ code: this.code, json: j }); }, end() { done({ code: this.code }); } };
    handler({ method: 'POST', body, headers: headers || {} }, res);
  });
}
const hook = (update) => call(telegram, update, { 'x-telegram-bot-api-secret-token': store.webhookSecret() });
const msg = (from, extra) => ({ message: Object.assign({ chat: { id: from, type: 'private' }, from: { id: from, first_name: 'Test' } }, extra) });
const profile = (p) => ({ firstName: 'Ali', lastName: 'Valiyev', phone: p, email: 'ali@gmail.com' });
const register = (login, p, code) => call(account, { appKey: 'test-key', action: 'register', login, password: 'secret12', profile: profile(p), phoneCode: code });

test('phone numbers: digits, 9-digit Uzbek numbers get 998', () => {
  assert.strictEqual(phone.normalize('+998 90 123-45-67'), '998901234567');
  assert.strictEqual(phone.normalize('90 123 45 67'), '998901234567');
  assert.strictEqual(phone.normalize('12'), '');
  assert.strictEqual(phone.codeFor('+998901234567'), phone.codeFor('901234567'));
});

test('a code lives this 5-minute slot and the previous one, then expires', () => {
  const t = Date.UTC(2026, 10, 2, 12, 0, 0), c = phone.codeFor('998901112233', t);
  assert.match(c, /^\d{6}$/);
  assert.ok(phone.check('998901112233', c, t + phone.SLOT).ok);
  assert.ok(!phone.check('998901112233', c, t + 2 * phone.SLOT).ok);
  assert.ok(!phone.check('998901112244', c, t).ok, 'another number');
});

test('bot: /start verify asks for the contact and sends nothing to the admins', async () => {
  sent.length = 0;
  await hook(msg(700000001, { text: '/start verify' }));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(String(sent[0].body.chat_id), '700000001');
  assert.strictEqual(sent[0].body.reply_markup.keyboard[0][0].request_contact, true);
});

test('bot: own contact gets the code, someone else\'s contact is refused', async () => {
  sent.length = 0;
  await hook(msg(700000001, { contact: { phone_number: '998901234567', user_id: 700000001 } }));
  assert.ok(sent[0].body.text.includes(phone.codeFor('998901234567')));
  sent.length = 0;
  await hook(msg(700000001, { contact: { phone_number: '998907777777', user_id: 700000099 } }));
  assert.ok(!sent[0].body.text.includes(phone.codeFor('998907777777')));
  assert.strictEqual(sent.length, 1);
});

test('bot: a plain Start still makes a file-recipient request (unchanged)', async () => {
  sent.length = 0;
  await hook(msg(700000002, { text: '/start' }));
  assert.ok(sent.some((s) => String(s.body.chat_id) === '900000001' && /Yangi so'rov/.test(s.body.text)));
});

test('register: needs the right code; one phone number, one account', async () => {
  const p = '+998 90 555 66 77', good = phone.codeFor(p);
  let r = await register('noCode', p, '');
  assert.strictEqual(r.code, 400); assert.strictEqual(r.json.error, 'bad-code');
  r = await register('wrongCode', p, good === '000000' ? '111111' : '000000');
  assert.strictEqual(r.json.error, 'bad-code');
  r = await register('aliValiyev', p, good);
  assert.strictEqual(r.code, 200); assert.ok(r.json.ok);
  r = await register('aliSecond', '905556677', phone.codeFor('905556677'));
  assert.strictEqual(r.code, 409); assert.strictEqual(r.json.error, 'phone-exists');
  r = await call(account, { appKey: 'test-key', action: 'login', login: 'aliValiyev', password: 'secret12' });
  assert.ok(r.json.ok);
});

test('register: after 5 wrong codes the number is locked for a while', async () => {
  const p = '998903334455', good = phone.codeFor(p), bad = good === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await register('tries' + i, p, bad);
  const r = await register('triesOk', p, good);
  assert.strictEqual(r.code, 429); assert.strictEqual(r.json.error, 'code-tries');
});

test('phone-bot gives the bot name for the t.me link', async () => {
  const r = await call(account, { appKey: 'test-key', action: 'phone-bot' });
  assert.deepStrictEqual(r.json, { ok: true, bot: 'minar_test_bot' });
});
