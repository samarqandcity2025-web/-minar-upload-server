'use strict';
// Vercel serverless function: Minar account register / login on the server, so one registration
// works after app updates and on every computer. POST {appKey, action:'register'|'login', login,
// password, consentAt, profile:{firstName,lastName,phone,email}}. Protected by the shared MINAR_APP_KEY like the other endpoints.
const accounts = require('../lib/account-store');

// The bot's @username from Telegram (env TELEGRAM_BOT_USERNAME wins), cached per server instance.
let botCache = '';
async function botName() {
  if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
  if (botCache || !process.env.TELEGRAM_BOT_TOKEN) return botCache;
  try {
    const r = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/getMe');
    const j = await r.json();
    botCache = (j && j.ok && j.result && j.result.username) || '';
  } catch {}
  return botCache;
}

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
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  if (!b || typeof b !== 'object') b = {};
  if (!APP_KEY || b.appKey !== APP_KEY) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }

  // The bot the app opens for the phone code (t.me/<bot>?start=verify).
  if (b.action === 'phone-bot') {
    const bot = await botName();
    res.status(bot ? 200 : 503).json(bot ? { ok: true, bot } : { ok: false, error: 'no-bot' });
    return;
  }

  const login = typeof b.login === 'string' ? b.login.trim() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!/^[A-Za-z0-9_.@-]{3,64}$/.test(login)) { res.status(400).json({ ok: false, error: 'bad-login' }); return; }
  if (b.action !== 'import' && (password.length < 6 || password.length > 256)) { res.status(400).json({ ok: false, error: 'bad-password' }); return; }

  try {
    const out = b.action === 'import' ? await accounts.importVerifier(login, b.salt, b.verifier, b.consentAt, b.profile)
      : b.action === 'register' ? await accounts.register(login, password, b.consentAt, b.profile, b.phoneCode)
      : b.action === 'login' ? await accounts.login(login, password)
      : { ok: false, error: 'bad-action' };
    if (!out.ok && out.error !== 'invalid-credentials' && out.error !== 'no-account') await new Promise((r) => setTimeout(r, 400));
    res.status(out.ok ? 200 : out.error === 'exists' || out.error === 'phone-exists' ? 409 : out.error === 'code-tries' ? 429
      : ['bad-action', 'bad-payload', 'bad-code'].includes(out.error) ? 400 : 401).json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server' });
  }
};
