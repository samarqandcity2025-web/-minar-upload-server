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

// Registration profile (user, 23 Oct 2026): first name, last name, phone and e-mail. Shown with
// every file in Telegram. Only short trimmed strings are kept; anything else is dropped.
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const out = { firstName: s(p.firstName, 60), lastName: s(p.lastName, 60), phone: s(p.phone, 30), email: s(p.email, 120) };
  return Object.values(out).some(Boolean) ? out : null;
}

async function register(login, password, consentAt, profile) {
  const key = login.toLowerCase();
  const state = await load();
  if (state.accounts[key]) return { ok: false, error: 'exists' };
  const salt = crypto.randomBytes(16).toString('hex');
  state.accounts[key] = { login, salt, hash: hash(password, salt), profile: cleanProfile(profile), consentAt: consentAt || new Date().toISOString(), createdAt: new Date().toISOString() };
  await save(state);
  return { ok: true, login };
}

// The app's own offline verifier: PBKDF2-SHA256(password, clientSalt, 100000) — same as minar-upload.js.
function clientVerifier(password, clientSalt) {
  return crypto.pbkdf2Sync(String(password), Buffer.from(clientSalt, 'hex'), 100000, 32, 'sha256').toString('hex');
}
const sealVerifier = (v) => crypto.createHmac('sha256', pepper()).update(String(v).toLowerCase()).digest('hex');

// An account made before server accounts existed lives only in one app's storage, and that app
// keeps no password — only its verifier. Importing the verifier moves it to the server, so the same
// login and password work everywhere (user, 23 Oct 2026).
async function importVerifier(login, clientSalt, verifier, consentAt, profile) {
  if (!/^[0-9a-f]{32}$/i.test(clientSalt || '') || !/^[0-9a-f]{64}$/i.test(verifier || '')) return { ok: false, error: 'bad-payload' };
  const key = login.toLowerCase();
  const state = await load();
  if (state.accounts[key]) return { ok: false, error: 'exists' };
  state.accounts[key] = { login, clientSalt, verifier: sealVerifier(verifier), profile: cleanProfile(profile), consentAt: consentAt || new Date().toISOString(), createdAt: new Date().toISOString(), imported: true };
  await save(state);
  return { ok: true, login };
}

const same = (x, y) => { const a = Buffer.from(x, 'hex'), b = Buffer.from(y, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };

async function login(login, password) {
  const acc = (await load()).accounts[String(login || '').toLowerCase()];
  if (!acc) return { ok: false, error: 'no-account' };
  const good = acc.hash ? same(hash(password, acc.salt), acc.hash) : same(sealVerifier(clientVerifier(password, acc.clientSalt)), acc.verifier);
  if (!good) return { ok: false, error: 'invalid-credentials' };
  return { ok: true, login: acc.login, consentAt: acc.consentAt, profile: acc.profile || null };
}

// Profile of a login for the Telegram caption (null when unknown or not set).
async function profileOf(login) {
  const acc = (await load()).accounts[String(login || '').toLowerCase()];
  return (acc && acc.profile) || null;
}

module.exports = { register, login, importVerifier, profileOf, cleanProfile };
