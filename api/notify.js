'use strict';
// Vercel serverless function: receives {login, name, time, blobUrl} from the
// browser (after the file is in Vercel Blob), downloads that file server-side
// and uploads it to the company Telegram chat as a real document (multipart).
// Then deletes the blob. Protected by the shared MINAR_APP_KEY. The bot token
// lives only here, in env vars.
const { del } = require('@vercel/blob');
const { allChats } = require('../lib/bot-store');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method' }); return; }

  const APP_KEY = process.env.MINAR_APP_KEY || '';
  const BOT = process.env.TELEGRAM_BOT_TOKEN || '';
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  if (!b || typeof b !== 'object') b = {};

  if (!APP_KEY || b.appKey !== APP_KEY) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
  if (!b.blobUrl || !b.name) { res.status(400).json({ ok: false, error: 'bad-payload' }); return; }
  // Fixed TELEGRAM_CHAT_ID ids + people the admin added through the bot menu.
  const CHATS = await allChats();
  if (!BOT || !CHATS.length) { res.status(500).json({ ok: false, error: 'telegram-not-configured' }); return; }

  const when = b.time ? new Date(Number(b.time) || b.time) : new Date();
  const caption =
    '📂 Yangi fayl yuklandi\n' +
    '👤 Login: ' + (b.login || '-') + '\n' +
    '📄 Fayl: ' + b.name + '\n' +
    '🕒 Vaqt: ' + new Date(when.getTime() + 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' (Toshkent)';

  try {
    // 1) download the file from Blob (server-side; no request-size limit here)
    const fileResp = await fetch(b.blobUrl);
    if (!fileResp.ok) {
      res.status(502).json({ ok: false, error: 'blob-fetch-failed-' + fileResp.status });
      return;
    }
    const buf = Buffer.from(await fileResp.arrayBuffer());

    // 2) send it to every chat as a real document (multipart)
    const failed = [];
    for (const chat of CHATS) {
      const form = new FormData();
      form.append('chat_id', chat);
      form.append('caption', caption);
      form.append('document', new Blob([buf]), String(b.name));

      const tgResp = await fetch('https://api.telegram.org/bot' + BOT + '/sendDocument', {
        method: 'POST',
        body: form,
      }).catch(() => null);
      const tg = tgResp ? await tgResp.json().catch(() => null) : null;
      if (!(tg && tg.ok)) {
        failed.push(chat + ': ' + ((tg && tg.description) || ('telegram-http-' + (tgResp ? tgResp.status : 'network'))));
      }
    }

    // 3) clean up the temporary blob
    try { await del(b.blobUrl); } catch {}

    // ok when at least one chat received it; failures are reported for the rest
    if (failed.length < CHATS.length) { res.status(200).json({ ok: true, failed }); return; }
    res.status(502).json({ ok: false, error: failed.join('; ') });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
