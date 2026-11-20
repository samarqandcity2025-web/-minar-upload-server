'use strict';
// Security review of 20 Nov 2026: the app key (inside the programs) may only upload where the programs upload; the server never
// fetches or deletes a URL outside that area; values inside page scripts cannot close the <script>.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// '@vercel/blob/client' stand-in: handleUpload just asks onBeforeGenerateToken, as the real one does before signing a token.
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === '@vercel/blob/client' ? '@vercel/blob/client' : resolve.call(this, req, ...rest); };
require.cache['@vercel/blob/client'] = { id: '@vercel/blob/client', filename: '@vercel/blob/client', loaded: true,
  exports: { handleUpload: async ({ body, onBeforeGenerateToken }) => ({ type: 'token', opts: await onBeforeGenerateToken(body.pathname, body.clientPayload) }) } };
process.env.MINAR_APP_KEY = 'app-key-for-tests';
process.env.MINAR2_RELEASE_KEY = 'release-key-for-tests-0123456789';
const upload = require('../api/blob-upload');
const { ownUpload } = require('../lib/blob-url');

const call = async (pathname, payload) => {
  let status = 0, json = null;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(j) { json = j; return this; }, end() { return this; } };
  await upload({ method: 'POST', body: { pathname, clientPayload: JSON.stringify(payload) } }, res);
  return { status, json };
};

test('the app key uploads only to minar/<login>/<file> and minar-3d/<n>.json, always with a random suffix', async () => {
  const app = { appKey: 'app-key-for-tests', login: 'ali' };
  const ok = await call('minar/ali/1700000000000-plan.dwg', app);
  assert.equal(ok.status, 200); assert.equal(ok.json.opts.addRandomSuffix, true);
  assert.equal((await call('minar-3d/1700000000000.json', app)).status, 200);
  for (const p of ['minar-bot/state-x.json', 'minar-accounts/state-x.json', 'minar2-backup/minar2-2099-01-01.json.gz', 'minar-docs/abc.json',
    'minar2-update/latest-999.0.0.yml', 'minar2-update/minar2-999.0.0.exe', 'minar/a/b/c', 'minar-3d/x.json', 'other.json', '../minar-bot/state.json']) {
    assert.equal((await call(p, app)).status, 400, p);
  }
  assert.equal((await call('minar/ali/x', { appKey: 'wrong' })).status, 400);
  // The release key still publishes updates, only under minar2-update/.
  const rel = { release: 'release-key-for-tests-0123456789' };
  assert.equal((await call('minar2-update/latest-0.5.20.yml', rel)).status, 200);
  assert.equal((await call('minar-bot/state-x.json', rel)).status, 400);
});

test('a Blob URL from a program: only a Vercel Blob URL under the programs\' upload paths', () => {
  const host = 'https://abc123.public.blob.vercel-storage.com/';
  assert.ok(ownUpload(host + 'minar/ali/1-plan-XYZ.dwg'));
  assert.ok(ownUpload(host + 'minar-3d/17-XYZ.json'));
  assert.ok(ownUpload(host + 'minar/ali%40mail/1-x.pdf'));
  for (const u of [host + 'minar-bot/state-1.json', host + 'minar2-update/minar2-0.5.19.exe', host + 'minar2-backup/x.json.gz', host + 'minar-docs/t.json',
    'http://abc123.public.blob.vercel-storage.com/minar/ali/x', 'https://evil.example/minar/ali/x', 'https://abc123.public.blob.vercel-storage.com.evil.example/minar/a/x',
    host + 'minar/../minar-bot/state.json', host + 'minar/ali/x?y=1', 'file:///C:/x', '', null, 42]) assert.equal(ownUpload(u), false, String(u));
  assert.equal(ownUpload(host + 'minar-3d/1.json', ['minar/']), false, 'a narrower list of paths');
});

test('the 3D page: a loading text from the program cannot close the <script>', () => {
  const S = require('../lib/minar/share3d.js');
  const html = S.page({ name: 'x', lang: 'ru', text: { loading: '</script><script>alert(1)</script>' } }, '0');
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /\\u003c\/script>\\u003cscript>alert\(1\)/);
});
