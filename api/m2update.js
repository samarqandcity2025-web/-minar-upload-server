'use strict';
// Update server of the Minar 2 program (user, 17 Nov 2026: automatic update). The program asks /m2-update/latest.yml, then the
// installer named in it (electron-updater, generic provider). The files sit in Vercel Blob under minar2-update/ (put there by
// minar2-windows/publish-update.cjs), every version under its OWN names — minar2-<v>.exe, minar2-<v>.exe.blockmap,
// latest-<v>.yml — so no file is ever overwritten (no stale CDN copy, no overwrite rule of Blob). «latest.yml» is the newest
// latest-<v>.yml, read fresh every time; the installer and blockmap are redirected to Blob.
// POST {release, keep} (the release key, env MINAR2_RELEASE_KEY) removes all but the newest `keep` (>= 2) versions.
const crypto = require('crypto');
const PREFIX = 'minar2-update/';

const verOf = (pathname) => (/(\d+)\.(\d+)\.(\d+)/.exec(pathname) || []).slice(1).map(Number);
const newer = (a, b) => { for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); return 0; };

async function all() {
  const { list } = require('@vercel/blob');
  const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
  return blobs;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
      const REL = process.env.MINAR2_RELEASE_KEY || '', key = String((b && b.release) || '');
      if (REL.length < 16 || key.length !== REL.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(REL))) { res.status(401).end('unauthorized'); return; }
      const keep = Math.max(2, Number(b.keep) || 3), blobs = await all();
      const versions = [...new Set(blobs.map((x) => verOf(x.pathname).join('.')).filter((v) => v.split('.').length === 3))]
        .map((v) => v.split('.').map(Number)).sort((x, y) => newer(y, x)).map((v) => v.join('.'));
      const drop = blobs.filter((x) => { const v = verOf(x.pathname).join('.'); return v && versions.indexOf(v) >= keep; });
      if (drop.length) await require('@vercel/blob').del(drop.map((x) => x.url));
      res.status(200).json({ ok: true, versions: versions.slice(0, keep), removed: drop.length });
      return;
    }
    const f = String((req.query && req.query.f) || '');
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(f)) { res.status(404).end('not found'); return; }
    const blobs = await all();
    let hit;
    if (f === 'latest.yml') hit = blobs.filter((x) => /^minar2-update\/latest-\d+\.\d+\.\d+\.yml$/.test(x.pathname)).sort((x, y) => newer(verOf(y.pathname), verOf(x.pathname)))[0];
    else hit = blobs.find((x) => x.pathname === PREFIX + f);
    if (!hit) { res.status(404).end('not found'); return; }
    if (f.endsWith('.yml')) {
      const r = await fetch(hit.url, { cache: 'no-store' });
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.status(200).end(await r.text());
      return;
    }
    if (res.writeHead) res.writeHead(302, { Location: hit.url }); else res.status(302).setHeader('Location', hit.url);
    res.end();
  } catch (e) {
    res.status(500).end('error');
  }
};
