'use strict';
// Vercel serverless function: Minar account register / login on the server, so one registration
// works after app updates and on every computer. POST {appKey, action:'register'|'login', login,
// password, consentAt}. Protected by the shared MINAR_APP_KEY like the other endpoints.
const accounts = require('../lib/account-store');

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

  const login = typeof b.login === 'string' ? b.login.trim() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!/^[A-Za-z0-9_.@-]{3,64}$/.test(login)) { res.status(400).json({ ok: false, error: 'bad-login' }); return; }
  if (password.length < 6 || password.length > 256) { res.status(400).json({ ok: false, error: 'bad-password' }); return; }

  try {
    const out = b.action === 'register' ? await accounts.register(login, password, b.consentAt)
      : b.action === 'login' ? await accounts.login(login, password)
      : { ok: false, error: 'bad-action' };
    res.status(out.ok ? 200 : out.error === 'exists' ? 409 : out.error === 'bad-action' ? 400 : 401).json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server' });
  }
};
