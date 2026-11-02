'use strict';
// Document QR links: api/doc.js stores, api/viewdoc.js shows. Telegram is the MINAR_3D_MOCK_DIR folder (lib/tg-store);
// Vercel Blob is an in-memory stand-in for '@vercel/blob' (no network, no installed package needed).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const blobs = new Map();
const fakeBlob = {
  async put(pathname, body, opts) {
    if (opts && opts.addRandomSuffix === false && blobs.has(pathname) && opts.allowOverwrite === false) throw new Error('exists');
    const url = 'https://blob.test/' + pathname; blobs.set(pathname, { url, body: String(body) }); return { url, pathname };
  },
  async list({ prefix, limit }) { return { blobs: [...blobs.entries()].filter(([k]) => k.startsWith(prefix)).slice(0, limit || 1000).map(([pathname, b]) => ({ pathname, url: b.url, uploadedAt: new Date() })) }; },
  async del() {},
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === '@vercel/blob' ? '@vercel/blob' : resolve.call(this, req, ...rest); };
require.cache['@vercel/blob'] = { id: '@vercel/blob', filename: '@vercel/blob', loaded: true, exports: fakeBlob };
const realFetch = global.fetch;
global.fetch = async (url, o) => {
  const hit = [...blobs.values()].find((b) => b.url === url);
  if (hit) return new Response(hit.body, { status: 200 });
  return realFetch(url, o);
};

const mock = fs.mkdtempSync(path.join(os.tmpdir(), 'minar-doc-'));
process.env.MINAR_3D_MOCK_DIR = mock;
process.env.MINAR_APP_KEY = 'test-key';
process.env.MINAR_PUBLIC_ORIGIN = 'https://minar.test';
delete process.env.TELEGRAM_BOT_TOKEN;

const doc = require('../api/doc.js');
const view = require('../api/viewdoc.js');
const docs = require('../lib/doc-store');

function call(fn, req) {
  return new Promise((done) => {
    const res = { code: 200, headers: {}, body: null,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      status(c) { this.code = c; return this; },
      json(o) { this.body = o; done(this); }, end(b) { this.body = b; done(this); } };
    Promise.resolve(fn(Object.assign({ method: 'GET', headers: { host: 'x' }, query: {} }, req), res)).catch((e) => { res.code = 599; res.body = String(e); done(res); });
  });
}
// The app's side of the link (minar-upload.js docLink): random token + HMAC of the app key.
const token = () => crypto.randomBytes(16).toString('base64url');
const sig = (t) => crypto.createHmac('sha256', 'test-key').update('minar-doc:' + t).digest('base64url').slice(0, 16);
const post = (body) => call(doc, { method: 'POST', body: Object.assign({ appKey: 'test-key' }, body) });
const key = (url) => url.split('/d/')[1];

