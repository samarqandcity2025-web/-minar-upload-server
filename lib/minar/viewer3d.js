/* 3D view of the placed formwork (WebGL, no external libraries, works offline).
 * Look follows the user's SketchUp model "apalobka3dd.skp": red steel frame with
 * horizontal ribs on a dark plywood face, grey concrete, tie rods with clamps.
 * Units are millimetres; the scene is centred so float32 stays precise. */
(function minarViewer3D(root){
 'use strict';
 let H=3000;const GAP=4,PLY=18,DEPTH=120,RAIL=60,RIB=40,RIB_STEP=300;
 const COLOR={plywood:[.24,.16,.11],frame:[.80,.09,.09],rib:[.64,.06,.06],concrete:[.80,.82,.83],tie:[.55,.57,.60],clamp:[.18,.2,.22],washer:[.82,.84,.86],stripping:[.84,0,.56],strippingRib:[.68,0,.45],spine:[.50,0,.34],brusok:[.85,.35,.1]};

 // ---- geometry -------------------------------------------------------------------------
 function sceneBuilder(origin){
  const tri=[],edges=[],groups=[];let active=null;
  const group=(kind,floor)=>{if(active)active.end=tri.length;active={kind,floor,start:tri.length,end:tri.length};groups.push(active);};let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  const P=(x,y,z)=>{const p=[x-origin.x,y-origin.y,z];for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}return p;};
  // Oriented box: base point b, axes u (along), n (outward), heights z0..z1; extents a0..a1 along u, d0..d1 along n.
  function box(b,u,n,a0,a1,d0,d1,z0,z1,color,withEdges=true){
   if(a1-a0<=0||d1-d0<=0||z1-z0<=0)return;
   const c=[];for(const z of [z0,z1])for(const [a,d]of [[a0,d0],[a1,d0],[a1,d1],[a0,d1]])c.push(P(b.x+u.x*a+n.x*d,b.y+u.y*a+n.y*d,z));
   const quad=(i,j,k,l)=>{const A=c[i],B=c[j],C=c[k],D=c[l],e1=B.map((v,q)=>v-A[q]),e2=C.map((v,q)=>v-A[q]);let nx=e1[1]*e2[2]-e1[2]*e2[1],ny=e1[2]*e2[0]-e1[0]*e2[2],nz=e1[0]*e2[1]-e1[1]*e2[0];const L=Math.hypot(nx,ny,nz)||1;nx/=L;ny/=L;nz/=L;for(const V of [A,B,C,A,C,D])tri.push(...V,nx,ny,nz,...color);};
   quad(0,3,2,1);quad(4,5,6,7);quad(0,1,5,4);quad(1,2,6,5);quad(2,3,7,6);quad(3,0,4,7);
   if(withEdges)for(const [i,j]of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]])edges.push(...c[i],...c[j]);
  }
  // Extrude a plan polyline vertically (z0..z1) into a thin wall: used for the clamp shape.
  function ribbon(points,closed,z0,z1,color){const pts=closed?[...points,points[0]]:points;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],L=Math.hypot(b.x-a.x,b.y-a.y);if(L<.5)continue;const nx=-(b.y-a.y)/L,ny=(b.x-a.x)/L,A=P(a.x,a.y,z0),B=P(b.x,b.y,z0),C=P(b.x,b.y,z1),D=P(a.x,a.y,z1);for(const V of [A,B,C,A,C,D])tri.push(...V,nx,ny,0,...color);}}
  function cylinder(b,u,n,a0,a1,d,z,r,color,sides=12){
   const ring=a=>Array.from({length:sides},(_,i)=>{const angle=i*2*Math.PI/sides;return P(b.x+u.x*a+n.x*(d+Math.cos(angle)*r),b.y+u.y*a+n.y*(d+Math.cos(angle)*r),z+Math.sin(angle)*r);});
   const A=ring(a0),B=ring(a1),ca=P(b.x+u.x*a0+n.x*d,b.y+u.y*a0+n.y*d,z),cb=P(b.x+u.x*a1+n.x*d,b.y+u.y*a1+n.y*d,z);
   const face=(points,normal)=>{for(const q of points)tri.push(...q,...normal,...color);};
   for(let i=0;i<sides;i++){const j=(i+1)%sides,theta=(i+.5)*2*Math.PI/sides,normal=[n.x*Math.cos(theta),n.y*Math.cos(theta),Math.sin(theta)];face([A[i],A[j],B[j],A[i],B[j],B[i]],normal);face([ca,A[j],A[i]],[-u.x,-u.y,0]);face([cb,B[i],B[j]],[u.x,u.y,0]);}
  }
  // Closed extrusion of a concave a/z outline, with edges only on its boundary.
  function profile(b,u,n,outline,d0,d1,z,color,horizontal=false){
   let pts=outline.slice();const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
   if(pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+p[0]*q[1]-q[0]*p[1];},0)<0)pts.reverse();
   const vertex=([a,h],depth)=>horizontal?P(b.x+u.x*a+n.x*h,b.y+u.y*a+n.y*h,z+depth):P(b.x+u.x*a+n.x*depth,b.y+u.y*a+n.y*depth,z+h);
   const A=pts.map(p=>vertex(p,d0)),B=pts.map(p=>vertex(p,d1));
   const face=(points,normal)=>{for(const q of points)tri.push(...q,...normal,...color);};
   const indices=pts.map((_,i)=>i);let guard=0;
   while(indices.length>2&&guard++<pts.length*pts.length){let cut=false;for(let k=0;k<indices.length;k++){const i=indices[(k+indices.length-1)%indices.length],j=indices[k],l=indices[(k+1)%indices.length];if(cross(pts[i],pts[j],pts[l])<=0)continue;
    if(indices.some(t=>t!==i&&t!==j&&t!==l&&cross(pts[i],pts[j],pts[t])>=0&&cross(pts[j],pts[l],pts[t])>=0&&cross(pts[l],pts[i],pts[t])>=0))continue;
    face([A[i],A[j],A[l]],horizontal?[0,0,-1]:[-n.x,-n.y,0]);face([B[l],B[j],B[i]],horizontal?[0,0,1]:[n.x,n.y,0]);indices.splice(k,1);cut=true;break;}if(!cut)break;}
   for(let i=0;i<pts.length;i++){const j=(i+1)%pts.length,da=pts[j][0]-pts[i][0],dh=pts[j][1]-pts[i][1],len=Math.hypot(da,dh);face([A[i],B[i],B[j],A[i],B[j],A[j]],horizontal?[(u.x*dh-n.x*da)/len,(u.y*dh-n.y*da)/len,0]:[u.x*dh/len,u.y*dh/len,-da/len]);edges.push(...A[i],...A[j],...B[i],...B[j],...A[i],...B[i]);}
  }
  return{box,ribbon,cylinder,profile,group,result:()=>{if(active)active.end=tri.length;return{groups,triangles:new Float32Array(tri),edges:new Float32Array(edges),lo,hi};}};
 }
 // One formwork panel on a face segment (from -> to), frame on the outward side.
 // Convex frame junctions: two perpendicular panels end at one point and each runs away from
 // the other's frame side (outer L corner). Their frames leave a DEPTH x DEPTH open square.
 function convexCorners(result){
  const segs=[],out=[],seen=new Set();
  const add=(from,to,side,floor)=>{const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy);if(len<1)return;const u={x:dx/len,y:dy/len};segs.push({from,to,u,n:{x:-u.y*side,y:u.x*side},floor});};
  for(const e of result.elements)if(e.kind==='panel')add(e.from,e.to,e.frameSide??e.side,e.floor);
  for(const c of result.corners||[])for(const l of c.legs)add(l.from,l.to,l.side,c.floor);
  const ends=s=>[{p:s.from,dir:s.u},{p:s.to,dir:{x:-s.u.x,y:-s.u.y}}];
  for(let i=0;i<segs.length;i++)for(let j=i+1;j<segs.length;j++){
   const a=segs[i],b=segs[j];if(a.floor!==b.floor||Math.abs(a.u.x*b.u.x+a.u.y*b.u.y)>1e-3)continue;
   for(const ea of ends(a))for(const eb of ends(b)){
    if(Math.hypot(ea.p.x-eb.p.x,ea.p.y-eb.p.y)>2)continue;
    // Each panel runs from the vertex opposite to the other's frame normal.
    if(ea.dir.x*b.n.x+ea.dir.y*b.n.y>-.999||eb.dir.x*a.n.x+eb.dir.y*a.n.y>-.999)continue;
    const key=a.floor+':'+Math.round(ea.p.x)+':'+Math.round(ea.p.y);if(seen.has(key))continue;seen.add(key);
    out.push({vertex:ea.p,na:a.n,nb:b.n,ua:ea.dir,ub:eb.dir,floor:a.floor});
   }
  }
  return out;
 }
 function panel(S,from,to,side,z0,opts={}){
  const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy);if(len<1)return;
  const u={x:dx/len,y:dy/len},n={x:-u.y*side,y:u.x*side},z1=z0+H,frame=opts.color||COLOR.frame,rib=opts.rib||COLOR.rib;
  S.box(from,u,n,0,len,0,PLY,z0,z1,COLOR.plywood,false);
  // Perimeter profiles (vertical edges and top/bottom rails).
  const rail=Math.min(RAIL,len/2);
  S.box(from,u,n,0,rail,PLY,DEPTH,z0,z1,frame);S.box(from,u,n,len-rail,len,PLY,DEPTH,z0,z1,frame);
  S.box(from,u,n,rail,len-rail,PLY,DEPTH,z0,z0+RAIL,frame);S.box(from,u,n,rail,len-rail,PLY,DEPTH,z1-RAIL,z1,frame);
  // Horizontal ribs every 300 mm and a middle vertical rib on wide panels (not in the light DXF mesh).
  if(opts.lite)return;
  for(let z=z0+RIB_STEP;z<z1-RAIL;z+=RIB_STEP)S.box(from,u,n,rail,len-rail,PLY,DEPTH-25,z-RIB/2,z+RIB/2,rib,false);
  if(len>=900)S.box(from,u,n,len/2-RAIL/2,len/2+RAIL/2,PLY,DEPTH-25,z0+RAIL,z1-RAIL,rib,false);
 }
 // ЩУР stripping corner as in the user's photo (22 Oct 2026): two framed leaves hinged to a
 // chamfered stripping spine at the inner vertex, silver wedge clamps joining each leaf to the
 // spine at four heights and the stripping screw on top. Visual only; returns false when the
 // legs are not a concave pair (the ordinary L frame is drawn instead).
 function strippingCorner(S,c,z0,lite){
  const v=c.vertex;if(!v||c.legs.length!==2)return false;
  const far=l=>Math.hypot(l.from.x-v.x,l.from.y-v.y)>Math.hypot(l.to.x-v.x,l.to.y-v.y)?l.from:l.to;
  const [pa,pb]=c.legs.map(far),unit=p=>{const d=Math.hypot(p.x-v.x,p.y-v.y)||1;return{x:(p.x-v.x)/d,y:(p.y-v.y)/d,len:d};},ua=unit(pa),ub=unit(pb);
  // Concave corner: each leaf's frame points along the other leg.
  const legSide=(l,u)=>{const d=Math.hypot(l.to.x-l.from.x,l.to.y-l.from.y)||1,dir={x:(l.to.x-l.from.x)/d,y:(l.to.y-l.from.y)/d};return{x:-dir.y*l.side,y:dir.x*l.side};};
  const na=legSide(c.legs[0]),nb=legSide(c.legs[1]);if(na.x*ub.x+na.y*ub.y<.9||nb.x*ua.x+nb.y*ua.y<.9||ua.len<=DEPTH+60||ub.len<=DEPTH+60)return false;
  const z1=z0+H,side=(p,q)=>Math.sign(p.x*q.y-p.y*q.x)||1,at=(u,a)=>({x:v.x+u.x*a,y:v.y+u.y*a});
  const leaf={lite,color:COLOR.stripping,rib:COLOR.strippingRib};panel(S,at(ua,DEPTH),pa,side(ua,ub),z0,leaf);panel(S,at(ub,DEPTH),pb,side(ub,ua),z0,leaf);
  // Plywood across the spine and the chamfered spine itself (plan: a along ua, h along ub).
  S.box(v,ua,ub,0,DEPTH,0,PLY,z0,z1,COLOR.plywood,false);S.box(v,ua,ub,0,PLY,PLY,DEPTH,z0,z1,COLOR.plywood,false);
  const G=50;S.profile(v,ua,ub,[[PLY,PLY],[DEPTH,PLY],[DEPTH,G],[G,DEPTH],[PLY,DEPTH]],z0,z1,0,COLOR.spine,true);
  if(lite)return true;
  // Product photo 1:1 (user, 24 Oct 2026): the top and bottom cell of each leaf is split by a short
  // vertical rib.
  const lastRib=z0+Math.floor((H-RAIL-1)/RIB_STEP)*RIB_STEP;
  for(const [u,n] of [[ua,ub],[ub,ua]]){const len=u.len-DEPTH,from=at(u,DEPTH);
   S.box(from,u,n,len/2-RIB/2,len/2+RIB/2,PLY,DEPTH-25,z0+RAIL,z0+RIB_STEP-RIB/2,COLOR.strippingRib,false);
   S.box(from,u,n,len/2-RIB/2,len/2+RIB/2,PLY,DEPTH-25,lastRib+RIB/2,z1-RAIL,COLOR.strippingRib,false);}
  // Spine face (the chamfer): a dark slot down the middle with silver pin heads every 450 mm.
  const t={x:(ua.x-ub.x)/Math.SQRT2,y:(ua.y-ub.y)/Math.SQRT2},w={x:(ua.x+ub.x)/Math.SQRT2,y:(ua.y+ub.y)/Math.SQRT2},face=(DEPTH+G)/Math.SQRT2;
  S.box(v,t,w,-9,9,face-2,face+1,z0+70,z1-70,COLOR.clamp,false);
  for(let z=z0+300;z<z1-200;z+=450){S.box(v,t,w,-16,16,face,face+8,z-16,z+16,COLOR.washer);S.box(v,t,w,-8,8,face+8,face+16,z-8,z+8,COLOR.washer);}
  // Wedge clamps, a left/right pair at three heights: a bar from the spine over the leaf's end rail,
  // the knob at its outer end and the wedge hanging down through it (silver, as in the photo).
  for(const zz of [450,1650,2700])for(const [u,n] of [[ua,ub],[ub,ua]]){const z=z0+zz,s=COLOR.washer;
   S.box(v,u,n,G-5,DEPTH+115,DEPTH,DEPTH+14,z-22,z+22,s);
   S.box(v,u,n,G-10,G+18,DEPTH-15,DEPTH+30,z-34,z+34,s);
   S.box(v,u,n,DEPTH+90,DEPTH+128,DEPTH,DEPTH+42,z-30,z+30,s);
   S.box(v,u,n,DEPTH+50,DEPTH+72,DEPTH+14,DEPTH+36,z-150,z+40,s);
   S.box(v,u,n,DEPTH+46,DEPTH+76,DEPTH+14,DEPTH+40,z-160,z-140,s);}
  // Stripping screw on top of the spine: rod through a nut plate, square head with a red mark.
  const k=(PLY+G)/2+16;
  S.box(v,ua,ub,k-30,k+30,k-30,k+30,z1,z1+25,COLOR.washer);
  S.box(v,ua,ub,k-11,k+11,k-11,k+11,z1+25,z1+200,COLOR.tie);
  S.box(v,ua,ub,k-24,k+24,k-24,k+24,z1+120,z1+260,COLOR.tie);
  for(const [u,n] of [[ua,ub],[ub,ua]])S.box(v,u,n,k+24,k+28,k-7,k+7,z1+185,z1+205,COLOR.stripping,false);
  // Bottom: the stripping hook below the spine.
  S.box(v,t,w,-30,30,face-30,face-12,z0-40,z0,COLOR.tie);
  return true;
 }
 // options.lite (DXF export): plywood + frame per panel, plain tie rods, simple fastener heads —
 // the AutoCAD file stays small (the full viewer mesh is millions of triangles on a real plan).
 function build(project,result,options={}){
  H=project?.wallHeight||3000; // panel height per project (3,0 / 3,3 m)
  const lite=!!options.lite;
  const pts=result.elements.flatMap(e=>[e.from,e.to]);if(!pts.length)return null;
  const origin={x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length};
  const S=sceneBuilder(origin),floors=options.floor&&options.floor!=='all'?[Number(options.floor)]:null,onFloor=x=>!floors||floors.includes(x.floor),zOf=f=>(f-1)*3500;
  const concrete=sceneBuilder(origin),walls=project.walls.filter(onFloor);
  // Walls are split at T/L/cross nodes, so the node square belongs to no run. Fill it: from
  // each wall end, march forward and extend the concrete up to the next wall body (<= 600 mm).
  const inside=(o,q)=>{const r=o.angle*Math.PI/180,dx=q.x-o.x,dy=q.y-o.y,al=dx*Math.cos(r)+dy*Math.sin(r),c=Math.cos(r)*dy-Math.sin(r)*dx;return al>=-1&&al<=o.length+1&&Math.abs(c)<=o.thickness/2+1;};
  const reach=(w,u,from,out)=>{const n={x:-u.y,y:u.x};for(let d=5;d<=600;d+=5){const c={x:w.x+u.x*(from+out*d),y:w.y+u.y*(from+out*d)};const probes=[-.4,0,.4].map(k=>({x:c.x+n.x*k*w.thickness,y:c.y+n.y*k*w.thickness}));if(walls.some(o=>o!==w&&o.floor===w.floor&&probes.some(q=>inside(o,q))))return d-5;}return 0;};
  // L node (user 3D screenshot, 24 Oct 2026): both walls stop short of the corner square, so marching finds no
  // body. When a perpendicular wall also ENDS at the axes' crossing, extend through the square to its outer face.
  const lNode=(w,u,from,out)=>{const P={x:w.x+u.x*from,y:w.y+u.y*from};let best=0;
   for(const o of walls){if(o===w||o.floor!==w.floor)continue;const b=o.angle*Math.PI/180,v={x:Math.cos(b),y:Math.sin(b)};if(Math.abs(u.x*v.x+u.y*v.y)>1e-3)continue;
    const den=u.x*v.y-u.y*v.x,dx=o.x-P.x,dy=o.y-P.y,t=(dx*v.y-dy*v.x)/den*out,s=(dx*u.y-dy*u.x)/den;
    if(t<-1||t>600)continue;const endGap=Math.min(Math.abs(s),Math.abs(s-o.length));if(endGap>w.thickness/2+10)continue;best=Math.max(best,t+o.thickness/2);}
   return best;};
  for(const w of walls){
   const a=w.angle*Math.PI/180,u={x:Math.cos(a),y:Math.sin(a)},n={x:-u.y,y:u.x},base={x:w.x,y:w.y},z=zOf(w.floor);
   const pre=reach(w,u,0,-1)||lNode(w,u,0,-1),post=reach(w,u,w.length,1)||lNode(w,u,w.length,1);
   let at=-pre;for(const o of [...w.openings].filter(o=>o.width>1500).sort((p,q)=>p.offset-q.offset)){concrete.box(base,u,n,at,o.offset,-w.thickness/2,w.thickness/2,z,z+H,COLOR.concrete);at=o.offset+o.width;}
   concrete.box(base,u,n,at,w.length+post,-w.thickness/2,w.thickness/2,z,z+H,COLOR.concrete);
  }
  // Width labels on top of the frames, as in the 2D plan (user, 30 Oct 2026); [x, y, z, ux, uy, text, room] in scene
  // coordinates, ux/uy = reading direction (left to right, vertical ones bottom to top), room = free length for the label.
  // A corner leg's label sits in the middle of the leg past the other leg's frame, so the two never overlap at the vertex.
  const labels=[],label=(from,to,side,z,text,vertex)=>{const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy);if(len<150)return;let ux=dx/len,uy=dy/len;
   const n={x:-uy*side,y:ux*side},d=(PLY+DEPTH)/2;let mx=(from.x+to.x)/2,my=(from.y+to.y)/2,room=len;
   if(vertex){const s=Math.hypot(to.x-vertex.x,to.y-vertex.y)>Math.hypot(from.x-vertex.x,from.y-vertex.y)?1:-1;mx+=ux*s*DEPTH/2;my+=uy*s*DEPTH/2;room=len-DEPTH;}
   if(ux<-1e-6||Math.abs(ux)<=1e-6&&uy<0){ux=-ux;uy=-uy;}
   labels.push([mx+n.x*d-origin.x,my+n.y*d-origin.y,z+H+3,ux,uy,String(text),room]);};
  for(const e of result.elements.filter(onFloor)){
   S.group(e.kind,e.floor);
   // a 4 mm gap at both ends, so neighbouring panels read as separate pieces (visual only)
   if(e.kind==='panel'){const len=Math.hypot(e.to.x-e.from.x,e.to.y-e.from.y),g=len>200?GAP:0,u={x:(e.to.x-e.from.x)/len,y:(e.to.y-e.from.y)/len};
    panel(S,{x:e.from.x+u.x*g,y:e.from.y+u.y*g},{x:e.to.x-u.x*g,y:e.to.y-u.y*g},e.frameSide??e.side,zOf(e.floor),{lite});if(e.width)label(e.from,e.to,e.frameSide??e.side,zOf(e.floor),e.width);}
   else if(e.kind==='timber'){/* open gap under 50 mm: no brusok (engineer drawings, 25 Oct 2026) */}
  }
  for(const c of result.corners.filter(onFloor)){
   S.group('corner',c.floor);
   if(c.kind==='stripping-corner'&&strippingCorner(S,c,zOf(c.floor),lite))continue;
   for(const l of c.legs)panel(S,l.from,l.to,l.side,zOf(c.floor),c.kind==='stripping-corner'?{lite,color:COLOR.stripping,rib:COLOR.strippingRib}:{lite});
   if(c.kind!=='stripping-corner')for(const l of c.legs)label(l.from,l.to,l.side,zOf(c.floor),l.width||300,c.vertex);
  }
  // Outer L junction: the two flat panels end at the vertex, so their 120 mm frames leave an
  // open square outside the corner. Close it with the corner connection post (frame colour).
  for(const p of convexCorners(result).filter(onFloor)){S.group('post',p.floor);S.box(p.vertex,p.na,p.nb,0,DEPTH,0,DEPTH,zOf(p.floor),zOf(p.floor)+H,COLOR.frame);}
  // Through-wall rods and panel seam clamps are separate hardware (user reference).
  // The round washer/nut sits on the rod; the clamp bridges the two frame rails
  // at a different height. These are visual assemblies, not added catalogue items.
  for(const j of (result.joints||[]).filter(onFloor)){
   S.group('tie',j.floor);
   const dx=j.to.x-j.from.x,dy=j.to.y-j.from.y,t=Math.hypot(dx,dy)||1,u={x:dx/t,y:dy/t},n={x:-u.y,y:u.x},z0=zOf(j.floor);
   for(const zz of [450,1500,2550]){const z=z0+zz;
    S.cylinder(j.from,u,n,-DEPTH-150,t+DEPTH+150,0,z,8,COLOR.tie,lite?6:12);
    if(lite){for(const side of [-1,1]){const base=side<0?j.from:j.to,out={x:u.x*side,y:u.y*side};S.cylinder(base,out,n,DEPTH+2,DEPTH+14,0,z,55,COLOR.washer,8);}continue;}
    for(const side of [-1,1]){
     const base=side<0?j.from:j.to,out={x:u.x*side,y:u.y*side};
     S.cylinder(base,out,n,DEPTH+2,DEPTH+14,0,z,55,COLOR.washer,32);
     S.cylinder(base,out,n,DEPTH+14,DEPTH+44,0,z,23,COLOR.tie,6);
     S.box(base,out,n,DEPTH+19,DEPTH+31,-40,40,z-7,z+7,COLOR.tie);
     for(let a=DEPTH+48;a<DEPTH+148;a+=10)S.cylinder(base,out,n,a,a+2,0,z,9,COLOR.clamp,12);
    }
   }
   // no wedge clamps at an open gap: Замок универсальный (gap-lock.js) holds it (user, 30 Oct 2026)
   if(!lite&&!j.gap)for(const zz of [225,1725,2775])for(const side of [-1,1]){
    const z=z0+zz,base=side<0?j.from:j.to,out={x:u.x*side,y:u.y*side};
    // Shallow bridge with two hooked jaws grips adjacent 60 mm panel rails.
    S.box(base,out,n,DEPTH+4,DEPTH+25,-80,80,z-13,z+13,COLOR.tie);
    for(const sign of [-1,1]){
     const d=sign*70;
     S.box(base,out,n,DEPTH-24,DEPTH+25,d-10,d+10,z-17,z+17,COLOR.tie);
     S.box(base,out,n,DEPTH-24,DEPTH-12,sign<0?-70:48,sign<0?-48:70,z-17,z+17,COLOR.tie);
    }
    S.box(base,out,n,DEPTH+25,DEPTH+37,-9,9,z-28,z+28,COLOR.clamp);
   }
  }
  // End fasteners hook behind each side frame and pass through the closing panel.
  // Brusok gap (user, 24 Oct 2026): one Замок универсальный at each seam-clamp height, the engineer's plan
  // outline extruded 70 mm (silver) — jaws over both panel rails, body across the gap.
  const GL=root.MinarGapLock||(typeof require==='function'?require('./gap-lock.js'):null);
  if(GL&&!lite)for(const p of GL.placements(result).filter(onFloor)){S.group('gaplock',p.floor);const parts=GL.plan(p);
   for(const h of GL.heights){const z=zOf(p.floor)+h;for(const part of parts)S.ribbon(part.points,part.closed,z-35,z+35,COLOR.washer);}}
  const EF=root.MinarEndFastener||(typeof require==='function'?require('./end-fastener.js'):null);
  if(EF)for(const p of EF.placements(result,project.walls).filter(onFloor))for(const h of EF.heights){
   S.group('end_fastener',p.floor);const z=zOf(p.floor)+h;
   if(lite){S.box(p.base,p.u,p.n,-155,-5,10,145,z-10,z+10,COLOR.tie);S.box(p.base,p.u,p.n,-20,245,67,83,z-8,z+8,COLOR.clamp);continue;}
   S.profile(p.base,p.u,p.n,EF.head.profile,EF.head.z0,EF.head.z1,z,COLOR.tie,true);
   // Dark circular recess indicates the small hole on both sides of the flat head.
   const hole=EF.head.hole,holeOutline=Array.from({length:20},(_,i)=>[hole.a+Math.cos(i*Math.PI/10)*hole.r,hole.d+Math.sin(i*Math.PI/10)*hole.r]);S.profile(p.base,p.u,p.n,holeOutline,EF.head.z0-.2,EF.head.z1+.2,z,COLOR.clamp,true);
   for(const b of EF.boxes)S.box(p.base,p.u,p.n,b.a0,b.a1,b.d0,b.d1,z+b.z0,z+b.z1,COLOR.tie);
   for(const r of EF.rods)S.cylinder(p.base,p.u,p.n,r.a0,r.a1,r.d,z,r.r,r.kind==='rod'?COLOR.clamp:COLOR.tie,r.kind==='nut'?6:r.kind==='washer'?32:12);
   for(let a=168;a<240;a+=8)S.cylinder(p.base,p.u,p.n,a,a+2,75,z,9,COLOR.tie,12);
  }
  // Single-level telescopic push-pull braces: one shared placement list for
  // the preview, DXF and bill. Proportions follow the user's reference image.
  for(const b of (result.braces||[]).filter(onFloor)){
   S.group('brace',b.floor);
   const z=zOf(b.floor),H=b.height-35,L=b.reach;
   const tube=(lo,hi,r,color)=>{const x0=L*lo,x1=L*hi,h0=b.height-H*lo,h1=b.height-H*hi;
    const norm=Math.hypot(L,H),da=H/norm*r,dh=L/norm*r;
    S.profile(b.from,b.n,b.u,[[x0-da,h0-dh],[x1-da,h1-dh],[x1+da,h1+dh],[x0+da,h0+dh]],-r,r,z,color);
   };
   tube(0,.38,22,COLOR.tie);tube(.32,.96,32,COLOR.frame);tube(.31,.36,38,COLOR.clamp);tube(.89,.94,38,COLOR.clamp);tube(.94,1,22,COLOR.tie);
   // Second (lower) level of the two-level brace: a shorter strut from mid-wall to the same base.
   const bh2=b.height*.46,H2=bh2-35,norm2=Math.hypot(L,H2)||1;
   const low=(lo,hi,r,color)=>{const x0=L*lo,x1=L*hi,h0=bh2-H2*lo,h1=bh2-H2*hi,da=H2/norm2*r,dh=L/norm2*r;
    S.profile(b.from,b.n,b.u,[[x0-da,h0-dh],[x1-da,h1-dh],[x1+da,h1+dh],[x0+da,h0+dh]],-r,r,z,color);};
   low(0,.42,20,COLOR.tie);low(.38,1,28,COLOR.frame);low(.37,.42,32,COLOR.clamp);low(.93,1,20,COLOR.tie);
   S.box(b.from,b.n,b.u,-15,35,-80,80,z+bh2-26,z+bh2+26,COLOR.tie);
   S.box(b.to,b.n,b.u,-120,120,-110,110,z,z+18,COLOR.frame);
   S.box(b.to,b.n,b.u,-35,35,-45,45,z+18,z+70,COLOR.tie);
   S.box(b.from,b.n,b.u,-15,35,-100,100,z+b.height-35,z+b.height+35,COLOR.tie);
   // A small rectangular adjustment handle around the outer tube.
   const q=.57,x=L*q,h=b.height-H*q;
   for(const d of [-85,85])S.box(b.from,b.n,b.u,x-45,x+45,d-7,d+7,z+h-7,z+h+7,COLOR.tie);
   for(const a of [x-45,x+45])S.box(b.from,b.n,b.u,a-7,a+7,-85,85,z+h-7,z+h+7,COLOR.tie);
  }
  const s=S.result(),c=concrete.result();
  return{origin,groups:s.groups,triangles:s.triangles,edges:s.edges,concrete:c.triangles,labels,lo:s.lo.map((v,i)=>Math.min(v,c.lo[i])),hi:s.hi.map((v,i)=>Math.max(v,c.hi[i]))};
 }

 // ---- WebGL viewer -----------------------------------------------------------------------
 const VS=`attribute vec3 p;attribute vec3 nrm;attribute vec3 col;uniform mat4 m;varying vec3 c;
 void main(){vec3 l1=normalize(vec3(.45,-.35,.82)),l2=normalize(vec3(-.6,.7,.35));float d=.42+.48*abs(dot(nrm,l1))+.22*abs(dot(nrm,l2));c=col*d;gl_Position=m*vec4(p,1.);}`;
 const FS=`precision mediump float;varying vec3 c;uniform float a;void main(){gl_FragColor=vec4(c,a);}`;
 const LVS=`attribute vec3 p;uniform mat4 m;void main(){gl_Position=m*vec4(p,1.);}`;
 const LFS=`precision mediump float;uniform vec4 col;void main(){gl_FragColor=col;}`;
 // Width labels: every distinct text once in one texture (black on a white box, as in the 2D plan), one flat quad 80 mm high
 // on top of each frame, shown when the camera is closer than LABEL_DIST.
 const TVS=`attribute vec3 p;attribute vec2 t;uniform mat4 m;varying vec2 v;void main(){v=t;gl_Position=m*vec4(p,1.);}`;
 const TFS=`precision mediump float;uniform sampler2D s;varying vec2 v;void main(){vec4 c=texture2D(s,v);if(c.a<.5)discard;gl_FragColor=c;}`;
 const LABEL_DIST=25000,LABEL_H=80;
 function labelMesh(gl,labels){
  if(!labels||!labels.length||typeof document==='undefined')return null;
  const texts=[...new Set(labels.map(l=>l[5]))],CH=64,BOX=52,W=2048,font='bold 44px Arial',cv=document.createElement('canvas');let cx=cv.getContext('2d');cx.font=font;
  const cell=new Map();let x=0,y=0;for(const t of texts){const w=Math.ceil(cx.measureText(t).width)+28;if(x+w>W){x=0;y+=CH;}cell.set(t,{x,y,w});x+=w+4;}
  cv.width=W;cv.height=y+CH;cx=cv.getContext('2d');cx.font=font;cx.textAlign='center';cx.textBaseline='middle';
  for(const [t,c] of cell){cx.fillStyle='#fff';cx.fillRect(c.x,c.y+(CH-BOX)/2,c.w,BOX);cx.fillStyle='#111';cx.fillText(t,c.x+c.w/2,c.y+CH/2+2);}
  const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,cv);
  for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);
  const data=[];for(const [lx,ly,lz,ux,uy,t,room] of labels){const c=cell.get(t),k=Math.min(1,room?(room-30)/(c.w*LABEL_H/BOX):1),hw=c.w*LABEL_H/BOX/2*k,hh=LABEL_H/2*k,vx=-uy,vy=ux,s0=c.x/W,s1=(c.x+c.w)/W,t0=(c.y+(CH-BOX)/2)/cv.height,t1=(c.y+(CH+BOX)/2)/cv.height;
   const P=(a,b,s,tt)=>data.push(lx+ux*a+vx*b,ly+uy*a+vy*b,lz,s,tt),A=[-hw,-hh,s0,t1],B=[hw,-hh,s1,t1],C=[hw,hh,s1,t0],D=[-hw,hh,s0,t0];for(const q of [A,B,C,A,C,D])P(...q);}
  const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
  return{tex,buf,count:data.length/5,prog:program(gl,TVS,TFS)};
 }
 function program(gl,vs,fs){const sh=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(o));return o;};const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,vs));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
 const mul=(a,b)=>{const r=new Float32Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+j]*b[i*4+k];r[i*4+j]=s;}return r;};
 const perspective=(fov,aspect,near,far)=>{const f=1/Math.tan(fov/2),nf=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);};
 function lookAt(e,t,up){const z=e.map((v,i)=>v-t[i]),zl=Math.hypot(...z);z.forEach((v,i)=>z[i]=v/zl);const x=[up[1]*z[2]-up[2]*z[1],up[2]*z[0]-up[0]*z[2],up[0]*z[1]-up[1]*z[0]],xl=Math.hypot(...x);x.forEach((v,i)=>x[i]=v/xl);const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
  return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-(x[0]*e[0]+x[1]*e[1]+x[2]*e[2]),-(y[0]*e[0]+y[1]*e[1]+y[2]*e[2]),-(z[0]*e[0]+z[1]*e[1]+z[2]*e[2]),1]);}
 function open(canvas,scene,state={}){
  const gl=canvas.getContext('webgl',{antialias:true,alpha:false});if(!gl)throw Error('WebGL недоступен в этом браузере.');
  const prog=program(gl,VS,FS),lineProg=program(gl,LVS,LFS);
  const upload=data=>{const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return{b,count:data.length};};
  const solid=upload(scene.triangles),concrete=upload(scene.concrete),lines=upload(scene.edges),texts=labelMesh(gl,scene.labels);
  const center=scene.lo.map((v,i)=>(v+scene.hi[i])/2),radius=Math.max(2000,Math.hypot(...scene.hi.map((v,i)=>v-scene.lo[i]))/2);
  const view=Object.assign({yaw:-.75,pitch:.62,dist:radius*2.1,target:[...center],concrete:true},state);
  function draw(){
   const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(root.devicePixelRatio||1,1.5);if(!w||!h)return;
   if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
   gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.93,.95,.97,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);
   const eye=[view.target[0]+view.dist*Math.cos(view.pitch)*Math.cos(view.yaw),view.target[1]+view.dist*Math.cos(view.pitch)*Math.sin(view.yaw),view.target[2]+view.dist*Math.sin(view.pitch)];
   const m=mul(perspective(.75,w/h,Math.max(10,view.dist/200),view.dist*20+radius*4),lookAt(eye,view.target,[0,0,1]));
   gl.useProgram(prog);gl.uniformMatrix4fv(gl.getUniformLocation(prog,'m'),false,m);
   const attrib=(buf)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buf.b);const stride=36;for(const [name,size,off]of [['p',3,0],['nrm',3,12],['col',3,24]]){const loc=gl.getAttribLocation(prog,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,stride,off);}};
   gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);gl.uniform1f(gl.getUniformLocation(prog,'a'),1);
   attrib(solid);gl.drawArrays(gl.TRIANGLES,0,solid.count/9);
   if(view.concrete&&concrete.count){attrib(concrete);gl.drawArrays(gl.TRIANGLES,0,concrete.count/9);}
   gl.disable(gl.POLYGON_OFFSET_FILL);
   if(lines.count&&view.dist<20000){gl.useProgram(lineProg);gl.uniformMatrix4fv(gl.getUniformLocation(lineProg,'m'),false,m);gl.uniform4f(gl.getUniformLocation(lineProg,'col'),.22,.04,.04,1);gl.bindBuffer(gl.ARRAY_BUFFER,lines.b);const loc=gl.getAttribLocation(lineProg,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);gl.drawArrays(gl.LINES,0,lines.count/3);}
   if(texts&&view.dist<LABEL_DIST){gl.useProgram(texts.prog);gl.uniformMatrix4fv(gl.getUniformLocation(texts.prog,'m'),false,m);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texts.tex);gl.uniform1i(gl.getUniformLocation(texts.prog,'s'),0);
    gl.bindBuffer(gl.ARRAY_BUFFER,texts.buf);for(const [name,size,off] of [['p',3,0],['t',2,12]]){const loc=gl.getAttribLocation(texts.prog,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,20,off);}gl.drawArrays(gl.TRIANGLES,0,texts.count);gl.disableVertexAttribArray(gl.getAttribLocation(texts.prog,'t'));}
  }
  let frame=0;const redraw=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});};
  const MIN_DIST=60,MAX_DIST=radius*12;
  const rotate=(dyaw,dpitch)=>{view.yaw+=dyaw;view.pitch=Math.max(.03,Math.min(1.55,view.pitch+dpitch));redraw();};
  const zoom=f=>{view.dist=Math.max(MIN_DIST,Math.min(MAX_DIST,view.dist*f));redraw();};
  // AutoCAD-style zoom toward the cursor: keep the point under the pointer fixed on screen.
  const zoomAt=(f,clientX,clientY)=>{
   const r=canvas.getBoundingClientRect();if(!r.width||!r.height){zoom(f);return;}
   const ndcX=((clientX-r.left)/r.width)*2-1,ndcY=1-((clientY-r.top)/r.height)*2;
   const cp=Math.cos(view.pitch),sp=Math.sin(view.pitch),cyw=Math.cos(view.yaw),syw=Math.sin(view.yaw);
   const fwd=[-cp*cyw,-cp*syw,-sp];
   const right=[fwd[1]*1-fwd[2]*0,fwd[2]*0-fwd[0]*1,fwd[0]*0-fwd[1]*0],rl=Math.hypot(right[0],right[1],right[2])||1;
   for(let i=0;i<3;i++)right[i]/=rl;
   const cu=[right[1]*fwd[2]-right[2]*fwd[1],right[2]*fwd[0]-right[0]*fwd[2],right[0]*fwd[1]-right[1]*fwd[0]];
   const hh=Math.tan(.75/2)*view.dist,hw=hh*(r.width/r.height);
   const look=[view.target[0]+right[0]*ndcX*hw+cu[0]*ndcY*hh,view.target[1]+right[1]*ndcX*hw+cu[1]*ndcY*hh,view.target[2]+right[2]*ndcX*hw+cu[2]*ndcY*hh];
   const newDist=Math.max(MIN_DIST,Math.min(MAX_DIST,view.dist*f)),applied=newDist/view.dist;view.dist=newDist;
   for(let i=0;i<3;i++)view.target[i]+=(look[i]-view.target[i])*(1-applied);
   redraw();
  };
  // Pan in the screen plane: right = (-sin yaw, cos yaw, 0), up = (-cos yaw sin p, -sin yaw sin p, cos p).
  const pan=(dx,dy)=>{const k=view.dist/Math.max(1,canvas.clientHeight)*.9,sy=Math.sin(view.yaw),cy=Math.cos(view.yaw),sp=Math.sin(view.pitch),cp=Math.cos(view.pitch);
   view.target[0]+=( sy*dx - cy*sp*dy)*k;view.target[1]+=(-cy*dx - sy*sp*dy)*k;view.target[2]+=cp*dy*k;redraw();};
  // Pointers: mouse (left = rotate, right/middle/Shift = pan), pen, and touch (1 finger rotate, 2 fingers pinch + pan).
  const pointers=new Map();let mode=null,pinch=null;
  canvas.oncontextmenu=e=>e.preventDefault();
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   mode=pointers.size>=2?'pinch':(e.button===1||e.button===2||e.shiftKey)?'pan':'rotate';
   if(mode==='pinch'){const [a,b]=[...pointers.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y),cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};}canvas.style.cursor=mode==='pan'?'move':'grabbing';};
  canvas.onpointermove=e=>{const p=pointers.get(e.pointerId);if(!p)return;const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
   if(mode==='pinch'&&pointers.size>=2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;if(pinch.d>0&&d>0)zoomAt(pinch.d/d,cx,cy);pan(cx-pinch.cx,cy-pinch.cy);pinch={d,cx,cy};}
   else if(mode==='pan')pan(dx,dy);else if(mode==='rotate')rotate(-dx*.007,dy*.007);};
  const up=e=>{pointers.delete(e.pointerId);if(pointers.size<2&&mode==='pinch'){mode=pointers.size?'rotate':null;}if(!pointers.size){mode=null;canvas.style.cursor='grab';}};
  canvas.onpointerup=up;canvas.onpointercancel=up;
  // Wheel: a mouse wheel zooms; on a laptop touchpad, pinch (ctrlKey) zooms, two-finger swipe orbits,
  // Shift + swipe pans. A notched wheel sends large integer steps with no horizontal part.
  canvas.onwheel=e=>{e.preventDefault();const scale=e.deltaMode===1?16:e.deltaMode===2?400:1,dx=e.deltaX*scale,dy=e.deltaY*scale;
   const wheel=e.deltaMode!==0||(dx===0&&Math.abs(dy)>=40&&Number.isInteger(e.deltaY));
   if(e.ctrlKey)zoomAt(Math.exp(dy*.01),e.clientX,e.clientY);else if(wheel)zoomAt(Math.exp(dy*.0015),e.clientX,e.clientY);else if(e.shiftKey)pan(-dx,-dy);else rotate(-dx*.004,-dy*.004);};
  canvas.tabIndex=0;canvas.onkeydown=e=>{const k=e.key;if(k==='ArrowLeft')rotate(.08,0);else if(k==='ArrowRight')rotate(-.08,0);else if(k==='ArrowUp')rotate(0,.06);else if(k==='ArrowDown')rotate(0,-.06);else if(k==='+'||k==='=')zoom(.85);else if(k==='-'||k==='_')zoom(1/.85);else return;e.preventDefault();};
  canvas.style.cursor='grab';
  const resize=new ResizeObserver(redraw);resize.observe(canvas);draw();
  return{view,redraw,rotate,zoom,pan,topView:()=>{view.pitch=1.55;redraw();},setConcrete:v=>{view.concrete=v;redraw();},reset:()=>{Object.assign(view,{yaw:-.75,pitch:.62,dist:radius*2.1,target:[...center]});redraw();},destroy:()=>{resize.disconnect();for(const b of [solid,concrete,lines])gl.deleteBuffer(b.b);if(texts){gl.deleteBuffer(texts.buf);gl.deleteTexture(texts.tex);}}};
 }
 // factory: this whole module, so share3d.js can put the same viewer into a stand-alone 3D file.
 root.MinarViewer3D={build,open,COLOR,convexCorners,factory:minarViewer3D};if(typeof module!=='undefined')module.exports=root.MinarViewer3D;
})(globalThis);
