'use strict';
// Shared 3D link (user, 29 Oct 2026: one link that opens on Android, iPhone and computers). The app uploads the compact 3D
// data (both levels, gzip, as made by minar-app/share3d.js) to Vercel Blob, as for files, and calls this function with the
// blobUrl. The data is cut into parts below the 4.5 MB function response limit and sent to the company Telegram chat;
// a small manifest (names of the parts, labels) is sent too. The returned link carries only the manifest's file_id and
// its signature, so nothing stays on this server (the temporary blob is deleted). Protected by MINAR_APP_KEY.
const { del } = require('@vercel/blob');
const store = require('../lib/tg-store');
const { cleanProfile } = require('../lib/account-store');

const PART = 3.5 * 1024 * 1024;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method' }); return; }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  if (!b || typeof b !== 'object') b = {};
  const APP_KEY = process.env.MINAR_APP_KEY || '';
  if (!APP_KEY || b.appKey !== APP_KEY) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
  if (!store.configured()) { res.status(500).json({ ok: false, error: 'telegram-not-configured' }); return; }
  try {
    // the data: from the temporary blob (production), or inline (small test / local server)
    let data = b.payload;
    if (!data && b.blobUrl) {
      const r = await fetch(b.blobUrl);
      if (!r.ok) { res.status(502).json({ ok: false, error: 'blob-fetch-failed-' + r.status }); return; }
      data = await r.json();
    }
    if (!data || !data.levels || !data.levels.full || !data.levels.lite) { res.status(400).json({ ok: false, error: 'bad-payload' }); return; }
    const name = String(data.name || b.name || 'Minar').slice(0, 200);
    const files = [], index = {};
    for (const level of ['full', 'lite']) {
      const L = data.levels[level], bytes = Buffer.from(String(L.data || ''), 'base64');
      if (!bytes.length || !L.meta) { res.status(400).json({ ok: false, error: 'bad-level' }); return; }
      index[level] = { meta: L.meta, from: files.length };
      for (let at = 0; at < bytes.length; at += PART) files.push({ bytes: bytes.subarray(at, at + PART), name: 'minar-3d-' + level + '-' + files.length + '.bin' });
      index[level].to = files.length;
    }
    const ids = await store.putMany(files);
    const levels = {};
    for (const [level, x] of Object.entries(index)) levels[level] = { meta: x.meta, parts: ids.slice(x.from, x.to) };
    const manifest = { v: 1, name, lang: String(data.lang || 'ru').slice(0, 5), text: data.text && typeof data.text === 'object' ? data.text : {}, created: Date.now(), levels };
    const p = cleanProfile(b.profile) || {};
    const who = [p.firstName, p.lastName].filter(Boolean).join(' ');
    const caption = '🧊 3D link\n📄 ' + name + '\n🔑 Login: ' + (b.login || '-') + (who ? '\n👤 ' + who : '');
    const id = await store.put(Buffer.from(JSON.stringify(manifest)), 'minar-3d.json', caption);
    if (b.blobUrl) { try { await del(b.blobUrl); } catch {} }
    const origin = process.env.MINAR_PUBLIC_ORIGIN || ((req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host);
    res.status(200).json({ ok: true, url: origin + '/3d/' + id + '.' + store.sign(id) });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
};
