import test from 'node:test';
import assert from 'node:assert/strict';
import {Group} from '../public/vendor/three.module.js';
import {AFFECT_FAMILIES} from '../public/affect-visual-state.js';
import {AffectBackdrop,composeBackdrop} from '../public/affect-backdrop.js';

const state=(family,intensity=.65)=>({visible:true,weights:Object.fromEntries(AFFECT_FAMILIES.map(f=>[f,Number(f===family)])),strengths:Object.fromEntries(AFFECT_FAMILIES.map(f=>[f,intensity]))});
const person=t=>({faceSeen:true,stale:false,faceObservedAt:t});
const expression=id=>({id,visible:true,demo:true});
test('each palette creates a bounded, seeded collage of solid forms and open lines',()=>{
 for(const family of AFFECT_FAMILIES){
  const commands=composeBackdrop(state(family),5,42,720,900);
  assert.deepEqual(commands,composeBackdrop(state(family),5,42,720,900));
  assert.equal(commands.filter(c=>c.type==='fill').length,16);
  assert.equal(commands.filter(c=>c.type==='strip').length,15);
  assert.equal(commands.filter(c=>c.type==='line').length,12);
  for(const c of commands){assert.ok(c.alpha>=0&&c.alpha<=1);assert.ok(c.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));}
  assert.notDeepEqual(commands,composeBackdrop(state(family),8,42,720,900));
 }
 assert.notDeepEqual(composeBackdrop(state('joy')),composeBackdrop(state('tension')));
 assert.deepEqual(composeBackdrop({visible:false}),[]);
});
test('background does not follow face position and its fixed buffers survive expression changes',()=>{
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
