'use strict';
// Minar upload server — zero-dependency Node HTTP server.
// Handles one-time registration, login, and receiving an uploaded CAD file
// which is forwarded (together with the uploader's login and the time) to a
// Telegram chat via the Bot API. No external npm packages are used.
//
// Configure through environment variables (see .env.example):
//   TELEGRAM_BOT_TOKEN  - bot token from @BotFather          (required for upload)
//   TELEGRAM_CHAT_ID    - chat/channel id that receives files (required for upload)
//   MINAR_SECRET        - secret string used to sign session tokens (required)
//   MINAR_DATA_DIR      - folder for the users file (default: ./data)
//   PORT                - listen port (default: 8787)
//   MINAR_MAX_BYTES     - max accepted request body in bytes (default: 60 MB)

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8787;
const SECRET = process.env.MINAR_SECRET || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const DATA_DIR = process.env.MINAR_DATA_DIR || path.join(__dirname, 'data');
const MAX_BYTES = Number(process.env.MINAR_MAX_BYTES) || 60 * 1024 * 1024;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

if (!SECRET) {
  console.error('MINAR_SECRET is not set. Refusing to start without a token secret.');
  process.exit(1);
}

// ---- user storage (simple JSON file; swap for a real DB in production) ----
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, hash: dk };
}
function verifyPassword(password, salt, hash) {
  const dk = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(dk, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- session tokens: login.expiry.hmac(base64url) ----
function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}
function makeToken(login) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = Buffer.from(login).toString('base64url') + '.' + exp;
  return body + '.' + sign(body);
}
function readToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const body = parts[0] + '.' + parts[1];
  if (sign(body) !== parts[2]) return null;
  if (Number(parts[1]) < Date.now()) return null;
  try { return Buffer.from(parts[0], 'base64url').toString('utf8'); }
  catch { return null; }
}

// ---- helpers ----
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function validLogin(login) { return typeof login === 'string' && /^[A-Za-z0-9_.@-]{3,64}$/.test(login); }
function validPassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 200; }

// ---- Telegram: build multipart/form-data and send the document ----
function sendDocumentToTelegram(fileName, fileBuffer, caption) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN || !CHAT_ID) { reject(new Error('telegram-not-configured')); return; }
    const boundary = '----MinarBoundary' + crypto.randomBytes(12).toString('hex');
    const nl = '\r\n';
    const parts = [];
    const field = (name, value) =>
      Buffer.from(`--${boundary}${nl}Content-Disposition: form-data; name="${name}"${nl}${nl}${value}${nl}`);
    parts.push(field('chat_id', CHAT_ID));
    parts.push(field('caption', caption));
    parts.push(Buffer.from(
      `--${boundary}${nl}Content-Disposition: form-data; name="document"; filename="${fileName.replace(/"/g, '')}"${nl}` +
      `Content-Type: application/octet-stream${nl}${nl}`));
    parts.push(fileBuffer);
    parts.push(Buffer.from(`${nl}--${boundary}--${nl}`));
    const payload = Buffer.concat(parts);
    const req = https.request({
      method: 'POST',
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendDocument`,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length,
      },
    }, resp => {
      const buf = [];
      resp.on('data', d => buf.push(d));
      resp.on('end', () => {
        const text = Buffer.concat(buf).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { json = null; }
        if (json && json.ok) resolve(json);
        else reject(new Error('telegram-failed: ' + text.slice(0, 300)));
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

// ---- routes ----
async function handle(req, res) {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/health') {
    send(res, 200, { ok: true, telegram: Boolean(BOT_TOKEN && CHAT_ID) });
    return;
  }

  if (req.method !== 'POST') { send(res, 404, { ok: false, error: 'not-found' }); return; }

  let body;
  try { body = await readBody(req); }
  catch { send(res, 413, { ok: false, error: 'too-large' }); return; }

  if (url.pathname === '/api/register' || url.pathname === '/api/login') {
    let data; try { data = JSON.parse(body.toString('utf8')); } catch { data = null; }
    if (!data) { send(res, 400, { ok: false, error: 'bad-json' }); return; }
    const login = data.login, password = data.password;
    if (!validLogin(login)) { send(res, 400, { ok: false, error: 'bad-login' }); return; }
    if (!validPassword(password)) { send(res, 400, { ok: false, error: 'bad-password' }); return; }
    const users = loadUsers();
    const key = login.toLowerCase();

    if (url.pathname === '/api/register') {
      if (data.consent !== true) { send(res, 400, { ok: false, error: 'consent-required' }); return; }
      if (users[key]) { send(res, 409, { ok: false, error: 'exists' }); return; }
      const { salt, hash } = hashPassword(password);
      users[key] = { login, salt, hash, consentAt: new Date().toISOString(), createdAt: new Date().toISOString() };
      saveUsers(users);
      send(res, 200, { ok: true, token: makeToken(login), login });
      return;
    }
    // login
    const u = users[key];
    if (!u || !verifyPassword(password, u.salt, u.hash)) {
      send(res, 401, { ok: false, error: 'invalid-credentials' }); return;
    }
    send(res, 200, { ok: true, token: makeToken(u.login), login: u.login });
    return;
  }

  if (url.pathname === '/api/upload') {
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const login = readToken(auth);
    if (!login) { send(res, 401, { ok: false, error: 'unauthorized' }); return; }
    let data; try { data = JSON.parse(body.toString('utf8')); } catch { data = null; }
    if (!data || typeof data.dataBase64 !== 'string' || !data.name) {
      send(res, 400, { ok: false, error: 'bad-payload' }); return;
    }
    let fileBuffer;
    try { fileBuffer = Buffer.from(data.dataBase64, 'base64'); }
    catch { send(res, 400, { ok: false, error: 'bad-base64' }); return; }
    const when = data.time ? new Date(data.time) : new Date();
    const caption =
      `📂 Yangi fayl yuklandi\n` +
      `👤 Login: ${login}\n` +
      `📄 Fayl: ${data.name}\n` +
      `📦 Hajm: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB\n` +
      `🕒 Vaqt: ${when.toISOString()}`;
    try {
      await sendDocumentToTelegram(String(data.name), fileBuffer, caption);
      send(res, 200, { ok: true });
    } catch (e) {
      send(res, 502, { ok: false, error: 'delivery-failed', detail: String(e.message || e) });
    }
    return;
  }

  send(res, 404, { ok: false, error: 'not-found' });
}

http.createServer((req, res) => {
  handle(req, res).catch(e => { try { send(res, 500, { ok: false, error: String(e.message || e) }); } catch {} });
}).listen(PORT, () => {
  console.log(`Minar upload server listening on :${PORT}`);
  if (!BOT_TOKEN || !CHAT_ID) console.log('Note: Telegram not configured yet — uploads will fail until TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.');
});
