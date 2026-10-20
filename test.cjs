'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minar-srv-'));

function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = payload.length;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(BASE + p, { method, headers }, resp => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        let json; try { json = JSON.parse(Buffer.concat(chunks)); } catch { json = null; }
        resolve({ status: resp.statusCode, json });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let child;
async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { const h = await req('GET', '/api/health'); if (h.json && h.json.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

test('server flow', async (t) => {
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), MINAR_SECRET: 'test-secret', MINAR_DATA_DIR: dataDir },
    stdio: 'ignore',
  });
  await waitReady();

  await t.test('register requires consent', async () => {
    const r = await req('POST', '/api/register', { login: 'engineer1', password: 'pass1234' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'consent-required');
  });

  let token;
  await t.test('register with consent returns a token', async () => {
    const r = await req('POST', '/api/register', { login: 'engineer1', password: 'pass1234', consent: true });
    assert.equal(r.status, 200);
    assert.ok(r.json.token);
    token = r.json.token;
  });

  await t.test('duplicate registration is rejected', async () => {
    const r = await req('POST', '/api/register', { login: 'engineer1', password: 'pass1234', consent: true });
    assert.equal(r.status, 409);
  });

  await t.test('login with wrong password fails', async () => {
    const r = await req('POST', '/api/login', { login: 'engineer1', password: 'wrongpass' });
    assert.equal(r.status, 401);
  });

  await t.test('login with right password returns a token', async () => {
    const r = await req('POST', '/api/login', { login: 'engineer1', password: 'pass1234' });
    assert.equal(r.status, 200);
    assert.ok(r.json.token);
  });

  await t.test('upload without token is unauthorized', async () => {
    const r = await req('POST', '/api/upload', { name: 'a.dxf', dataBase64: 'AAAA' });
    assert.equal(r.status, 401);
  });

  await t.test('upload with token but malformed payload is rejected before any delivery', async () => {
    // No valid dataBase64/name => rejected with bad-payload, so the server never
    // attempts an outbound Telegram call. (Delivery itself needs a live network
    // and real bot credentials and is verified manually after deployment.)
    const r = await req('POST', '/api/upload', { foo: 'bar' }, token);
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad-payload');
  });

  child.kill();
});
