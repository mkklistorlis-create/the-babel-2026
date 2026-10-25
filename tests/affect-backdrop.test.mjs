import test from 'node:test';
import assert from 'node:assert/strict';
import {Group} from '../public/vendor/three.module.js';
import {AFFECT_FAMILIES} from '../public/affect-visual-state.js';
import {AffectBackdrop,composeBackdrop,smoothBackdropWeights} from '../public/affect-backdrop.js';

const state=(family,intensity=.65)=>({visible:true,weights:Object.fromEntries(AFFECT_FAMILIES.map(f=>[f,Number(f===family)])),strengths:Object.fromEntries(AFFECT_FAMILIES.map(f=>[f,intensity]))});
const person=t=>({faceSeen:true,stale:false,faceObservedAt:t});
const expression=id=>({id,visible:true,demo:true});
test('each palette creates a bounded, seeded collage of solid forms and open lines',()=>{
 for(const family of AFFECT_FAMILIES){
  const commands=composeBackdrop(state(family),5,42,720,900);
  assert.deepEqual(commands,composeBackdrop(state(family),5,42,720,900));
  assert.equal(commands.filter(c=>c.type==='fill'&&!c.decoration).length,16);
  assert.equal(commands.filter(c=>c.type==='strip').length,30);
  assert.equal(commands.filter(c=>c.type==='line').length,12);
  for(const c of commands){assert.ok(c.alpha>=0&&c.alpha<=1);assert.ok(c.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));}
  assert.notDeepEqual(commands,composeBackdrop(state(family),8,42,720,900));
 }
 assert.notDeepEqual(composeBackdrop(state('joy')),composeBackdrop(state('tension')));
 assert.deepEqual(composeBackdrop({visible:false}),[]);
});
test('fallback origin is stable and fixed buffers survive expression changes',()=>{
 const group=new Group(),layer=new AffectBackdrop(group),buffers=layer.buffers;
 const opts={owner:'A',expression:expression('smile')};
 layer.update(person(0),{},0,opts);const before=Array.from(buffers.position);
 layer.update({...person(0),faceCenter:{x:.1,y:.9}}, {},0,opts);
 assert.deepEqual(Array.from(buffers.position),before);
 for(let i=1;i<50;i++){layer.update(person(i*100),{},i*100,{...opts,expression:expression(i%2?'brow-furrow':'smile')});assert.equal(layer.buffers,buffers);assert.ok(layer.stats.vertices>0&&layer.stats.vertices<=layer.capacity);}
 assert.equal(group.children.length,1);assert.equal(layer.mesh.renderOrder,-30);
 assert.equal(layer.material.depthTest,false);layer.dispose();assert.equal(group.children.length,0);
});
test('pause and reduced motion freeze decorative time; invalid tracking and owner change clear safely',()=>{
 const layer=new AffectBackdrop(new Group()),opts={owner:'A',expression:expression('smile')};
 layer.update(person(0),{},0,opts);layer.update(person(100),{},100,opts);const phase=layer.phase;
 layer.update(person(200),{},200,{...opts,paused:true});assert.equal(layer.phase,phase);
 layer.update(person(300),{},300,{...opts,reducedMotion:true});assert.equal(layer.phase,phase);
 layer.update(person(0),{},1000,opts);assert.equal(layer.stats.visible,false);
 layer.update(person(1100),{},1100,opts);assert.equal(layer.stats.visible,true);
 layer.update(person(1200),{},1200,{...opts,owner:'B',paused:true});assert.equal(layer.stats.visible,false);
 layer.update(person(1300),{},1300,{...opts,owner:'B'});assert.equal(layer.stats.visible,true);
 layer.update(person(1400),{},1400,{...opts,enabled:false});assert.equal(layer.stats.visible,false);
 layer.dispose();
});

test('every petal has pointed ends and extends outward from the participant',()=>{
 const center={x:.38,y:.57},width=900,height=640;
 for(const family of AFFECT_FAMILIES){
  const commands=composeBackdrop(state(family),1,42,width,height,center);
  for(const c of commands.filter(c=>c.type==='strip')){
   const last=c.points.length-1;
   assert.ok(Math.hypot(c.points[0].x-c.other[0].x,c.points[0].y-c.other[0].y)<1e-6);
   assert.ok(Math.hypot(c.points[last].x-c.other[last].x,c.points[last].y-c.other[last].y)<1e-6);
   const radius=p=>Math.hypot(p.x-center.x*width,p.y-center.y*height);
   assert.ok(radius(c.points[last])>radius(c.points[0])*3);
  }
 }
});
test('render weights remain normalized and continuous through rapid expression retargeting',()=>{
 let memory=smoothBackdropWeights(null,state('calm').weights,0),maxStep=0;
 for(let i=0;i<180;i++){
  const previous={...memory.value},target=state(i<30?'joy':i<60?'tension':'sadness').weights;
  memory=smoothBackdropWeights(memory,target,1/60);
  assert.ok(Math.abs(Object.values(memory.value).reduce((a,b)=>a+b,0)-1)<1e-9);
  for(const f of AFFECT_FAMILIES){assert.ok(memory.value[f]>=0&&memory.value[f]<=1);maxStep=Math.max(maxStep,Math.abs(previous[f]-memory.value[f]));}
 }
 assert.ok(maxStep<.04);assert.ok(memory.value.sadness>.99);
 const frozen=structuredClone(memory);smoothBackdropWeights(memory,state('joy').weights,0);assert.deepEqual(memory,frozen);
});
test('bloom origin follows projected participant slowly without single-frame jumps',()=>{
 const layer=new AffectBackdrop(new Group()),projection={point:(x,y)=>({x:x*900,y:y*640})};
 const opts={owner:'A',expression:expression('smile'),viewport:{width:900,height:640}};
 layer.update({...person(0),faceCenter:{x:.3,y:.3}},projection,0,opts);
 const first=layer.stats.origin.x;
 layer.update({...person(100),faceCenter:{x:.7,y:.3}},projection,100,opts);
 assert.ok(layer.stats.origin.x>first&&layer.stats.origin.x<first+.1);
 for(let t=200;t<=2100;t+=100)layer.update({...person(t),faceCenter:{x:.7,y:.3}},projection,t,opts);
 assert.ok(layer.stats.origin.x>.68);layer.dispose();
});
test('all palettes have animated triangles and circles within the existing mesh budget',()=>{
 for(const family of AFFECT_FAMILIES){
  const first=composeBackdrop(state(family),0,42),next=composeBackdrop(state(family),1,42);
  const particles=first.filter(c=>c.decoration),moved=next.filter(c=>c.decoration);
  assert.equal(particles.filter(c=>c.decoration==='triangle').length,36);
  assert.equal(particles.filter(c=>c.decoration==='circle').length,36);
  assert.notDeepEqual(particles[0].points,moved[0].points);assert.notDeepEqual(particles[0].color,moved[0].color);
  for(const p of particles)assert.ok(Object.values(p.color).every(v=>v>=0&&v<=1));
 }
 const layer=new AffectBackdrop(new Group()),opts={owner:'A',expression:expression('smile')};
 layer.update(person(0),{},0,opts);assert.equal(layer.stats.vertices,15228);assert.equal(layer.stats.decorativeParticles,72);
 const before=Array.from(layer.buffers.position);layer.update(person(100),{},100,{...opts,paused:true});
 assert.deepEqual(Array.from(layer.buffers.position),before);layer.dispose();
});
