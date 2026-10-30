/* Stand-alone 3D file (user, 29 Oct 2026: «send the 3D to others, open it on a phone or a computer»). One .html file with
 * the same WebGL viewer as Minar's 3D window (viewer3d.js, embedded) and the scene, quantised to 16 bits per coordinate
 * inside the scene box (< 1.5 mm on a 97 m plan) and gzip-compressed. It opens in any current browser — phone (Telegram ->
 * open in Chrome / Safari) or computer — without internet or installation. Two levels: full detail and a light mesh
 * (viewer3d lite), the light one first on touch screens to save phone memory. Normals are recomputed per triangle (the
 * shader lights both sides alike). Needs DecompressionStream (Chrome 80+, Safari 16.4+, Firefox 113+). */
(function(root){
 'use strict';
 const V=()=>root.MinarViewer3D||(typeof require==='function'?require('./viewer3d.js'):null);
 // positions as uint16 in the box, one palette index per triangle (triangles) / none (lines)
 function pack(scene){
  const lo=scene.lo,rng=scene.hi.map((v,i)=>Math.max(1,v-lo[i])),palette=[],key=new Map(),parts=[],info={};
  const q=(F,stride,name,colours)=>{const n=F.length/stride,pos=new Uint16Array(n*3),col=colours?new Uint8Array(n/3):null;
   for(let i=0;i<n;i++)for(let k=0;k<3;k++)pos[i*3+k]=Math.max(0,Math.min(65535,Math.round((F[i*stride+k]-lo[k])/rng[k]*65535)));
   if(col)for(let t=0;t<n/3;t++){const o=t*3*stride+6,c=[F[o],F[o+1],F[o+2]].map(v=>Math.round(v*1000)/1000),k=c.join();if(!key.has(k)){key.set(k,palette.length);palette.push(c);}col[t]=key.get(k);}
   info[name]=n;parts.push(new Uint8Array(pos.buffer));if(col)parts.push(col);};
  q(scene.triangles,9,'triangles',true);q(scene.concrete,9,'concrete',true);q(scene.edges,3,'edges',false);
  const size=parts.reduce((s,p)=>s+p.length+(p.length%2),0),bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length+(p.length%2);}
  // width labels as they are (a few hundred short entries)
  const labels=(scene.labels||[]).map(([x,y,z,ux,uy,text,room])=>[Math.round(x),Math.round(y),Math.round(z),+ux.toFixed(4),+uy.toFixed(4),text,Math.round(room)]);
  return{meta:{lo,rng,palette,...info,labels},bytes};
 }
 async function gzip(bytes){
  if(typeof CompressionStream!=='undefined'){const s=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));return new Uint8Array(await new Response(s).arrayBuffer());}
  return new Uint8Array(require('zlib').gzipSync(bytes,{level:9}));
 }
 function base64(bytes){if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(s);}
 const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
 // Both levels of a layout: {full:{meta,data}, lite:{meta,data}} with data = gzip bytes as base64; null without formwork.
 async function levels(project,result,opts={}){
  const viewer=V(),out={};
  for(const [name,lite] of [['full',false],['lite',true]]){const scene=viewer.build(project,result,{floor:opts.floor,lite});if(!scene)return null;const p=pack(scene);out[name]={meta:p.meta,data:base64(await gzip(p.bytes))};}
  return out;
 }
 // The stand-alone file: page() with the levels inside. opts: floor, name, lang, text (labels in the UI language).
 async function html(project,result,opts={}){
  const lv=await levels(project,result,opts);if(!lv)return null;
  return page({...opts,viewerSource:V().factory.toString()},'const LEVELS='+JSON.stringify(lv)+';async function levelBytes(n){const L=LEVELS[n];return{meta:L.meta,gz:Uint8Array.from(atob(L.data),c=>c.charCodeAt(0))};}');
 }
 // The viewer page. loader: a script defining async levelBytes(name) -> {meta, gz: Uint8Array}; inline above, or the shared
 // link's parts fetched from the server (minar-upload-server api/view3d uses this same page()). opts.viewerSource: the
 // source text of viewer3d.js's module function.
 function page(opts,loader){
  // «open in the browser» texts by language: kept here (not in opts.text) so links made before them get them too
  const ext=opts.lang==='uz'?{inApp:'Telegram ichida aylantirish qiyin — brauzerda oching:',safari:'Safari’da ochish',chrome:'Chrome’da ochish'}
   :{inApp:'Внутри Telegram вращать неудобно — откройте в браузере:',safari:'Открыть в Safari',chrome:'Открыть в Chrome'};
  const t={title:'3D вид опалубки',concrete:'Бетон',loading:'Загрузка 3D…',hint:'Вращать — один палец · Масштаб — два пальца · Сброс — двойное касание',noscript:'Это окно просмотра не запускает 3D. Откройте файл в браузере (Chrome / Safari).',...ext,...opts.text};
  const source='('+opts.viewerSource+')(globalThis);';
  // Simple screen (user, 29 Oct 2026: «too many things»): the 3D, a title, one «Бетон» switch and a hint that fades.
  // Double tap / double click resets the view. Full detail first; the light mesh when the full one cannot be shown or the
  // device reports little memory. The text first shown in #msg stays when the viewer window runs no scripts.
  return `<!doctype html><html lang="${esc(opts.lang||'ru')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><title>${esc(opts.name||t.title)}</title>
<style>html,body{margin:0;height:100%;background:#eef1f4;font:15px -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1f2937;overflow:hidden;overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}body{position:fixed;inset:0}
#open[hidden]{display:none}#open{position:fixed;left:50%;transform:translateX(-50%);top:calc(max(12px,env(safe-area-inset-top)) + 52px);z-index:4;background:#fff;box-shadow:0 2px 12px #0003;border-radius:14px;padding:10px 28px;width:max-content;max-width:92vw;text-align:center;font-size:13px}
#open a{display:inline-block;margin:8px 4px 0;padding:9px 14px;border-radius:18px;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600}#open a.alt{background:#1f2937}#open button{position:absolute;right:4px;top:2px;border:0;background:none;font-size:18px;color:#6b7280;padding:4px 8px}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block;outline:none}
#head{position:fixed;left:max(12px,env(safe-area-inset-left));top:max(12px,env(safe-area-inset-top));right:110px;z-index:2;pointer-events:none}
#head b{display:block;font-size:17px}#head small{display:block;color:#6b7280;font-size:13px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#concrete{position:fixed;right:max(12px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));z-index:2;font:inherit;border:0;border-radius:20px;padding:9px 16px;background:#fff;box-shadow:0 1px 6px #0003;color:#1f2937}
#concrete.on{background:#1f2937;color:#fff}
#hint{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2;background:#1f2937e0;color:#fff;font-size:13px;padding:8px 14px;border-radius:18px;width:max-content;max-width:86vw;text-align:center;line-height:1.35;transition:opacity .6s;pointer-events:none}
#hint.gone{opacity:0}#msg[hidden]{display:none}#msg{position:fixed;inset:0;display:grid;place-items:center;text-align:center;padding:24px;font-size:16px;z-index:3;background:#eef1f4}</style></head>
<body><canvas id="c" tabindex="0"></canvas><div id="head"><b>${esc(t.title)}</b><small>${esc(opts.name||'')}</small></div><button id="concrete" class="on">${esc(t.concrete)}</button><div id="hint">${esc(t.hint)}</div><div id="open" hidden><button type="button" aria-label="×">×</button><div>${esc(t.inApp)}</div><a id="openSafari" href="#">${esc(t.safari)}</a><a id="openChrome" class="alt" href="#">${esc(t.chrome)}</a></div><div id="msg">${esc(t.noscript)}</div>
<script>document.getElementById('msg').textContent=${JSON.stringify(t.loading)};</script>
<script>${source.replace(/<\/script/gi,'<\\/script')}</script>
<script>${loader.replace(/<\/script/gi,'<\\/script')}
// gzip reader for browsers without DecompressionStream (a small DEFLATE decoder)
function gunzip(src){let p=10;const fl=src[3];if(fl&4)p+=2+(src[10]|src[11]<<8);if(fl&8)while(src[p++]);if(fl&16)while(src[p++]);if(fl&2)p+=2;
 let bit=0,cnt=0,out=new Uint8Array(src.length*5),o=0;const grow=n=>{if(o+n>out.length){const t=new Uint8Array(Math.max(out.length*2,o+n));t.set(out);out=t;}};
 const bits=n=>{while(cnt<n){bit|=src[p++]<<cnt;cnt+=8;}const v=bit&((1<<n)-1);bit>>>=n;cnt-=n;return v;};
 const build=len=>{const c=new Uint16Array(16),off=new Uint16Array(16),s=new Uint16Array(len.length);for(const l of len)c[l]++;c[0]=0;for(let i=1;i<16;i++)off[i]=off[i-1]+c[i-1];for(let i=0;i<len.length;i++)if(len[i])s[off[len[i]]++]=i;return{c,s};};
 const dec=h=>{let code=0,first=0,idx=0;for(let l=1;l<16;l++){code|=bits(1);const n=h.c[l];if(code-n<first)return h.s[idx+code-first];idx+=n;first=(first+n)<<1;code<<=1;}throw Error('gzip');};
 const LB=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258],LE=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],DB=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577],DE=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
 let last;do{last=bits(1);const type=bits(2);
  if(type===0){bit=0;cnt=0;const n=src[p]|src[p+1]<<8;p+=4;grow(n);out.set(src.subarray(p,p+n),o);o+=n;p+=n;continue;}
  let L,D;if(type===1){const l=new Uint8Array(288);l.fill(8,0,144);l.fill(9,144,256);l.fill(7,256,280);l.fill(8,280,288);L=build(l);D=build(new Uint8Array(30).fill(5));}
  else{const nl=bits(5)+257,nd=bits(5)+1,nc=bits(4)+4,ord=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],cl=new Uint8Array(19);for(let i=0;i<nc;i++)cl[ord[i]]=bits(3);const C=build(cl),len=new Uint8Array(nl+nd);
   for(let i=0;i<nl+nd;){const s=dec(C);if(s<16){len[i++]=s;continue;}let v=0,r;if(s===16){v=len[i-1];r=3+bits(2);}else if(s===17)r=3+bits(3);else r=11+bits(7);while(r--)len[i++]=v;}
   L=build(len.subarray(0,nl));D=build(len.subarray(nl));}
  for(;;){let s=dec(L);if(s<256){grow(1);out[o++]=s;continue;}if(s===256)break;s-=257;const n=LB[s]+bits(LE[s]),ds=dec(D),d=DB[ds]+bits(DE[ds]);grow(n);for(let k=0;k<n;k++,o++)out[o]=out[o-d];}
 }while(!last);return out.subarray(0,o);}
async function unpack(L){const m=L.meta,b=L.gz;let u;
 if(typeof DecompressionStream!=='undefined'){const s=new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));u=new Uint8Array(await new Response(s).arrayBuffer());}else u=gunzip(b).slice();let at=0;
 const take=(n,T)=>{const out=new T(u.buffer,at,n);at+=n*T.BYTES_PER_ELEMENT;at+=at%2;return out;},pos=n=>{const q=take(n*3,Uint16Array),f=new Float32Array(n*3);for(let i=0;i<n*3;i++)f[i]=m.lo[i%3]+q[i]/65535*m.rng[i%3];return f;};
 const tris=n=>{const p=pos(n),c=take(n/3,Uint8Array),f=new Float32Array(n*9);for(let t=0;t<n/3;t++){const o=t*9,ax=p[o+3]-p[o],ay=p[o+4]-p[o+1],az=p[o+5]-p[o+2],bx=p[o+6]-p[o],by=p[o+7]-p[o+1],bz=p[o+8]-p[o+2];let nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;const col=m.palette[c[t]];
  for(let v=0;v<3;v++){const d=(t*3+v)*9,s=(t*3+v)*3;f[d]=p[s];f[d+1]=p[s+1];f[d+2]=p[s+2];f[d+3]=nx;f[d+4]=ny;f[d+5]=nz;f[d+6]=col[0];f[d+7]=col[1];f[d+8]=col[2];}}return f;};
 const triangles=tris(m.triangles),concrete=tris(m.concrete),edges=pos(m.edges);return{triangles,concrete,edges,labels:m.labels||[],lo:m.lo,hi:m.lo.map((v,i)=>v+m.rng[i])};}
const $=id=>document.getElementById(id);let viewer=null,concreteOn=true;
async function show(name){const scene=await unpack(await levelBytes(name));viewer=MinarViewer3D.open($('c'),scene,{});viewer.setConcrete(concreteOn);}
(async()=>{try{if(navigator.deviceMemory&&navigator.deviceMemory<4)throw 0;await show('full');}catch(e){try{viewer&&viewer.destroy();viewer=null;await show('lite');}catch(e2){$('msg').textContent=String(e2&&e2.message||e2);return;}}$('msg').hidden=true;})();
$('concrete').onclick=()=>{concreteOn=!concreteOn;$('concrete').classList.toggle('on',concreteOn);viewer&&viewer.setConcrete(concreteOn);};
let tap=0;const reset=()=>viewer&&viewer.reset();$('c').addEventListener('dblclick',reset);$('c').addEventListener('touchend',e=>{if(e.touches.length)return;const n=Date.now();if(n-tap<300){reset();tap=0;}else tap=n;});
const fade=()=>$('hint').classList.add('gone');setTimeout(fade,6000);$('c').addEventListener('pointerdown',()=>setTimeout(fade,1500),{once:true});
// Inside Telegram's own browser (user, 31 Oct 2026, iPhone: a sideways swipe leaves the page, a downward one closes it) the page
// keeps every finger move to itself and offers the real browser: Safari (x-safari-https, iOS 17+), Chrome (googlechromes / an
// Android intent). On iOS any web view that is not Safari itself counts (Telegram's UA may look like Safari's).
document.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});$('c').addEventListener('touchstart',e=>e.preventDefault(),{passive:false});
(()=>{const ua=navigator.userAgent,ios=/iPhone|iPad|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),android=/Android/.test(ua);
 const inApp=!!window.TelegramWebviewProxy||/Telegram|FBAN|FBAV|Instagram|Line\\/|WhatsApp|; wv\\)/i.test(ua)||(ios&&(!/Safari\\//.test(ua)||navigator.standalone===undefined)&&!/CriOS|FxiOS|EdgiOS/.test(ua));
 if(!inApp||!(ios||android))return;const u=location.href,rest=u.replace(/^https?:\\/\\//,'');
 $('openSafari').href='x-safari-'+u;$('openChrome').href=android?'intent://'+rest+'#Intent;scheme=https;package=com.android.chrome;end':'googlechromes://'+rest;
 if(android)$('openSafari').style.display='none';$('open').hidden=false;$('open').querySelector('button').onclick=()=>{$('open').hidden=true;};
 // user, 31 Oct 2026: «from Telegram straight into Safari / Chrome» — try it at once (Safari on iOS, Chrome on Android); the
 // buttons stay for a web view that refuses a jump without a tap
 setTimeout(()=>{location.href=android?$('openChrome').href:$('openSafari').href;},150);})();</script></body></html>`;
 }
 root.MinarShare3D={html,levels,page,pack};
 if(typeof module!=='undefined')module.exports=root.MinarShare3D;
})(globalThis);
