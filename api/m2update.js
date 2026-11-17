'use strict';
// Update server of the Minar 2 program (user, 17 Nov 2026: automatic update). The program asks /m2-update/latest.yml, then the
// installer named in it (electron-updater, generic provider). The files sit in Vercel Blob under minar2-update/ (put there by
// minar2-windows/publish-update.cjs). latest.yml is passed on fresh every time; the installer and blockmap are redirected to Blob.
module.exports = async (req, res) => {
  const f = String((req.query && req.query.f) || '');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(f)) { res.status(404).end('not found'); return; }
  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: 'minar2-update/' + f, limit: 10 });
    const hit = blobs.find((b) => b.pathname === 'minar2-update/' + f);
    if (!hit) { res.status(404).end('not found'); return; }
    if (f.endsWith('.yml')) {
      const r = await fetch(hit.url, { cache: 'no-store' });
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).end(await r.text());
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead ? res.writeHead(302, { Location: hit.url }) : res.status(302).setHeader('Location', hit.url);
    res.end();
  } catch (e) {
    res.status(500).end('error');
  }
};
