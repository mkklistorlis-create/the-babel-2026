import test from 'node:test';
import assert from 'node:assert/strict';
import {Group} from '../public/vendor/three.module.js';
import {AFFECT_FAMILIES} from '../public/affect-visual-state.js';
import {AffectRings,buildAffectPaths,ellipseArcSites,affectBounds,affectRingPlacement} from '../public/affect-rings.js';
import {cameraProjection} from '../public/duet-canvas.js';

const ids={calm:'neutral',joy:'smile',surprise:'open-mouth',tension:'brow-furrow',sadness:'mouth-frown'};
const expression=family=>({id:ids[family],visible:true,score:.8,demo:true,actions:null});
const face=(now,x=.5,y=.3)=>({faceSeen:true,stale:false,faceObservedAt:now,faceCenter:{x,y},faceBBox:{x:x-.08,y:y-.12,width:.16,height:.24}});
const reference={width:900,height:430};
const projection=viewport=>cameraProjection(viewport.width,viewport.height,1280,720);
const close=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
const length=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const render=(rings,family,now,options={})=>rings.update(face(now),projection(reference),now,{expression:expression(family),owner:'person-a',viewport:reference,...options});

test('calm, joy, surprise and sadness contain exactly three hollow orbit paths at every keyframe',()=>{
 for(const family of ['calm','joy','surprise','sadness'])for(const intensity of [0,.5,1]){
  const paths=buildAffectPaths(family,intensity,{reducedMotion:true});
  assert.equal(paths.length,3,`${family} ${intensity}`);
  assert.deepEqual(paths.map(path=>path.ring),[0,1,2]);
  for(const path of paths){
   assert.equal(path.closed,true);
   assert.ok(path.points.length>=100);
   assert.ok(path.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
   assert.ok(path.points.every(p=>Math.hypot(p.x,p.y)>45),'orbit outline never enters its hollow center');
   assert.ok(path.width>0&&path.opacity>0&&path.opacity<=1);
  }
 }
});

test('each surprise orbit has twelve integral outward spikes and no separate rays',()=>{
 for(const intensity of [0,.5,1]){
  const paths=buildAffectPaths('surprise',intensity);
  assert.equal(paths.length,3);
  for(const path of paths){
   const spikes=path.points.filter(p=>p.spike);
   assert.equal(spikes.length,12);
   assert.equal(path.closed,true);
   // Every peak belongs to the same continuous edge and has a shoulder on
   // either side. No separate radial path or filled center is introduced.
   for(let i=0;i<path.points.length;i++)if(path.points[i].spike){
    const before=path.points[(i+path.points.length-1)%path.points.length];
    const after=path.points[(i+1)%path.points.length];
    assert.ok(!before.spike&&!after.spike);
    assert.ok(length(before,path.points[i])>intensity*15+3);
    assert.ok(length(after,path.points[i])>intensity*15+3);
   }
  }
 }
});

test('tension is three orbits of 64 open 90-degree chevrons with the measured sqrt(128) legs',()=>{
 for(const intensity of [0,.5,1]){
  const paths=buildAffectPaths('tension',intensity);
  assert.equal(paths.length,3*64);
  for(let ring=0;ring<3;ring++)assert.equal(paths.filter(p=>p.ring===ring).length,64);
  for(const path of paths){
   assert.equal(path.closed,false);
   assert.equal(path.points.length,3);
   const [a,c,b]=path.points;
   close(length(a,c),Math.sqrt(128));close(length(b,c),Math.sqrt(128));
   close((a.x-c.x)*(b.x-c.x)+(a.y-c.y)*(b.y-c.y),0);
   assert.ok(length(a,b)>0,'chevron remains open');
  }
 }
});

test('tension arrows follow the orbit tangent with both legs behind their apex',()=>{
 const {sites}=ellipseArcSites(205,78,64),angles=[0,-55,55];
 for(const intensity of [0,.5,1])for(const [index,path] of buildAffectPaths('tension',intensity).entries()){
  const angle=angles[path.ring]*Math.PI/180,local=sites[index%64].tangent;
  const t={x:local.x*Math.cos(angle)-local.y*Math.sin(angle),y:local.x*Math.sin(angle)+local.y*Math.cos(angle)};
  const n={x:t.y,y:-t.x},[a,c,b]=path.points;
  const along=p=>(p.x-c.x)*t.x+(p.y-c.y)*t.y;
  const across=p=>(p.x-c.x)*n.x+(p.y-c.y)*n.y;
  assert.ok(along(a)<0&&along(b)<0,'both endpoints trail the positive tangent');
  assert.ok(across(a)*across(b)<0,'the two legs lie on opposite sides of the tangent');
  close(along(a),along(b));close(across(a),-across(b));
 }
});

// Simpson integration is independent of the production chord-length lookup.
function ellipseArcLength(from,to,rx,ry){
 const n=64,h=(to-from)/n,speed=t=>Math.hypot(rx*Math.sin(t),ry*Math.cos(t));
 let sum=speed(from)+speed(to);
 for(let i=1;i<n;i++)sum+=(i%2?4:2)*speed(from+i*h);
 return sum*h/3;
}
test('chevron sites follow equal ellipse arc lengths, including the closing interval',()=>{
 const {sites,total}=ellipseArcSites(205,78,64);
 assert.equal(sites.length,64);
 const arcs=sites.map((site,i)=>ellipseArcLength(site.angle,sites[i+1]?.angle??Math.PI*2,205,78));
 for(const [i,site] of sites.entries()){
  close(site.point.x**2/205**2+site.point.y**2/78**2,1);
  close(Math.hypot(site.tangent.x,site.tangent.y),1);
  close(arcs[i],total/64,.001);
 }
 assert.ok(Math.abs(sites[1].angle-sites[0].angle-(sites[17].angle-sites[16].angle))>.05,'equal angular spacing would bunch the chevrons');
 const centers=buildAffectPaths('tension',.5).filter(p=>p.ring===0).map(p=>p.points[1]);
 for(let i=0;i<64;i++){close(centers[i].x,sites[i].point.x);close(centers[i].y,sites[i].point.y);}
});

test('placement uses viewport scale and stays inside portrait, small and wide cover crops',()=>{
 for(const viewport of [reference,{width:390,height:844},{width:180,height:140},{width:1280,height:240}]){
  for(const family of AFFECT_FAMILIES){
   const bounds=affectBounds(buildAffectPaths(family,1,{reducedMotion:true}));
   for(const [x,y] of [[0,0],[.5,.3],[1,1]]){
    const placement=affectRingPlacement(face(0,x,y),projection(viewport),viewport,bounds);
    assert.ok(placement&&placement.scale>0);
    assert.ok(placement.x+bounds.minX*placement.scale>=-.0001);
    assert.ok(placement.x+bounds.maxX*placement.scale<=viewport.width+.0001);
    assert.ok(placement.y+bounds.minY*placement.scale>=-.0001);
    assert.ok(placement.y+bounds.maxY*placement.scale<=viewport.height+.0001);
   }
   const person=face(0),largerFace={...person,faceBBox:{x:.25,y:.1,width:.5,height:.5}};
   close(affectRingPlacement(person,projection(viewport),viewport,bounds).scale,affectRingPlacement(largerFace,projection(viewport),viewport,bounds).scale);
  }
 }
 assert.equal(affectBounds([]),null);
 assert.equal(affectRingPlacement(null,projection(reference),reference,{width:10,height:10}),null);
 assert.equal(affectRingPlacement(face(0),projection(reference),{width:0,height:430},affectBounds(buildAffectPaths('calm',1))),null);
});

test('splitting a 1440 px stage into two 720 px panes retains ring presence at the unchanged camera height',()=>{
 const solo={width:1440,height:900},duet={width:720,height:900};
 for(const family of AFFECT_FAMILIES){
  const bounds=affectBounds(buildAffectPaths(family,.65,{reducedMotion:true})),person=face(0);
  const full=affectRingPlacement(person,projection(solo),solo,bounds),half=affectRingPlacement(person,projection(duet),duet,bounds);
  assert.ok(half.scale>=full.scale*.65,`${family} must retain presence instead of halving with the pane width`);
  assert.ok(half.scale>1.2,`${family} should remain visible around the large camera-cover person`);
  assert.ok(bounds.width*half.scale>=duet.width*.65);
  assert.ok(half.x+bounds.minX*half.scale>=0&&half.x+bounds.maxX*half.scale<=duet.width);
  assert.ok(half.y+bounds.minY*half.scale>=0&&half.y+bounds.maxY*half.scale<=duet.height);
 }
});

test('Three mesh draws only bounded finite stroke buffers behind the existing layers',()=>{
 const parent=new Group(),rings=new AffectRings(parent);
 assert.equal(parent.children.length,1);
 assert.equal(rings.mesh.renderOrder,-30);
 assert.equal(rings.material.depthTest,false);assert.equal(rings.material.depthWrite,false);
 assert.equal(rings.material.transparent,true);
 let now=0;
 for(const viewport of [reference,{width:390,height:844},{width:180,height:140},{width:1280,height:240}]){
  for(const family of AFFECT_FAMILIES)for(const [x,y] of [[0,0],[1,1]]){
   now+=100;
   const stats=rings.update(face(now,x,y),projection(viewport),now,{expression:expression(family),viewport,owner:'person-a'});
   assert.equal(stats.visible,true);
   assert.ok(stats.vertices>0&&stats.vertices<=rings.capacity&&stats.vertices%6===0);
   assert.equal(rings.geometry.drawRange.count,stats.vertices);
   for(const name of['position','aColor','aAlpha']){const attribute=rings.geometry.getAttribute(name);assert.deepEqual(attribute.updateRanges,[{start:0,count:stats.vertices*attribute.itemSize}],'only the active vertex prefix is uploaded');}
   for(let i=0;i<stats.vertices;i++){
    const [px,py,pz]=rings.positions.subarray(i*3,i*3+3);
    assert.ok(Number.isFinite(px)&&px>=-.001&&px<=viewport.width+.001,`${family}: x=${px}`);
    assert.ok(Number.isFinite(py)&&py>=-.001&&py<=viewport.height+.001,`${family}: y=${py}`);
    assert.equal(pz,0);
    assert.ok(Number.isFinite(rings.alphas[i])&&rings.alphas[i]>=0&&rings.alphas[i]<=1);
   }
   assert.ok(rings.colors.subarray(0,stats.vertices*3).every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  }
 }
 rings.dispose();assert.equal(parent.children.length,0);
});

test('renderer reuses its allocated attributes through family changes, reprojection and clearing',()=>{
 const rings=new AffectRings(new Group()),geometry=rings.geometry;
 const attributes=['position','aColor','aAlpha'].map(name=>rings.geometry.getAttribute(name));
 const buffers=attributes.map(attribute=>attribute.array);
 for(let i=0;i<20;i++){
  render(rings,AFFECT_FAMILIES[i%5],i*100);
  if(i===7)rings.reproject();
  if(i===12)rings.clear();
  assert.equal(rings.geometry,geometry);
  for(let j=0;j<attributes.length;j++){
   assert.equal(rings.geometry.getAttribute(['position','aColor','aAlpha'][j]),attributes[j]);
   assert.equal(attributes[j].array,buffers[j]);
  }
 }
 rings.dispose();
});

test('a small vertex budget stops at complete stroke triangles without buffer growth',()=>{
 const rings=new AffectRings(new Group(),{maxVertices:65});
 const original=rings.positions;
 for(const [i,family] of AFFECT_FAMILIES.entries()){
  const stats=render(rings,family,i*100);
  assert.equal(rings.capacity,63);
  assert.equal(stats.vertices,60);
  assert.equal(rings.geometry.drawRange.count,60);
  assert.equal(rings.positions,original);
  assert.equal(rings.positions.length,63*3);
  assert.ok(rings.positions.every(Number.isFinite));
 }
 rings.dispose();
});

test('pause and reduced motion freeze phase; normal rendering resumes without a large time jump',()=>{
 const rings=new AffectRings(new Group());
 render(rings,'calm',0);render(rings,'calm',100);
 close(rings.phase,.1);
 const frozen=rings.phase;
 for(const now of [200,300,400])render(rings,'calm',now,{paused:true});
 close(rings.phase,frozen);
 const before=Array.from(rings.positions.subarray(0,rings.count*3));
 render(rings,'calm',500,{paused:true});
 assert.deepEqual(Array.from(rings.positions.subarray(0,rings.count*3)),before);
 for(const now of [600,700,800])render(rings,'calm',now,{reducedMotion:true});
 close(rings.phase,frozen);
 const reduced=Array.from(rings.positions.subarray(0,rings.count*3));
 render(rings,'calm',900,{reducedMotion:true});
 assert.deepEqual(Array.from(rings.positions.subarray(0,rings.count*3)),reduced);
 render(rings,'calm',1000);close(rings.phase,frozen+.1);
 rings.dispose();
});

test('stale, missing, disabled and multiple-person eligibility immediately clear even when paused',()=>{
 for(const interruption of ['stale','expired','missing','disabled','multiple']){
  const rings=new AffectRings(new Group());render(rings,'joy',0);render(rings,'joy',100);
  assert.equal(rings.mesh.visible,true);
  const person=face(200),options={expression:expression('joy'),owner:'person-a',paused:true,viewport:reference};
  if(interruption==='stale')person.stale=true;
  if(interruption==='expired')person.faceObservedAt=-601;
  if(interruption==='missing')person.faceSeen=false;
  if(interruption==='disabled'||interruption==='multiple')options.enabled=false;
  const stats=rings.update(person,projection(reference),200,options);
  assert.equal(stats.visible,false,interruption);assert.equal(stats.vertices,0);
  assert.equal(rings.mesh.visible,false);assert.equal(rings.geometry.drawRange.count,0);
  assert.equal(rings.anchor,null);
  const recovered=render(rings,'calm',300);
  assert.equal(recovered.visible,true);assert.deepEqual(recovered.activeFamilies,['calm']);
  rings.dispose();
 }
});

test('participant ownership resets the family blend and phase, including an owner change during pause',()=>{
 const rings=new AffectRings(new Group());
 render(rings,'joy',0);render(rings,'surprise',100);render(rings,'surprise',300);
 assert.ok(rings.stats.activeFamilies.length>1);
 const next=render(rings,'sadness',400,{owner:'person-b'});
 assert.deepEqual(next.activeFamilies,['sadness']);close(rings.phase,0);
 const paused=render(rings,'tension',500,{owner:'person-c',paused:true});
 assert.equal(paused.visible,false);assert.equal(rings.geometry.drawRange.count,0);close(rings.phase,0);
 const resumed=render(rings,'tension',600,{owner:'person-c'});
 assert.deepEqual(resumed.activeFamilies,['tension']);
 rings.dispose();
});

test('clear is idempotent, hides all draw data and permits a fresh independent state',()=>{
 const parent=new Group(),rings=new AffectRings(parent);
 render(rings,'joy',0);render(rings,'joy',100);
 rings.clear();rings.clear();
 assert.equal(rings.count,0);assert.equal(rings.geometry.drawRange.count,0);
 assert.equal(rings.mesh.visible,false);assert.equal(rings.anchor,null);
 assert.equal(rings.lastTime,null);assert.equal(rings.phase,0);
 const stats=render(rings,'surprise',200);
 assert.equal(stats.visible,true);assert.deepEqual(stats.activeFamilies,['surprise']);
 assert.equal(stats.pathCount,3);
 rings.dispose();
});
