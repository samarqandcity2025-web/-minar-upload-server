'use strict';
// Opens a document QR link: GET /d/<token>.<sig> (rewritten to ?k=) gives a phone-friendly page — MINAR header, «Haqiqiy
// hujjat / Подлинный документ», file name, export date, who exported it — and the document itself: the specification rows as a
// table (Excel) or the drawing page (PDF), plus «Yuklab olish / Скачать» for the original file. GET ?p=<id>.<sig> gives one
// part of the file from Telegram. A stored document never changes, so both are cached by the CDN; a token that is not
// uploaded yet (the computer was offline at export) answers 404 without caching.
const store = require('../lib/tg-store');
const docs = require('../lib/doc-store');

const split = (k) => { const s = String(k || ''), i = s.lastIndexOf('.'); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, '']; };
const forever = (res) => res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v) => (typeof v === 'number' ? v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : esc(v));
const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
function when(iso) {
  try { return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return String(iso || ''); }
}

const STYLE = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:#ecebe7;color:#1f1f22;font:15px/1.45 -apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:16px}.card{background:#fff;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.brand{font-weight:800;letter-spacing:.12em;color:#e5432a;font-size:22px}.ok{display:inline-flex;gap:8px;align-items:center;margin-top:10px;padding:6px 12px;border-radius:999px;background:#e6f4ea;color:#1e6b34;font-weight:700}
.ok.wait{background:#fff4e0;color:#8a5a00}.lead{margin:10px 0 0;color:#55555c;font-size:13px}dl{margin:14px 0 0}dt{color:#77777e;font-size:12px;margin-top:8px}dd{margin:0;word-break:break-word;font-weight:600}
.btn{display:block;width:100%;margin-top:14px;padding:13px;border:0;border-radius:10px;background:#e5432a;color:#fff;font:inherit;font-weight:700;text-align:center;cursor:pointer}.btn[disabled]{opacity:.6}
.msg{margin-top:8px;font-size:13px;color:#55555c;min-height:1em}.check{font-size:13px;margin-top:8px;color:#1e6b34}.check.bad{color:#b3261e}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}table{border-collapse:collapse;width:100%;font-size:13px;background:#fff}th,td{border:1px solid #000;padding:4px 6px;vertical-align:middle}
th{background:#ffff00;font-weight:700}td.sec{background:#ddebf7;text-align:center;font-weight:700}td.n,td.u{text-align:center}td.q{text-align:right;white-space:nowrap}
.page{width:100%;height:auto;display:block;border:1px solid #d6d4cf;background:#fff}.zoom{overflow:auto;-webkit-overflow-scrolling:touch;max-height:80vh;border-radius:8px}
iframe{width:100%;height:80vh;border:1px solid #d6d4cf}.hint{font-size:12px;color:#77777e;margin-top:6px}footer{text-align:center;color:#8a8a90;font-size:12px;padding:8px 0 24px}`;

function page(m, parts) {
  const hasFile = Array.isArray(parts) && parts.length > 0;
  const head = `<div class="brand">MINAR${m.app === 'minar-2' ? ' 2' : ''}</div>
<div class="ok">✔ Haqiqiy hujjat · Подлинный документ</div>
<p class="lead">Bu hujjat Minar${m.app === 'minar-2' ? ' 2' : ''} dasturida eksport qilingan va kompaniya serverida saqlangan. Qog‘ozdagi nusxani shu yerdagi bilan solishtiring.<br>
Этот документ экспортирован из программы Minar${m.app === 'minar-2' ? ' 2' : ''} и хранится на сервере компании. Сравните бумажный экземпляр с этой электронной версией.</p>
<dl><dt>Fayl / Файл</dt><dd>${esc(m.name)}</dd><dt>Sana / Дата</dt><dd>${esc(when(m.exportedAt))}</dd>
${m.who ? `<dt>Eksport qildi / Экспортировал</dt><dd>${esc(m.who)}</dd>` : ''}${hasFile ? `<dt>Hajmi / Размер</dt><dd>${size(m.size)}</dd>
<dt>SHA-256</dt><dd style="font:12px monospace;font-weight:400">${esc(String(m.sha256).slice(0, 16))}…</dd>` : ''}</dl>
${hasFile ? `<button class="btn" id="dl">⤓ Yuklab olish · Скачать (${m.kind === 'pdf' ? 'PDF' : 'Excel'})</button>${m.app === 'minar-2' && m.kind === 'xlsx' ? '<div class="hint">Excel fayli parol bilan himoyalangan · Файл Excel защищён паролем</div>' : ''}` : ''}<div class="msg" id="msg"></div><div class="check" id="check" hidden></div>`;
  let body = '';
  if (Array.isArray(m.cols) && m.cols.length && Array.isArray(m.rows)) {
    // Minar 2 commercial offer: its own columns; a one-cell row is a block title, «Итого…» rows bold.
    const n = m.cols.length;
    body = `<div class="card">${m.section ? `<div style="font-weight:700;margin-bottom:10px">${esc(m.section)}</div>` : ''}<div class="scroll"><table><thead><tr>${m.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
${m.rows.map((r) => (r.length === 1 ? `<tr><td class="sec" colspan="${n}">${esc(r[0])}</td></tr>` : `<tr${/^(Итого|Все итого)/.test(String(r[1] || '')) ? ' style="font-weight:700;background:#f4f4f2"' : ''}>${r.slice(0, n).map((c, i) => `<td class="${i === 1 ? '' : typeof c === 'number' ? 'q' : 'u'}">${num(c)}</td>`).join('')}</tr>`)).join('')}
</tbody></table></div></div>`;
  } else if (m.kind === 'xlsx' && Array.isArray(m.rows)) {
    const rows = m.rows.slice(m.rows[0] && m.rows[0][0] === '№' ? 1 : 0);
    body = `<div class="card"><div class="scroll"><table><thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Ед.изм.</th></tr></thead><tbody>
${m.section ? `<tr><td class="sec" colspan="4">${esc(m.section)}</td></tr>` : ''}${rows.map((r) => `<tr><td class="n">${num(r[0])}</td><td>${esc(r[1])}</td><td class="q">${num(r[2])}</td><td class="u">${esc(r[3])}</td></tr>`).join('')}
</tbody></table></div></div>`;
  } else if (m.kind === 'pdf' && hasFile) {
    body = `<div class="card" id="view"><div class="msg">Hujjat yuklanmoqda… · Документ загружается…</div></div>`;
  }
  const script = `const PARTS=${JSON.stringify(parts)},NAME=${JSON.stringify(m.name)},KIND=${JSON.stringify(m.kind)},SHA=${JSON.stringify(m.sha256)};
let file=null;const $=id=>document.getElementById(id);
async function load(){if(file)return file;const bufs=await Promise.all(PARTS.map(u=>fetch(u).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.arrayBuffer();})));
const out=new Uint8Array(bufs.reduce((s,b)=>s+b.byteLength,0));let at=0;for(const b of bufs){out.set(new Uint8Array(b),at);at+=b.byteLength;}file=out;check(out);return out;}
async function check(bytes){try{const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');const c=$('check');c.hidden=false;
if(h===SHA){c.textContent='✔ Fayl o‘zgartirilmagan (SHA-256 mos) · Файл не изменён (SHA-256 совпадает)';}else{c.textContent='✖ SHA-256 mos emas · SHA-256 не совпадает';c.classList.add('bad');}}catch{}}
const type=KIND==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
if($('dl'))$('dl').onclick=async()=>{const b=$('dl');b.disabled=true;$('msg').textContent='…';try{const bytes=await load(),url=URL.createObjectURL(new Blob([bytes],{type}));
const a=document.createElement('a');a.href=url;a.download=NAME;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);$('msg').textContent='';}
catch(e){$('msg').textContent='Xatolik · Ошибка: '+e.message;}finally{b.disabled=false;}};
// Minar's PDF is one page holding one JPEG: show that picture (phones do not show a PDF inside a page); any other PDF in a frame.
function jpegOf(bytes){const s=new TextDecoder('latin1').decode(bytes.subarray(0,Math.min(bytes.length,4096)));if(!/\\/Filter \\/DCTDecode/.test(s))return null;
const m=/\\/DCTDecode \\/Length (\\d+) >>\\nstream\\n/.exec(new TextDecoder('latin1').decode(bytes.subarray(0,Math.min(bytes.length,1<<20))));if(!m)return null;const at=m.index+m[0].length,len=+m[1];
return bytes[at]===0xff&&bytes[at+1]===0xd8&&at+len<=bytes.length?bytes.subarray(at,at+len):null;}
if(KIND==='pdf'&&document.getElementById('view'))load().then(bytes=>{const v=$('view'),jpg=jpegOf(bytes);
if(jpg){v.innerHTML='<div class="zoom"><img class="page" alt=""></div><div class="hint">Kattalashtirish uchun ikki barmoq bilan cho‘zing · Увеличение — двумя пальцами</div>';v.querySelector('img').src=URL.createObjectURL(new Blob([jpg],{type:'image/jpeg'}));}
else{const f=document.createElement('iframe');f.src=URL.createObjectURL(new Blob([bytes],{type}));v.innerHTML='';v.appendChild(f);}}).catch(e=>{$('view').innerHTML='<div class="msg">Xatolik · Ошибка: '+e.message+'</div>';});`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>MINAR — ${esc(m.name)}</title><style>${STYLE}</style></head>
<body><main><div class="card">${head}</div>${body}<footer>Minar © ${new Date(m.exportedAt).getFullYear() || ''}</footer></main><script>${script}</script></body></html>`;
}

function notYet(res) {
  res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MINAR</title><style>${STYLE}</style></head>
<body><main><div class="card"><div class="brand">MINAR</div><div class="ok wait">⏳ Hujjat hali yuklanmagan · Документ ещё не загружен</div>
<p class="lead">Hujjat eksport qilingan kompyuter internetga ulanganda u shu yerda paydo bo‘ladi. Keyinroq qayta skanerlang.<br>
Документ появится здесь, когда компьютер, на котором он экспортирован, подключится к интернету. Отсканируйте позже ещё раз.</p></div></main></body></html>`);
}

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
    const [token, sig] = split(q.k);
    if (!docs.valid(token, sig)) { res.status(404).setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('Hujjat topilmadi / Документ не найден'); return; }
    const m = await docs.find(token);
    if (!m) { notYet(res); return; }
    const parts = (m.parts || []).map((p) => '/api/viewdoc?p=' + encodeURIComponent(p + '.' + store.sign(p)));
    forever(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).end(page(m, parts));
  } catch (e) {
    res.status(502).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Hujjat / Документ: ' + String(e.message || e));
  }
};
