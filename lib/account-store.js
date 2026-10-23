'use strict';
// Minar accounts kept on the server (user, 23 Oct 2026: a registration must survive app updates and
// work on other computers). Stored as one small JSON file in Vercel Blob, same pattern as bot-store:
// every save writes a new randomly named blob and deletes the older ones.
// Passwords are never stored: only a PBKDF2-SHA256 hash with a per-account salt and a server-side
// secret (MINAR_ACCOUNT_PEPPER, falling back to the bot token), so the blob alone cannot be cracked.
const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');

const PREFIX = 'minar-accounts/state-';

function pepper() { return process.env.MINAR_ACCOUNT_PEPPER || process.env.TELEGRAM_BOT_TOKEN || ''; }

function hash(password, salt) {
  return crypto.pbkdf2Sync(String(password) + '\u0000' + pepper(), Buffer.from(salt, 'hex'), 120000, 32, 'sha256').toString('hex');
}

async function load() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('blob-not-configured');
  const { blobs } = await list({ prefix: PREFIX });
  if (!blobs.length) return { accounts: {} };
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  if (!r.ok) throw new Error('accounts-fetch-' + r.status);
  const data = await r.json();
  return { accounts: (data && data.accounts) || {} };
}

async function save(state) {
  const old = (await list({ prefix: PREFIX })).blobs.map((b) => b.url);
  await put(PREFIX + 'v.json', JSON.stringify(state), {
    access: 'public', addRandomSuffix: true, contentType: 'application/json',
  });
  if (old.length) { try { await del(old); } catch {} }
}

async function register(login, password, consentAt) {
  const key = login.toLowerCase();
  const state = await load();
  if (state.accounts[key]) return { ok: false, error: 'exists' };
  const salt = crypto.randomBytes(16).toString('hex');
  state.accounts[key] = { login, salt, hash: hash(password, salt), consentAt: consentAt || new Date().toISOString(), createdAt: new Date().toISOString() };
  await save(state);
  return { ok: true, login };
}

async function login(login, password) {
  const acc = (await load()).accounts[String(login || '').toLowerCase()];
  if (!acc) return { ok: false, error: 'no-account' };
  const a = Buffer.from(hash(password, acc.salt), 'hex'), b = Buffer.from(acc.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid-credentials' };
  return { ok: true, login: acc.login, consentAt: acc.consentAt };
}

module.exports = { register, login };