test('doc: a PDF is stored and its link shows the page and the same bytes', async () => {
  const t = token(), bytes = Buffer.from('%PDF-1.4 fake pdf bytes ' + 'x'.repeat(500));
  const r = await post({ token: t, sig: sig(t), kind: 'pdf', name: 'tt-opalubka.pdf', exportedAt: '2026-11-02T10:00:00Z',
    profile: { firstName: 'Ali', lastName: 'Valiyev' }, login: 'ali', payload: bytes.toString('base64') });
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.url, 'https://minar.test/d/' + t + '.' + sig(t));
  const p = await call(view, { query: { k: key(r.body.url) } });
  assert.strictEqual(p.code, 200);
  assert.match(p.body, /Подлинный документ/);
  assert.match(p.body, /tt-opalubka\.pdf/);
  assert.match(p.body, /Ali Valiyev/);
  assert.match(p.headers['cache-control'], /immutable/);
  const part = /\/api\/viewdoc\?p=([^"]+)"/.exec(p.body)[1];
  const got = await call(view, { query: { p: decodeURIComponent(part) } });
  assert.strictEqual(got.code, 200);
  assert.deepStrictEqual(Buffer.from(got.body), bytes);
  const m = await docs.find(t);
  assert.strictEqual(m.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('doc: Excel rows become an escaped table; the first upload of a token is never replaced', async () => {
  const t = token(), rows = [['№', 'Наименование', 'Кол-во', 'Ед.изм.'], [1, 'ЩЛ (3,0) 1,2 <b>', 24, 'шт']];
  const a = await post({ token: t, sig: sig(t), kind: 'xlsx', name: 'spec.xlsx', rows, section: 'План крупнощитовой опалубки', payload: Buffer.from('PK first').toString('base64') });
  assert.strictEqual(a.code, 200);
  const b = await post({ token: t, sig: sig(t), kind: 'xlsx', name: 'forged.xlsx', rows: [[1, 'FORGED', 1, 'шт']], payload: Buffer.from('PK second').toString('base64') });
  assert.strictEqual(b.code, 200);
  assert.strictEqual(b.body.existing, true);
  const p = await call(view, { query: { k: t + '.' + sig(t) } });
  assert.match(p.body, /ЩЛ \(3,0\) 1,2 &lt;b&gt;/);
  assert.match(p.body, /План крупнощитовой опалубки/);
  assert.doesNotMatch(p.body, /FORGED/);
  assert.strictEqual((await docs.find(t)).name, 'spec.xlsx');
});

test('doc: a big file is cut into parts under the response limit', async () => {
  const t = token(), bytes = crypto.randomBytes(8 * 1024 * 1024);
  const r = await post({ token: t, sig: sig(t), kind: 'pdf', name: 'big.pdf', payload: bytes.toString('base64') });
  assert.strictEqual(r.code, 200);
  const m = await docs.find(t);
  assert.strictEqual(m.parts.length, 3);
  for (const id of m.parts) assert.ok(fs.statSync(path.join(mock, id)).size <= 3.5 * 1024 * 1024);
});

test('doc: wrong key, signature or kind are refused; unknown and bad links answer 404', async () => {
  const t = token();
  assert.strictEqual((await call(doc, { method: 'POST', body: { appKey: 'nope', token: t, sig: sig(t), kind: 'pdf', payload: 'eA==' } })).code, 401);
  assert.strictEqual((await post({ token: t, sig: 'AAAAAAAAAAAAAAAA', kind: 'pdf', payload: 'eA==' })).code, 400);
  assert.strictEqual((await post({ token: 'short', sig: sig('short'), kind: 'pdf', payload: 'eA==' })).code, 400);
  assert.strictEqual((await post({ token: t, sig: sig(t), kind: 'exe', payload: 'eA==' })).code, 400);
  const notYet = await call(view, { query: { k: t + '.' + sig(t) } });
  assert.strictEqual(notYet.code, 404);
  assert.match(notYet.body, /ещё не загружен/);
  assert.strictEqual(notYet.headers['cache-control'], 'no-store');
  assert.strictEqual((await call(view, { query: { k: t + '.wrongsig12345678' } })).code, 404);
  assert.strictEqual((await call(view, { query: { p: 'mock123.badsig' } })).code, 404);
  assert.strictEqual((await call(doc, { method: 'OPTIONS' })).code, 204);
});

// Minar 2 commercial offers (user, 2 Nov 2026): own key MINAR2_DOC_KEY, own columns, a browser save may send the rows alone.
test('doc: a Minar 2 offer is stored with its own key, columns and rows; the page shows them', async () => {
  process.env.MINAR2_DOC_KEY = 'm2-key';
  const sig2 = (x) => crypto.createHmac('sha256', 'm2-key').update('minar-doc:' + x).digest('base64url').slice(0, 16);
  const t = token(), cols = ['№', 'Наименование', 'Кол-во', 'Ед.изм.', 'Вес общий', 'Цена с учётом НДС', 'Сумма'];
  const rows = [['План крупнощитовой опалубки'], [1, 'Гайка D90', 10, 'шт', 5, 17000, 170000], ['', 'Итого вес / сумма', '', '', 5, '', 170000]];
  const wrongKey = await call(doc, { method: 'POST', body: { appKey: 'test-key', app: 'minar-2', token: t, sig: sig2(t), kind: 'xlsx', name: 'x.xlsx', rows } });
  assert.strictEqual(wrongKey.code, 401, 'Minar 1 key is not Minar 2 key');
  const wrongSig = await call(doc, { method: 'POST', body: { appKey: 'm2-key', app: 'minar-2', token: t, sig: sig(t), kind: 'xlsx', name: 'x.xlsx', rows } });
  assert.strictEqual(wrongSig.code, 400, 'signed with the other program key');
  const r = await call(doc, { method: 'POST', body: { appKey: 'm2-key', app: 'minar-2', token: t, sig: sig2(t), kind: 'pdf', name: 'MTT-624 от 02.11.2026.pdf',
    exportedAt: '2026-11-02T10:00:00Z', section: 'Коммерческое предложение MTT-624 от 02.11.2026', cols, rows } });
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  const p = await call(view, { query: { k: key(r.body.url) } });
  assert.strictEqual(p.code, 200);
  assert.match(p.body, /MINAR 2/);
  assert.match(p.body, /Гайка D90/);
  assert.match(p.body, /Цена с учётом НДС/);
  assert.match(p.body, /Коммерческое предложение MTT-624/);
  assert.doesNotMatch(p.body, /id="dl"/, 'no file, no download button');
  const withFile = token(), bytes = Buffer.from('PK fake xlsx ' + 'y'.repeat(300));
  const f = await call(doc, { method: 'POST', body: { appKey: 'm2-key', app: 'minar-2', token: withFile, sig: sig2(withFile), kind: 'xlsx', name: 'MTT-624.xlsx', cols, rows, payload: bytes.toString('base64') } });
  assert.strictEqual(f.code, 200);
  const pf = await call(view, { query: { k: key(f.body.url) } });
  assert.match(pf.body, /id="dl"/);
  assert.match(pf.body, /защищён паролем/);
  // A Minar 1 link still works next to Minar 2's.
  assert.strictEqual(docs.valid(t, sig2(t)), true);
  assert.strictEqual(docs.valid(t, sig(t), 'minar-2'), false, 'a Minar 1 signature is not a Minar 2 one');
});
