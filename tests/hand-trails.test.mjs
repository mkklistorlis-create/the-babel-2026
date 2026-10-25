import test from 'node:test';
import assert from 'node:assert/strict';
import {HandTrailTracker} from '../public/hand-trails.js';

const hand=(id,x,y,t,extra={})=>({id,tip:{x,y},timestamp:t,handedness:id==='a'?'Left':'Right',...extra});

test('two crossing hands preserve independent unmirrored trajectories',()=>{
  const tracker=new HandTrailTracker();
  for(let n=0;n<=8;n++)tracker.update([hand('a',.2+n*.075,.3,100+n*40),hand('b',.8-n*.075,.6,100+n*40)],100+n*40);
  const [a,b]=tracker.strokes;
  assert.equal(tracker.strokes.length,2);
  assert.equal(a.handId,'a');assert.equal(a.handedness,'Left');
  assert.equal(b.handId,'b');assert.equal(b.handedness,'Right');
  assert.ok(a.points.at(-1).x>.7);assert.ok(b.points.at(-1).x<.3);
  assert.ok(a.points.every(point=>point.y===.3));assert.ok(b.points.every(point=>point.y===.6));
});

test('duplicate cached frames do not append or refresh points, including first-frame break flag',()=>{
  const tracker=new HandTrailTracker();
  const first=hand('a',.2,.3,100,{breakTrail:true});
  for(let now=100;now<=280;now+=20)tracker.update([first],now);
  assert.equal(tracker.strokes.length,1);assert.equal(tracker.strokes[0].points.length,1);
  assert.equal(tracker.strokes[0].points[0].t,100);
  tracker.update([first],1100);assert.equal(tracker.strokes.length,0);
});

test('missed, discontinuous, explicit-break and delayed hands start new strokes without bridges',()=>{
  const tracker=new HandTrailTracker();
  tracker.update([hand('a',.2,.3,100)],100);
  tracker.update([hand('a',.25,.3,140)],140);
  tracker.update([],160);
  tracker.update([hand('a',.26,.3,180)],180);
  assert.deepEqual(tracker.strokes.map(stroke=>stroke.points.length),[2,1]);
  tracker.update([hand('a',.8,.3,220)],220);
  tracker.update([hand('a',.81,.3,260,{breakTrail:true})],260);
  tracker.update([hand('a',.82,.3,820)],820);
  assert.equal(tracker.strokes.length,5);
  assert.ok(tracker.strokes.slice(1).every(stroke=>stroke.points.length===1));
});

test('disabling and ownership changes discard previous participant ink immediately',()=>{
  const tracker=new HandTrailTracker();
  tracker.update([hand('a',.2,.3,100)],100,{owner:1});
  tracker.update([hand('a',.3,.3,140)],140,{owner:1});
  tracker.update([hand('b',.8,.6,180)],180,{owner:2});
  assert.equal(tracker.strokes.length,1);assert.equal(tracker.strokes[0].handId,'b');
  assert.deepEqual(tracker.update([hand('b',.7,.6,220)],220,{owner:2,enabled:false}),[]);
  tracker.update([hand('a',.4,.4,260)],260,{owner:3});assert.equal(tracker.strokes[0].points.length,1);
});

test('trails fade by first accepted display time and expire after lifetime',()=>{
  const tracker=new HandTrailTracker({lifetimeMs:900});
  tracker.update([hand('a',.2,.3,100)],100);
  tracker.update([hand('a',.3,.3,200)],200);
  tracker.update([],1001);
  assert.equal(tracker.strokes.length,1);assert.equal(tracker.strokes[0].points.length,1);
  assert.equal(tracker.strokes[0].points[0].t,200);
  assert.deepEqual(tracker.update([],1101),[]);
});

test('invalid or stale observations cannot draw; backwards observations cannot move the tip',()=>{
  const tracker=new HandTrailTracker();
  const invalid=[hand('a',NaN,.2,100),hand('b',2,.2,100)];
  assert.deepEqual(tracker.update(invalid,100),[]);
  assert.deepEqual(tracker.update([hand('a',.2,.3,1)],1000),[]);
  assert.deepEqual(tracker.update([hand('a',.2,.3,2000)],1000),[]);
  tracker.update([hand('a',.2,.3,1000)],1000);
  tracker.update([hand('a',.6,.3,950)],1020);
  assert.equal(tracker.strokes[0].points.length,1);assert.equal(tracker.strokes[0].points[0].x,.2);
});

test('realistic CPU delays retain visible connected ink while duplicate arrivals cannot prolong it',()=>{
  const tracker=new HandTrailTracker();
  tracker.update([hand('a',.2,.3,100)],400); // Captured 300 ms before inference completed.
  tracker.update([hand('a',.3,.3,350)],650); // 250 ms sample spacing, same inference delay.
  assert.equal(tracker.strokes.length,1);
  assert.deepEqual(tracker.strokes[0].points.map(point=>point.t),[400,650]);
  assert.equal(tracker.strokes[0].points.length,2);
  for(let now=700;now<=1100;now+=100)tracker.update([hand('a',.3,.3,350)],now);
  assert.deepEqual(tracker.strokes[0].points.map(point=>point.t),[400,650]);
  tracker.update([],1351);
  assert.deepEqual(tracker.strokes[0].points.map(point=>point.t),[650]);
  assert.deepEqual(tracker.update([],1601),[]);
});

test('bounded histories survive long sessions and repeated hand identities',()=>{
  const tracker=new HandTrailTracker({maxPoints:8,maxStrokes:4});
  for(let i=0;i<100;i++)tracker.update([hand('a',.2+i*.002,.3,100+i*10)],100+i*10);
  assert.ok(tracker.strokes[0].points.length<=8);
  for(let i=0;i<30;i++)tracker.update([hand(`id${i}`,.5,.4,1100+i*10)],1100+i*10);
  assert.ok(tracker.strokes.length<=4);
  tracker.update([],3000);assert.deepEqual(tracker.strokes,[]);
  assert.equal(tracker._seen.size,0);
});

test('tiny stationary jitter cannot produce a scribble',()=>{
  const tracker=new HandTrailTracker();
  for(let i=0;i<20;i++)tracker.update([hand('a',.5+(i%2)*.0002,.4,100+i*30)],100+i*30);
  assert.equal(tracker.strokes.length,1);assert.equal(tracker.strokes[0].points.length,1);
  assert.equal(tracker.strokes[0].points[0].x,.5);
  assert.equal(tracker.strokes[0].points[0].t,670);
});
