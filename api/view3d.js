'use strict';
// Opens a shared 3D link: GET /3d/<id>.<sig> (rewritten to ?k=) gives the viewer page — the same page as the app's
// stand-alone 3D file (lib/minar/share3d.js page()) with a loader that fetches the parts; GET ?p=<id>.<sig> gives one
// part. Both come from Telegram through lib/tg-store and are cached by the CDN (a link never changes).
const store = require('../lib/tg-store');
const share = require('../lib/minar/share3d.js');
const viewer = require('../lib/minar/viewer3d.js');

const split = (k) => { const s = String(k || ''), i = s.lastIndexOf('.'); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, '']; };
const forever = (res) => res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');

module.exports = async (req, res) => {
  const q = req.query || {};
  try {
    if (q.p) {
      const [id, sig] = split(q.p);
      if (!store.valid(id, sig)) { res.status(404).end(); return; }
      const bytes = await store.get(id);
      forever(res);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.status(200).end(bytes);
      return;
    }
    const [id, sig] = split(q.k);
    if (!id || !store.valid(id, sig)) { res.status(404).setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('3D topilmadi / 3D не найдено'); return; }
    const m = JSON.parse((await store.get(id)).toString('utf8'));
    const levels = {};
    for (const [level, L] of Object.entries(m.levels)) levels[level] = { meta: L.meta, parts: L.parts.map((p) => '/api/view3d?p=' + encodeURIComponent(p + '.' + store.sign(p))) };
    const loader = 'const LEVELS=' + JSON.stringify(levels) + ';async function levelBytes(n){const L=LEVELS[n];'
      + 'const bufs=await Promise.all(L.parts.map(u=>fetch(u).then(r=>{if(!r.ok)throw Error("3D "+r.status);return r.arrayBuffer();})));'
      + 'const gz=new Uint8Array(bufs.reduce((s,b)=>s+b.byteLength,0));let at=0;for(const b of bufs){gz.set(new Uint8Array(b),at);at+=b.byteLength;}return{meta:L.meta,gz};}';
    const html = share.page({ name: m.name, lang: m.lang, text: m.text, viewerSource: viewer.factory.toString() }, loader);
    forever(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).end(html);
  } catch (e) {
    res.status(502).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('3D: ' + String(e.message || e));
  }
};
