import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import {FingertipInk} from '../public/fingertip-ink.js';
import {HandTrailTracker} from '../public/hand-trails.js';

const projection={point:(x,y)=>({x:(1-x)*1280,y:y*720})};
const settings={viewport:{width:1280,height:720}};
const hand=(t,x,y=.5)=>({id:'left',handedness:'Left',timestamp:t,tip:{x,y},wrist:{x:.9,y:.9}});

test('only the measured fingertip drives cobalt marks; camera/body assets are not introduced',()=>{
 const scene=new THREE.Scene(),ink=new FingertipInk(scene),tracker=new HandTrailTracker();
 try{
  tracker.update([hand(100,.2)],100);ink.update(tracker.update([hand(200,.28)],200),projection,200,settings);
  assert.equal(ink.stats.strokeCount,1);assert.ok(ink.stats.vertices>0);
  assert.equal(scene.children.length,1);assert.equal(ink.group.children.length,3);
  for(const layer of ink.layers){
   assert.equal(layer.material.uniforms.uAdaptive.value,0,'ink never depends on the removed poster block');
   for(let i=0;i<layer.count;i++){const x=layer.positions[i*3],y=layer.positions[i*3+1];assert.ok(x>880&&x<1040);assert.ok(y>340&&y<380);}
  }
 }finally{ink.dispose();}
 assert.equal(scene.children.length,0);
});

test('expiry, disable and malformed input clear strokes; pause preserves current geometry',()=>{
 const ink=new FingertipInk(new THREE.Scene()),tracker=new HandTrailTracker();
 try{
  tracker.update([hand(100,.2)],100);const strokes=tracker.update([hand(200,.28)],200);
  ink.update(strokes,projection,200,settings);const before=ink.stats.vertices;
  ink.update([],projection,1200,{...settings,paused:true});assert.equal(ink.stats.vertices,before);
  ink.update(strokes,projection,1200,settings);assert.equal(ink.stats.vertices,0);
  ink.update(strokes,projection,200,settings);ink.update(strokes,projection,200,{...settings,enabled:false});assert.equal(ink.stats.vertices,0);
  ink.update([{...strokes[0],points:[{x:.2,y:.5,t:100},{x:NaN,y:.5,t:150},{x:.28,y:.5,t:200}]}],projection,200,settings);
  assert.equal(ink.stats.vertices,0);
 }finally{ink.dispose();}
});

test('dense input stays bounded and independent hand identities retain distinct path styles',()=>{
 const ink=new FingertipInk(new THREE.Scene());
 try{
  const strokes=Array.from({length:30},(_,i)=>({handId:i%2?'right':'left',handedness:i%2?'Right':'Left',points:Array.from({length:1000},(_,j)=>({x:.2+j/2000,y:.4+Math.sin(j/20)*.025,t:100+j*.5}))}));
  ink.update(strokes,projection,600,settings);
  assert.ok(ink.stats.strokeCount<=12);assert.deepEqual(new Set(ink.stats.handIds),new Set(['left','right']));
  assert.ok(ink.detail.count>0);assert.ok(ink.blue.count>ink.detail.count);
  for(const layer of ink.layers){assert.ok(layer.count<=65520);assert.equal(layer.count%3,0);assert.ok(layer.capacity<=65520);}
 }finally{ink.dispose();}
});
