'use strict';
// Minar 2 registration requests (user, 27 Oct 2026: «add Minar 2 to the Minar Telegram: we see who registers, he asks for
// permission and we allow him»). Called only by the Minar 2 server (minar2-server lib/telegram.js) with env MINAR2_LINK_KEY.
// POST {key, action:'request', login, profile:{firstName,lastName,phone,email}, createdAt}: every bot admin gets the request
// with ✅ / ❌ buttons; api/telegram.js handles them and tells the Minar 2 server (api/approve). Assistant admins appointed
// in the bot get them too (user, 2 Nov 2026: «he is an admin, let him allow Minar 2 users as well»).
const crypto = require('crypto');
const store = require('../lib/bot-store');

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const s = (v, n) => String(v || '').trim().slice(0, n);
const BACKUP_PREFIX = 'minar2-backup/', BACKUP_KEEP = 30;

function requestText(b) {
  const p = b.profile || {}, t = Date.parse(b.createdAt) ? new Date(b.createdAt) : new Date();
  const time = t.toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return '🆕 Minar 2 — yangi ro‘yxatdan o‘tish\n\n' +
    'Ism familiya: ' + (s([p.firstName, p.lastName].filter(Boolean).join(' '), 130) || '-') + '\n' +
    'Telefon: ' + (s(p.phone, 30) || '-') + '\n' +
    'Gmail: ' + (s(p.email, 120) || '-') + '\n' +
    'Login: ' + s(b.login, 64) + '\n' +
    'Vaqt: ' + time + '\n\n' +
    'Minar 2 dan foydalanishga ruxsat berasizmi?';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method' }); return; }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  if (!b || typeof b !== 'object') b = {};
  const KEY = process.env.MINAR2_LINK_KEY || '';
  if (!KEY || !same(b.key || '', KEY)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
  // Nightly copy of the Minar 2 data (user, 17 Nov 2026: «the database has no backup»): kept in Blob, NOT sent to Telegram
  // (user, 2 Nov 2026: only registration requests go to the bot). The last BACKUP_KEEP copies stay.
  if (b.action === 'backup') {
    const name = s(b.name, 80), data = typeof b.data === 'string' ? b.data : '';
    if (!/^minar2-[0-9-]+\.json\.gz$/.test(name) || !data || data.length > 4_000_000) { res.status(400).json({ ok: false, error: 'bad-backup' }); return; }
    const { put, list, del } = require('@vercel/blob');
    await put(BACKUP_PREFIX + name, Buffer.from(data, 'base64'), { access: 'public', addRandomSuffix: true, contentType: 'application/gzip' });
    const { blobs } = await list({ prefix: BACKUP_PREFIX, limit: 1000 });
    const old = blobs.sort((x, y) => String(y.pathname).localeCompare(String(x.pathname))).slice(BACKUP_KEEP);
    if (old.length) await del(old.map((x) => x.url));
    res.status(200).json({ ok: true, kept: Math.min(blobs.length, BACKUP_KEEP) });
    return;
  }
  if (b.action === 'backups') {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: BACKUP_PREFIX, limit: 1000 });
    const backups = blobs.map((x) => ({ name: String(x.pathname).slice(BACKUP_PREFIX.length).replace(/-[A-Za-z0-9]{20,}(?=\.)/, ''), url: x.url, size: x.size, uploadedAt: x.uploadedAt }))
      .sort((x, y) => String(y.name).localeCompare(String(x.name)));
    res.status(200).json({ ok: true, backups });
    return;
  }
  if (b.action !== 'request' || !/^[A-Za-z0-9_.@-]{3,58}$/.test(s(b.login, 64))) { res.status(400).json({ ok: false, error: 'bad-request' }); return; }
  if (!process.env.TELEGRAM_BOT_TOKEN) { res.status(500).json({ ok: false, error: 'telegram-not-configured' }); return; }
  const login = s(b.login, 64), text = requestText(b);
  const buttons = { inline_keyboard: [[{ text: '✅ Ruxsat berish', callback_data: 'm2ok:' + login }, { text: '❌ Rad etish', callback_data: 'm2no:' + login }]] };
  let sent = 0;
  let helpers = [];
  try { helpers = ((await store.load()).helpers || []).map((h) => String(h.id)); } catch {}
  for (const chat of [...new Set([...store.admins(), ...helpers])]) {
    try {
      const r = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, reply_markup: buttons }) });
      const j = await r.json().catch(() => null);
      if (j && j.ok) sent++;
    } catch {}
  }
  res.status(sent ? 200 : 502).json({ ok: sent > 0, sent });
};
