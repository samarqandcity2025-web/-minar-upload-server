'use strict';
// Stores an exported document for its QR link (user, 2 Nov 2026). The app has already printed the QR with the link
// /d/<token>.<sig> on the PDF / Excel, then uploads the same file to Vercel Blob (inline for a local test server) and calls
// this function: {appKey, login, profile, token, sig, kind: 'pdf'|'xlsx', name, exportedAt, rows, section, blobUrl|payload}.
// The file is cut into parts below the 4.5 MB response limit and sent to the company Telegram chat; the manifest (part ids,
// name, date, who exported it, the specification rows, SHA-256) goes to lib/doc-store. An existing token is never
// overwritten. Protected by MINAR_APP_KEY.
const crypto = require('crypto');
const store = require('../lib/tg-store');
const docs = require('../lib/doc-store');
const { cleanProfile } = require('../lib/account-store');

const PART = 3.5 * 1024 * 1024;
const MAX = 20 * 1024 * 1024;
const KINDS = { pdf: '📄 PDF', xlsx: '📊 Excel' };

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const text = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
// Specification rows № · Наименование · Кол-во · Ед.изм. as plain values (shown on the link page); Minar 2 offers send up to
// 8 columns (cols) and one-cell section rows.
function cleanRows(rows) {
  if (!Array.isArray(rows)) return null;
  return rows.slice(0, 1000).map((r) => (Array.isArray(r) ? r.slice(0, 8).map((c) => (typeof c === 'number' && isFinite(c) ? c : text(c, 300))) : []));
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method' }); return; }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  if (!b || typeof b !== 'object') b = {};
  const app = docs.appOf(b.app), APP_KEY = docs.keyOf(app);
  if (!APP_KEY || b.appKey !== APP_KEY) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
  if (!docs.valid(b.token, b.sig, app)) { res.status(400).json({ ok: false, error: 'bad-token' }); return; }
  if (!KINDS[b.kind]) { res.status(400).json({ ok: false, error: 'bad-kind' }); return; }
  if (!store.configured()) { res.status(500).json({ ok: false, error: 'telegram-not-configured' }); return; }
  const origin = process.env.MINAR_PUBLIC_ORIGIN || ((req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host);
  const url = origin + '/d/' + b.token + '.' + b.sig;
  try {
    // A retry of a queued upload (or a second call) for a stored token changes nothing.
    if (await docs.find(b.token)) {
      if (b.blobUrl) { try { await require('@vercel/blob').del(b.blobUrl); } catch {} }
      res.status(200).json({ ok: true, url, existing: true }); return;
    }
    let bytes;
    if (b.payload) bytes = Buffer.from(String(b.payload), 'base64');
    else if (b.blobUrl) {
      const r = await fetch(b.blobUrl);
      if (!r.ok) { res.status(502).json({ ok: false, error: 'blob-fetch-failed-' + r.status }); return; }
      bytes = Buffer.from(await r.arrayBuffer());
    }
    const rowsOnly = app === 'minar-2' && (!bytes || !bytes.length) && Array.isArray(b.rows) && b.rows.length;
    if (!rowsOnly && (!bytes || !bytes.length)) { res.status(400).json({ ok: false, error: 'bad-payload' }); return; }
    if (bytes && bytes.length > MAX) { res.status(413).json({ ok: false, error: 'too-big' }); return; }
    const name = text(b.name, 200).replace(/[\\/:*?"<>|]+/g, '_') || ('minar.' + b.kind);
    const p = cleanProfile(b.profile) || {};
    const who = [p.firstName, p.lastName].filter(Boolean).join(' ');
    const caption = KINDS[b.kind] + ' QR hujjat / документ' + (app === 'minar-2' ? ' · Minar 2' : '') + '\n📄 ' + name + '\n🔑 Login: ' + (b.login || '-') + (who ? '\n👤 ' + who : '');
    let parts;
    if (rowsOnly) parts = [];
    else if (bytes.length <= PART) parts = [await store.put(bytes, name, caption)];
    else {
      const files = [];
      for (let at = 0, k = 1; at < bytes.length; at += PART, k++) files.push({ bytes: bytes.subarray(at, at + PART), name: name + '.part' + k });
      parts = await store.putMany(files);
      await store.put(Buffer.from(JSON.stringify({ name, parts: parts.length })), 'minar-doc.json', caption);
    }
    const exportedAt = isNaN(Date.parse(b.exportedAt)) ? new Date().toISOString() : new Date(b.exportedAt).toISOString();
    const manifest = {
      v: 1, app, kind: b.kind, name, size: bytes ? bytes.length : 0, sha256: bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : '',
      cols: Array.isArray(b.cols) ? b.cols.slice(0, 8).map((c) => text(c, 60)) : null,
      exportedAt, stored: new Date().toISOString(), who, section: text(b.section, 200), rows: cleanRows(b.rows), parts,
    };
    // Two uploads of one token at the same moment: the one already saved stays.
    if (await docs.find(b.token)) { res.status(200).json({ ok: true, url, existing: true }); return; }
    await docs.save(b.token, manifest);
    if (b.blobUrl) { try { await require('@vercel/blob').del(b.blobUrl); } catch {} }
    res.status(200).json({ ok: true, url });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
};
