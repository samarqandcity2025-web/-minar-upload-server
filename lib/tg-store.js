'use strict';
// Telegram as the file store for shared 3D links (user, 29 Oct 2026: «the server memory must not fill up»). Files go to a
// company chat as documents; their file_id is the only thing a link carries, nothing is kept on this server. Reading goes
// through getFile + the bot file URL (the bot token never leaves the server). Every id in a link is signed with an HMAC of
// the bot token, so a link can open only files this function stored, never other documents of the bot.
// MINAR_3D_MOCK_DIR (local test only): store the files in that folder instead of Telegram.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BOT = () => process.env.TELEGRAM_BOT_TOKEN || '';
const MOCK = () => process.env.MINAR_3D_MOCK_DIR || '';
const splitIds = (v) => String(v || '').split(/[\s,;]+/).filter(Boolean);
// MINAR_3D_CHAT_ID (a private channel/group with the bot) or the first fixed recipient.
const chat = () => splitIds(process.env.MINAR_3D_CHAT_ID)[0] || splitIds(process.env.TELEGRAM_CHAT_ID)[0] || '';

function sign(id) {
  return crypto.createHmac('sha256', 'minar-3d:' + (BOT() || MOCK())).update(String(id)).digest('base64url').slice(0, 22);
}
function valid(id, sig) {
  const a = Buffer.from(sign(id)), b = Buffer.from(String(sig || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function tg(method, form) {
  const r = await fetch('https://api.telegram.org/bot' + BOT() + '/' + method, { method: 'POST', body: form }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  if (!(j && j.ok)) throw new Error('telegram ' + method + ': ' + ((j && j.description) || (r ? r.status : 'network')));
  return j.result;
}

// Several documents in one album message (fewer chat messages); returns their file_ids in order.
async function putMany(files) {
  if (MOCK()) return files.map((f) => { const id = 'mock' + crypto.randomBytes(12).toString('hex'); fs.writeFileSync(path.join(MOCK(), id), f.bytes); return id; });
  const ids = [];
  for (let i = 0; i < files.length; i += 10) {
    const group = files.slice(i, i + 10);
    // an album needs 2-10 items
    if (group.length === 1) { ids.push(await put(group[0].bytes, group[0].name, '', true)); continue; }
    const form = new FormData();
    form.append('chat_id', chat());
    form.append('disable_notification', 'true');
    form.append('media', JSON.stringify(group.map((f, k) => ({ type: 'document', media: 'attach://f' + k }))));
    group.forEach((f, k) => form.append('f' + k, new Blob([f.bytes]), f.name));
    for (const m of await tg('sendMediaGroup', form)) ids.push(m.document.file_id);
  }
  return ids;
}

async function put(bytes, name, caption, quiet) {
  if (MOCK()) return (await putMany([{ bytes, name }]))[0];
  const form = new FormData();
  form.append('chat_id', chat());
  if (caption) form.append('caption', caption);
  if (quiet) form.append('disable_notification', 'true');
  form.append('document', new Blob([bytes]), name);
  return (await tg('sendDocument', form)).document.file_id;
}

async function get(id) {
  if (MOCK()) return fs.readFileSync(path.join(MOCK(), path.basename(String(id))));
  const form = new FormData();
  form.append('file_id', String(id));
  const f = await tg('getFile', form);
  const r = await fetch('https://api.telegram.org/file/bot' + BOT() + '/' + f.file_path);
  if (!r.ok) throw new Error('telegram file ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

const configured = () => Boolean(MOCK() || (BOT() && chat()));

module.exports = { put, putMany, get, sign, valid, configured };
