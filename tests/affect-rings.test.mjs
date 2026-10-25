import test from 'node:test';
import assert from 'node:assert/strict';
import {Group} from '../public/vendor/three.module.js';
import {AFFECT_FAMILIES} from '../public/affect-visual-state.js';
import {AffectRings,buildAffectPaths,ellipseArcSites,affectBounds,affectRingPlacement,affectChestAnchor,affectLightPhase,ORBIT_LAYOUT,orbitDrift} from '../public/affect-rings.js';
import {cameraProjection} from '../public/duet-canvas.js';

const ids={calm:'neutral',joy:'smile',surprise:'open-mouth',tension:'brow-furrow',sadness:'mouth-frown'};
const expression=family=>({id:ids[family],visible:true,score:.8,demo:true,actions:null});
const face=(now,x=.5,y=.3)=>({faceSeen:true,stale:false,faceObservedAt:now,faceCenter:{x,y},faceBBox:{x:x-.08,y:y-.12,width:.16,height:.24}});
const reference={width:900,height:430};
const projection=viewport=>cameraProjection(viewport.width,viewport.height,1280,720);
const close=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
const length=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const render=(rings,family,now,options={})=>rings.update(face(now),projection(reference),now,{expression:expression(family),owner:'person-a',viewport:reference,...options});
const torso=(now=0)=>{
 const person=face(now),landmarks=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0}));
 for(const[i,x,y]of[[11,.35,.45],[12,.65,.45],[23,.4,.85],[24,.6,.85]])landmarks[i]={x,y,z:0,visibility:.95};
 return {...person,landmarks,rawSource:'foreground-segmentation'};
};

