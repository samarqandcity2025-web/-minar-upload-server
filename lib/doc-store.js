'use strict';
// Document links behind the QR code (user, 2 Nov 2026: «scanning the QR on the specification opens the electronic version of
// the same document»). The QR must be printed on the document before the document is uploaded, so the app makes the link
// itself, offline: a random token (16 bytes, base64url) and its signature (HMAC of MINAR_APP_KEY). The file goes to the company
// Telegram (lib/tg-store, as 3D links); this store keeps only a small manifest per token in Vercel Blob
// (minar-docs/<token>.json: file ids, name, date, who, the specification rows) so the token finds its Telegram file.
// The first upload for a token wins: a manifest is never replaced, so a printed QR always shows what was uploaded first.
const crypto = require('crypto');

const PREFIX = 'minar-docs/';
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
// One key per program: Minar signs with MINAR_APP_KEY, Minar 2 (its saved commercial offers, user 2 Nov 2026) with MINAR2_DOC_KEY.
const KEYS = { minar: () => process.env.MINAR_APP_KEY || '', 'minar-2': () => process.env.MINAR2_DOC_KEY || '' };
const appOf = (app) => (app === 'minar-2' ? 'minar-2' : 'minar');
const keyOf = (app) => KEYS[appOf(app)]();

function sign(token, app) {
  return crypto.createHmac('sha256', keyOf(app)).update('minar-doc:' + String(token)).digest('base64url').slice(0, 16);
}
// valid(token, sig, app) checks that program's key; without app (the link page) any program's key is accepted.
function valid(token, sig, app) {
  if (!TOKEN.test(String(token || ''))) return false;
  for (const a of app ? [appOf(app)] : Object.keys(KEYS)) {
    if (!keyOf(a)) continue;
    const x = Buffer.from(sign(token, a)), y = Buffer.from(String(sig || ''));
    if (x.length === y.length && crypto.timingSafeEqual(x, y)) return true;
  }
  return false;
}

async function find(token) {
  const { list } = require('@vercel/blob');
  const { blobs } = await list({ prefix: PREFIX + token + '.json', limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  if (!r.ok) throw new Error('doc-fetch-' + r.status);
  return r.json();
}

async function save(token, manifest) {
  const { put } = require('@vercel/blob');
  await put(PREFIX + token + '.json', JSON.stringify(manifest), { access: 'public', addRandomSuffix: false, contentType: 'application/json' });
}

module.exports = { sign, valid, find, save, keyOf, appOf, TOKEN };
