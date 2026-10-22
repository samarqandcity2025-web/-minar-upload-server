'use strict';
// Recipient list for the Telegram bot, kept as a small JSON file in Vercel Blob.
// Every save writes a new randomly named blob and deletes the older ones, so a
// read never hits a stale CDN copy. Env TELEGRAM_CHAT_ID recipients are fixed
// ("asosiy") and always included; the bot manages only the stored ones.
const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');

const PREFIX = 'minar-bot/state-';

function empty() { return { recipients: [], pending: [], seen: [], awaiting: {} }; }

function splitIds(v) { return String(v || '').split(/[\s,;]+/).filter(Boolean); }

// Fixed recipients from Vercel env: "6156628475, 123456789".
function envChats() { return splitIds(process.env.TELEGRAM_CHAT_ID); }

// Admins manage the list. Default: the first fixed recipient (the owner).
function admins() {
  const a = splitIds(process.env.TELEGRAM_ADMIN_ID);
  return a.length ? a : envChats().slice(0, 1);
}

function webhookSecret() {
  return crypto.createHash('sha256').update('minar-webhook:' + (process.env.TELEGRAM_BOT_TOKEN || '')).digest('hex').slice(0, 48);
}

async function load() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return empty();
  const { blobs } = await list({ prefix: PREFIX });
  if (!blobs.length) return empty();
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  if (!r.ok) throw new Error('state-fetch-' + r.status);
  return Object.assign(empty(), await r.json());
}

async function save(state) {
  const old = (await list({ prefix: PREFIX })).blobs.map((b) => b.url);
  await put(PREFIX + 'v.json', JSON.stringify(state), {
    access: 'public', addRandomSuffix: true, contentType: 'application/json',
  });
  if (old.length) { try { await del(old); } catch {} }
}

// Every chat that should receive uploaded files (fixed + added through the bot).
async function allChats() {
  const ids = envChats();
  try {
    for (const r of (await load()).recipients) if (!ids.includes(String(r.id))) ids.push(String(r.id));
  } catch {}
  return ids;
}

module.exports = { load, save, envChats, admins, webhookSecret, allChats, empty };