test('calm, joy, surprise and sadness contain exactly three hollow orbit paths at every keyframe',()=>{
 for(const family of ['calm','joy','surprise','sadness'])for(const intensity of [0,.5,1]){
  const paths=buildAffectPaths(family,intensity,{reducedMotion:true});
  assert.equal(paths.length,3,`${family} ${intensity}`);
  assert.deepEqual(paths.map(path=>path.ring),[0,1,2]);
  for(const path of paths){
   assert.equal(path.closed,true);
   assert.ok(path.points.length>=100);
   assert.ok(path.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
   assert.ok(path.points.every(p=>Math.hypot(p.x-ORBIT_LAYOUT[path.ring].x,p.y-ORBIT_LAYOUT[path.ring].y)>30),'orbit outline never enters its hollow center');
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
  const paths=buildAffectPaths('tension',intensity).filter(p=>p.kind==='chevrons');
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
 const {sites}=ellipseArcSites(300,34,64),angles=[22,-17,-55];
 for(const intensity of [0,.5,1])for(const [index,path] of buildAffectPaths('tension',intensity).filter(p=>p.kind==='chevrons').entries()){
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
 const {sites,total}=ellipseArcSites(300,34,64);
 assert.equal(sites.length,64);
 const arcs=sites.map((site,i)=>ellipseArcLength(site.angle,sites[i+1]?.angle??Math.PI*2,300,34));
 for(const [i,site] of sites.entries()){
  close(site.point.x**2/300**2+site.point.y**2/34**2,1);
  close(Math.hypot(site.tangent.x,site.tangent.y),1);
  close(arcs[i],total/64,.001);
 }
 assert.ok(Math.abs(sites[1].angle-sites[0].angle-(sites[17].angle-sites[16].angle))>.05,'equal angular spacing would bunch the chevrons');
 const centers=buildAffectPaths('tension',.5).filter(p=>p.ring===0&&p.kind==='chevrons').map(p=>p.points[1]);
 for(let i=0;i<64;i++){const angle=22*Math.PI/180;close(centers[i].x,sites[i].point.x*Math.cos(angle)-sites[i].point.y*Math.sin(angle)-8);close(centers[i].y,sites[i].point.x*Math.sin(angle)+sites[i].point.y*Math.cos(angle)-5);}
});

test('placement retains the neck estimate at crop edges rather than moving it up to fit',()=>{
 for(const viewport of [reference,{width:390,height:844},{width:180,height:140},{width:1280,height:240}]){
  for(const family of AFFECT_FAMILIES){
   const bounds=affectBounds(buildAffectPaths(family,1,{reducedMotion:true}));
   for(const [x,y] of [[0,0],[.5,.3],[1,1]]){
    const placement=affectRingPlacement(face(0,x,y),projection(viewport),viewport,bounds);
    assert.ok(placement&&placement.scale>0);
    const p=projection(viewport),head=p.box(face(0,x,y).faceBBox),center=p.point(x,y);
    close(placement.x,center.x);close(placement.y,head.y+head.height*1.08);
    assert.equal(placement.kind,'neck-face-estimate');
    assert.ok(bounds.width*placement.scale<=viewport.width*1.5);

   }
   const person=face(0),largerFace={...person,faceBBox:{x:.25,y:.1,width:.5,height:.5}};
   assert.ok(affectRingPlacement(largerFace,projection(viewport),viewport,bounds).scale>=affectRingPlacement(person,projection(viewport),viewport,bounds).scale);
  }
 }
 assert.equal(affectBounds([]),null);
 assert.equal(affectRingPlacement(null,projection(reference),reference,{width:10,height:10}),null);
 assert.equal(affectRingPlacement(face(0),projection(reference),{width:0,height:430},affectBounds(buildAffectPaths('calm',1))),null);
});

test('neck anchor follows shoulders independently of head position and hip visibility',()=>{
 const p=cameraProjection(1000,1000,1000,1000),person=torso(100),center=affectChestAnchor(person,p,100);
 close(center.x,500);close(center.y,402);assert.equal(center.kind,'neck-shoulders');
 const turning={...person,faceCenter:{x:.18,y:.12},faceBBox:{x:.11,y:.03,width:.14,height:.18}};
 assert.deepEqual(affectChestAnchor(turning,p,100),center);
 // Shoulder-only input locates the chest below the shoulder line even when
 // sitting at a desk with the hip landmarks outside the camera.
 person.landmarks[23].visibility=person.landmarks[24].visibility=.1;
 const partial=affectChestAnchor(person,p,100);
 assert.equal(partial.kind,'neck-shoulders');close(partial.x,500);close(partial.y,402);
 // A low-quality or expired pose cannot pin the artwork to a stale torso.
 person.landmarks[11].visibility=.2;
 assert.equal(affectChestAnchor(person,p,100).kind,'neck-face-estimate');
 assert.equal(affectChestAnchor(torso(0),p,801).kind,'neck-face-estimate');
 assert.equal(affectChestAnchor({...torso(100),rawSource:'face-landmarks'},p,100).kind,'neck-face-estimate');
});

test('three tilted orbital planes contain near and far depths with continuous crossings',()=>{
 for(const family of AFFECT_FAMILIES){
  const paths=buildAffectPaths(family,.5,{reducedMotion:true});
  for(let ring=0;ring<3;ring++){
   const points=paths.filter(path=>path.ring===ring).flatMap(path=>path.points);
   assert.ok(points.some(p=>p.z>20)&&points.some(p=>p.z< -20));
   assert.ok(points.every(p=>Number.isFinite(p.z)&&Number.isFinite(p.orbitX)&&Number.isFinite(p.orbitY)));
  }
 }
});

test('splitting a 1440 px stage into two 720 px panes retains ring presence at the unchanged camera height',()=>{
 const solo={width:1440,height:900},duet={width:720,height:900};
 for(const family of AFFECT_FAMILIES){
  const bounds=affectBounds(buildAffectPaths(family,.65,{reducedMotion:true})),person=face(0);
  const full=affectRingPlacement(person,projection(solo),solo,bounds),half=affectRingPlacement(person,projection(duet),duet,bounds);
  assert.ok(bounds.width*full.scale>=solo.width*.5,`${family} keeps its extended reach in the solo view`);
  assert.ok(bounds.width*half.scale>duet.width*.65,`${family} remains prominent after its wider border is fitted`);
  assert.ok(bounds.width*half.scale>=duet.width*.65);
  assert.ok(half.x+bounds.minX*half.scale/1.5>=0&&half.x+bounds.maxX*half.scale/1.5<=duet.width);

 }
});

test('two orbital draw ranges straddle the body with one finite bounded buffer',()=>{
 const parent=new Group(),rings=new AffectRings(parent);
 assert.equal(parent.children.length,2);
 assert.equal(rings.mesh.renderOrder,-30);
 assert.equal(rings.frontMesh.renderOrder,5);
 assert.equal(rings.material.depthTest,false);assert.equal(rings.material.depthWrite,false);
 assert.equal(rings.material.transparent,true);
 let now=0;
 for(const viewport of [reference,{width:390,height:844},{width:180,height:140},{width:1280,height:240}]){
  for(const family of AFFECT_FAMILIES)for(const [x,y] of [[0,0],[1,1]]){
   now+=100;
   const stats=rings.update(face(now,x,y),projection(viewport),now,{expression:expression(family),viewport,owner:'person-a'});
   assert.equal(stats.visible,true);
   assert.ok(stats.vertices>0&&stats.vertices<=rings.capacity&&stats.vertices%6===0);
   assert.equal(rings.geometry.drawRange.count+ rings.frontGeometry.drawRange.count,stats.vertices);
   assert.ok(stats.backVertices>0&&stats.frontVertices>0);
   for(const name of['position','aColor','aAlpha','aOrbit','aEdge']){
    const attribute=rings.geometry.getAttribute(name);assert.equal(attribute,rings.frontGeometry.getAttribute(name));
    assert.deepEqual(attribute.updateRanges,[{start:0,count:stats.backVertices*attribute.itemSize},{start:(rings.capacity-stats.frontVertices)*attribute.itemSize,count:stats.frontVertices*attribute.itemSize}]);
   }
   for(const[start,count,front]of[[0,stats.backVertices,false],[rings.capacity-stats.frontVertices,stats.frontVertices,true]])for(let i=start;i<start+count;i++){
    const [px,py,pz]=rings.positions.subarray(i*3,i*3+3);
    assert.ok(Number.isFinite(px)&&Number.isFinite(py)&&Number.isFinite(pz));
    assert.ok(front?pz>=-.001:pz<=.001,'each visible half belongs to its depth side');
    assert.ok(Number.isFinite(rings.alphas[i])&&rings.alphas[i]>=0&&rings.alphas[i]<=1);
    assert.ok(rings.colors.subarray(i*3,i*3+3).every(v=>Number.isFinite(v)&&v>=0&&v<=1));
   }
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
  assert.equal(rings.geometry.drawRange.count+rings.frontGeometry.drawRange.count,60);
  assert.equal(rings.positions,original);
  assert.equal(rings.positions.length,63*3);
  assert.ok(rings.positions.every(Number.isFinite));
 }
 rings.dispose();
});

test('chest anchor moves smoothly with the torso and never follows an isolated head turn',()=>{
 const viewport={width:1000,height:1000},p=cameraProjection(1000,1000,1000,1000),rings=new AffectRings(new Group());
 const options={expression:expression('calm'),owner:'a',viewport};
 rings.update(torso(0),p,0,options);const initial={...rings.stats.anchor};
 const turned={...torso(100),faceCenter:{x:.2,y:.15},faceBBox:{x:.12,y:.03,width:.16,height:.24}};
 rings.update(turned,p,100,options);close(rings.stats.anchor.x,initial.x);close(rings.stats.anchor.y,initial.y);
 const moved=torso(200);for(const i of[11,12,23,24])moved.landmarks[i].x+=.1;
 rings.update(moved,p,200,options);
 assert.ok(rings.stats.anchor.x<initial.x&&rings.stats.anchor.x>initial.x-100);
 close(rings.stats.anchor.y,initial.y);rings.dispose();
});

test('every family breathes gently at a stable expression; pause and reduced motion freeze its light',()=>{
 for(let phase=0;phase<100;phase+=.17){const light=affectLightPhase(phase);assert.ok(light.breath>=.25-1e-9&&light.breath<=1);}
 close(affectLightPhase(0).breath,affectLightPhase(3.8).breath);
 for(const family of AFFECT_FAMILIES){
  const rings=new AffectRings(new Group());render(rings,family,0);const start=rings.stats.breath;
  for(let i=1;i<=14;i++)render(rings,family,i*100);
  assert.ok(rings.stats.breath>start+.1,`${family} light changes even with the same emoji`);
  const phase=rings.phase,light=rings.stats.breath,travel=rings.material.uniforms.uTravel.value;
  render(rings,family,1500,{paused:true});render(rings,family,1600,{reducedMotion:true});
  close(rings.phase,phase);close(rings.stats.breath,light);close(rings.material.uniforms.uTravel.value,travel);
  assert.equal(rings.stats.family,family);rings.dispose();
 }
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
  assert.equal(rings.frontMesh.visible,false);assert.equal(rings.frontGeometry.drawRange.count,0);
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
 assert.equal(rings.frontMesh.visible,false);assert.equal(rings.frontGeometry.drawRange.count,0);
 assert.equal(rings.lastTime,null);assert.equal(rings.phase,0);
 const stats=render(rings,'surprise',200);
 assert.equal(stats.visible,true);assert.deepEqual(stats.activeFamilies,['surprise']);
 assert.equal(stats.pathCount,3);
 rings.dispose();
});


test('three neck-relative centers stay distinct and each family has three wide continuous bands',()=>{
 const rings=new AffectRings(new Group()),viewport={width:1000,height:1000};
 const stats=rings.update(torso(0),cameraProjection(1000,1000,1000,1000),0,{expression:expression('calm'),viewport});
 assert.equal(stats.centers.length,3);
 assert.ok(stats.centers.every(c=>c.y<450),'all centers lie above the shoulder line');
 for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(length(stats.centers[i],stats.centers[j])>20);
 for(const family of AFFECT_FAMILIES){
  const bands=buildAffectPaths(family,.5,{reducedMotion:true}).filter(p=>p.closed);
  assert.equal(bands.length,3);
  assert.ok(bands.every(p=>p.width>=32));
 }
 rings.dispose();
});


test('orbit drift is independent, bounded, smooth and disabled for reduced motion',()=>{
 for(let ring=0;ring<3;ring++)for(let t=0;t<40;t+=.1){
  const a=orbitDrift(ring,t),b=orbitDrift(ring,t+1/60);
  assert.ok(Math.abs(a.x)<=11&&Math.abs(a.y)<=9&&Math.abs(a.angle)<=3.2);
  assert.ok(length(a,b)<.5&&Math.abs(a.angle-b.angle)<.15);
  assert.deepEqual(orbitDrift(ring,t,true),{x:0,y:0,angle:0});
 }
 assert.notDeepEqual(orbitDrift(0,5),orbitDrift(1,5));
 assert.notDeepEqual(orbitDrift(1,5),orbitDrift(2,5));
});
