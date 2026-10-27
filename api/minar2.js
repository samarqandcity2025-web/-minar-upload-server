'use strict';
// Minar 2 registration requests (user, 27 Oct 2026: «add Minar 2 to the Minar Telegram: we see who registers, he asks for
// permission and we allow him»). Called only by the Minar 2 server (minar2-server lib/telegram.js) with env MINAR2_LINK_KEY.
// POST {key, action:'request', login, profile:{firstName,lastName,phone,email}, createdAt}: every bot admin gets the request
// with ✅ / ❌ buttons; api/telegram.js handles them and tells the Minar 2 server (api/approve).
const crypto = require('crypto');
const store = require('../lib/bot-store');

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const s = (v, n) => String(v || '').trim().slice(0, n);

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
  if (b.action !== 'request' || !/^[A-Za-z0-9_.@-]{3,58}$/.test(s(b.login, 64))) { res.status(400).json({ ok: false, error: 'bad-request' }); return; }
  if (!process.env.TELEGRAM_BOT_TOKEN) { res.status(500).json({ ok: false, error: 'telegram-not-configured' }); return; }
  const login = s(b.login, 64), text = requestText(b);
  const buttons = { inline_keyboard: [[{ text: '✅ Ruxsat berish', callback_data: 'm2ok:' + login }, { text: '❌ Rad etish', callback_data: 'm2no:' + login }]] };
  let sent = 0;
  for (const chat of store.admins()) {
    try {
      const r = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, reply_markup: buttons }) });
      const j = await r.json().catch(() => null);
      if (j && j.ok) sent++;
    } catch {}
  }
  res.status(sent ? 200 : 502).json({ ok: sent > 0, sent });
};
