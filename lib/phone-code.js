'use strict';
// Phone check through the Minar Telegram bot (user, 2 Nov 2026: a new registration must prove the phone is real).
// The person presses Start in the bot (link from the app), shares the contact with Telegram's own «share phone» button —
// Telegram only sends the number of that Telegram account — and the bot answers with a 6-digit code for that number.
// The app sends the code with the registration; the server checks it here. Nothing is stored: the code is an HMAC of
// the number and a 5-minute time slot (this slot or the previous one is accepted, so a code lives 5–10 minutes).
const crypto = require('crypto');

const SLOT = 5 * 60 * 1000;

function secret() { return process.env.MINAR_ACCOUNT_PEPPER || process.env.TELEGRAM_BOT_TOKEN || ''; }

// Digits only; a 9-digit Uzbek mobile number written without the country code gets 998.
function normalize(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 9) d = '998' + d;
  return d.length >= 9 && d.length <= 15 ? d : '';
}

function codeFor(phone, at = Date.now()) {
  const d = normalize(phone);
  if (!d || !secret()) return '';
  const slot = Math.floor(at / SLOT);
  const n = crypto.createHmac('sha256', secret()).update('minar-phone:' + d + ':' + slot).digest().readUInt32BE(0);
  return String(n % 1000000).padStart(6, '0');
}

// Failed tries per number, kept in this server instance only (best effort against guessing).
const fails = new Map();
const MAX_FAILS = 5;

function check(phone, code, at = Date.now()) {
  const d = normalize(phone), c = String(code || '').replace(/\D/g, '');
  if (!d || c.length !== 6) return { ok: false, error: 'bad-code' };
  const f = fails.get(d);
  if (f && at - f.first < 2 * SLOT && f.n >= MAX_FAILS) return { ok: false, error: 'code-tries' };
  const good = [codeFor(d, at), codeFor(d, at - SLOT)].some((x) => x && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(c)));
  if (good) { fails.delete(d); return { ok: true, phone: d }; }
  if (!f || at - f.first >= 2 * SLOT) fails.set(d, { first: at, n: 1 }); else f.n++;
  return { ok: false, error: 'bad-code' };
}

module.exports = { normalize, codeFor, check, SLOT };
