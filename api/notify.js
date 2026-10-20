'use strict';
// Vercel serverless function: receives {login, name, time, blobUrl} from the
// browser (after the file is in Vercel Blob) and asks Telegram to fetch that
// file and post it to the company chat. Then deletes the blob. Protected by
// the shared MINAR_APP_KEY. The bot token lives only here, in env vars.
const { del } = require('@vercel/blob');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  const APP_KEY = process.env.MINAR_APP_KEY || '';
  const BOT = process.env.TELEGRAM_BOT_TOKEN || '';
  const CHAT = process.env.TELEGRAM_CHAT_ID || '';
  const b = req.body || {};

  if (!APP_KEY || b.appKey !== APP_KEY) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
  if (!b.blobUrl || !b.name) { res.status(400).json({ ok: false, error: 'bad-payload' }); return; }
  if (!BOT || !CHAT) { res.status(500).json({ ok: false, error: 'telegram-not-configured' }); return; }

  const when = b.time ? new Date(Number(b.time) || b.time) : new Date();
  const caption =
    '📂 Yangi fayl yuklandi\n' +
    '👤 Login: ' + (b.login || '-') + '\n' +
    '📄 Fayl: ' + b.name + '\n' +
    '🕒 Vaqt: ' + when.toISOString();

  try {
    const tgResp = await fetch('https://api.telegram.org/bot' + BOT + '/sendDocument', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, document: b.blobUrl, caption }),
    });
    const tg = await tgResp.json().catch(() => null);
    // Clean up the blob whether or not Telegram accepted it.
    try { await del(b.blobUrl); } catch {}
    if (tg && tg.ok) { res.status(200).json({ ok: true }); return; }
    res.status(502).json({ ok: false, error: (tg && tg.description) || 'telegram-failed' });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
};
