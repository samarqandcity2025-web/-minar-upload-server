'use strict';
// One-time setup after deploy: open in a browser
//   https://<your-app>.vercel.app/api/telegram-setup?key=<MINAR_APP_KEY>
// Points the bot's webhook at /api/telegram and registers its command menu.
const store = require('../lib/bot-store');

async function tg(method, params) {
  const r = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return r.json().catch(() => null);
}

module.exports = async (req, res) => {
  const APP_KEY = process.env.MINAR_APP_KEY || '';
  if (!APP_KEY || (req.query && req.query.key) !== APP_KEY) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
  if (!process.env.TELEGRAM_BOT_TOKEN) { res.status(500).json({ ok: false, error: 'telegram-not-configured' }); return; }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = 'https://' + host + '/api/telegram';
  const webhook = await tg('setWebhook', {
    url,
    secret_token: store.webhookSecret(),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  const commands = await tg('setMyCommands', { commands: [{ command: 'start', description: 'Boshlash' }] });
  const adminCommands = [];
  for (const a of store.admins()) {
    adminCommands.push(await tg('setMyCommands', {
      scope: { type: 'chat', chat_id: Number(a) },
      commands: [
        { command: 'menu', description: 'Menyu' },
        { command: 'add', description: "Yangi foydalanuvchi qo'shish" },
        { command: 'list', description: "Fayl oluvchilar ro'yxati" },
      ],
    }));
  }
  res.status(200).json({ ok: Boolean(webhook && webhook.ok), url, admins: store.admins(), webhook, commands, adminCommands });
};
