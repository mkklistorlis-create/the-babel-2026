import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {HandTrackFilter,HeadPoseFilter,smoothFacialActions} from '../public/tracking-math.js';
import {createExpressionTracker} from '../public/expressions.js';
import {Matrix4,Euler,Vector3} from '../public/vendor/three.module.js';

const hand=(x,handedness='Left')=>({handedness,score:.95,palm:{x,y:.5,z:0},landmarks:Array.from({length:21},(_,i)=>({x:x+(i%4)*.005,y:.5+Math.floor(i/4)*.006,z:-i*.001}))});
test('two-hand identities survive detection reorder and spatial crossing',()=>{
 const filter=new HandTrackFilter();
 const first=filter.update([hand(.35,'Left'),hand(.65,'Right')],1000);
 const next=filter.update([hand(.61,'Right'),hand(.39,'Left')],1100);
 assert.equal(next[0].id,first[1].id);assert.equal(next[1].id,first[0].id);assert.ok(next.every(h=>!h.breakTrail));
 filter.update([hand(.48,'Left'),hand(.52,'Right')],1200);
 const crossed=filter.update([hand(.48,'Right'),hand(.52,'Left')],1300);
 assert.equal(crossed[0].id,first[1].id);assert.equal(crossed[1].id,first[0].id);
});
test('missing hand emits no fabricated position and reacquisition breaks its stroke',()=>{
 const filter=new HandTrackFilter(),first=filter.update([hand(.3)],1000)[0];
 assert.equal(first.breakTrail,true);assert.deepEqual(filter.update([],1100),[]);
 const next=filter.update([hand(.32)],1200)[0];assert.equal(next.id,first.id);assert.equal(next.breakTrail,true);
 filter.update([],1300);const late=filter.update([hand(.32)],1800)[0];assert.notEqual(late.id,first.id);assert.equal(late.breakTrail,true);
 filter.reset();const restarted=filter.update([hand(.32)],1900)[0];assert.notEqual(restarted.id,late.id);
});
test('single-frame hand label jitter does not switch its persistent visual identity',()=>{
 const filter=new HandTrackFilter();const first=filter.update([hand(.35,'Left'),hand(.65,'Right')],1000);
 const swapped=filter.update([hand(.36,'Right'),hand(.64,'Left')],1100);
 assert.equal(swapped[0].id,first[0].id);assert.equal(swapped[0].handedness,'Left');assert.equal(swapped[1].id,first[1].id);
});
test('continuous measured hand strokes survive 3–5 Hz CPU inference but break on real gaps and jumps',()=>{
 for(const interval of [200,334,550]){
  const filter=new HandTrackFilter();let now=1000;
  const first=filter.update([hand(.3)],now)[0];
  for(let i=1;i<=3;i++){
   now+=interval;const current=filter.update([hand(.3+i*.025)],now)[0];
   assert.equal(current.id,first.id);assert.equal(current.breakTrail,false,`${interval}ms continuous observation`);
  }
  now+=interval;filter.update([],now);
  now+=interval;const afterMiss=filter.update([hand(.4)],now)[0];assert.equal(afterMiss.breakTrail,true,'explicit absence always breaks stroke');
 }
 const filter=new HandTrackFilter();const first=filter.update([hand(.3)],1000)[0];
 const late=filter.update([hand(.31)],1551)[0];assert.notEqual(late.id,first.id);assert.equal(late.breakTrail,true);
 const jump=filter.update([hand(.98)],1800)[0];assert.notEqual(jump.id,late.id);assert.equal(jump.breakTrail,true);
});
test('invalid hand data is rejected and hand filter copies landmark arrays',()=>{
 const filter=new HandTrackFilter(),sample=hand(.4),out=filter.update([sample],1000)[0];
 sample.landmarks[8].x=.9;assert.ok(out.tip.x<.5);assert.ok(out.landmarks[8].x<.5);
 assert.deepEqual(filter.update([{...hand(.5),landmarks:[{x:NaN,y:.3,z:0}]}],1100),[]);
});
test('face pose filter rejects isolated jumps, accepts a sustained turn, and clears missing evidence',()=>{
 const filter=new HeadPoseFilter();filter.update({yaw:0,pitch:0,roll:0});
 assert.equal(filter.update({yaw:1,pitch:0,roll:0}).yaw,0);
 assert.equal(filter.update({yaw:.001,pitch:.001,roll:.001}).yaw,0);
 assert.equal(filter.update({yaw:1,pitch:0,roll:0}).yaw,0);
 assert.ok(filter.update({yaw:1.03,pitch:.01,roll:0}).yaw>.65);
 assert.equal(filter.update(null),null);assert.equal(filter.update({yaw:.2,pitch:0,roll:0}).yaw,.2);
});
test('unilateral blink coefficients remain distinct after temporal smoothing',()=>{
 const first=smoothFacialActions(null,{eyeBlinkLeft:.9,eyeBlinkRight:.05});
 const next=smoothFacialActions(first,{eyeBlinkLeft:.95,eyeBlinkRight:.08},.1);
 assert.ok(next.eyeBlinkLeft>.9);assert.ok(next.eyeBlinkRight<.1);
});
const source=readFileSync(new URL('../public/tracking-worker.js',import.meta.url),'utf8');
const context=vm.createContext({URL,performance,console:{error(){}},self:{location:{href:'http://localhost/tracking-worker.js'}}});
vm.runInContext(source+'\nglobalThis.pose=headPoseFromMatrix;globalThis.actions=facialActions;',context);
test('native eye categories drive expression changes through both smoothing stages at 333ms samples with a still mouth',()=>{
 const tracker=createExpressionTracker();let filtered=null,now=0,result;
 const advance=(eyeValues,samples=6,headPose={yaw:0,pitch:0,roll:0})=>{
  for(let i=0;i<samples;i++){
   const measured={jawOpen:.02,mouthSmileLeft:.02,mouthSmileRight:.02,...eyeValues};
   const categories=Object.entries(measured).map(([categoryName,score])=>({categoryName,score}));
   filtered=smoothFacialActions(filtered,context.actions(categories),.333);
   result=tracker.update({faceSeen:true,stale:false,faceObservedAt:now,headPose,facialActions:filtered},now,{owner:'eye-pipeline'});
   assert.equal(filtered.jawOpen,.02);assert.equal(filtered.smile,.02);now+=333;
  }
  return result;
 };
 assert.equal(advance({eyeWideLeft:.8,eyeWideRight:.8}).id,'raised-eyes');
 assert.equal(advance({eyeSquintLeft:.8,eyeSquintRight:.8}).id,'eyes-narrow');
 assert.equal(advance({eyeSquintLeft:.85,eyeSquintRight:.05}).id,'one-eye-squint');
 assert.equal(advance({eyeLookOutLeft:.85,eyeLookInRight:.85}).id,'gaze-side');
 assert.equal(advance({eyeLookUpLeft:.85,eyeLookUpRight:.85}).id,'gaze-up');
 const up={eyeLookUpLeft:.85,eyeLookUpRight:.85};
 assert.equal(advance({...up,eyeBlinkLeft:.98,eyeBlinkRight:.98},1).id,'gaze-up','one blink observation cannot establish a closed-eye shape');
 assert.equal(advance(up).id,'gaze-up');
 assert.equal(advance({...up,eyeBlinkLeft:.98,eyeBlinkRight:.98}).id,'eyes-closed');
 assert.equal(advance({eyeLookOutLeft:.9,eyeLookInRight:.9},6,{yaw:.9,pitch:0,roll:0}).id,'neutral');
 assert.equal(advance({eyeLookOutLeft:.9}).id,'neutral','one eye without the matching anatomical pair cannot establish side gaze');
 assert.equal(advance({}).id,'neutral');
});
test('face matrix extraction removes scale and preserves projected roll in the mirrored Y-down scene',()=>{
 const a=.3,c=Math.cos(a)*2,s=Math.sin(a)*2;
 const pose=context.pose({data:[c,s,0,0,-s,c,0,0,0,0,2,0,3,4,-50,1]});
 assert.ok(Math.abs(pose.roll-.3)<1e-8);assert.ok(Math.abs(pose.yaw)<1e-8);assert.ok(Math.abs(pose.pitch)<1e-8);
 assert.equal(context.pose({data:Array(16).fill(0)}),null);assert.equal(context.pose(null),null);
});
test('rendered attachment basis follows actual projected face edges for combined head rotations',()=>{
 const displayBasis=new Matrix4().makeScale(-1,-1,1);
 for(const [pitch,yaw,roll] of [[0,0,.3],[.25,0,0],[0,-.4,0],[.2,-.35,.3]]){
  const metricRotation=new Matrix4().makeRotationFromEuler(new Euler(pitch,yaw,roll,'XYZ'));
  const pose=context.pose({data:metricRotation.elements});
  const rendered=new Matrix4().makeRotationFromEuler(new Euler(pose.pitch,pose.yaw,pose.roll,'XYZ'));
  // Convert a displayed local edge back to metric coordinates, rotate the
  // actual face, then apply camera Y-flip and selfie X-mirror. Compare that
  // projected edge with the actual Three.js attachment rotation, not signs.
  for(const edge of [new Vector3(1,0,0),new Vector3(0,1,0)]){
   const actual=edge.clone().applyMatrix4(displayBasis).applyMatrix4(metricRotation).applyMatrix4(displayBasis);
   const attachment=edge.clone().applyMatrix4(rendered);
   assert.ok(actual.distanceTo(attachment)<1e-8,`attachment edge follows face at ${pitch},${yaw},${roll}`);
  }
 }
 const faceEdge=new Vector3(1,0,0).applyMatrix4(new Matrix4().makeRotationZ(.3)).applyMatrix4(displayBasis);
 const pose=context.pose({data:new Matrix4().makeRotationZ(.3).elements});
 const clipEdge=new Vector3(1,0,0).applyEuler(new Euler(pose.pitch,pose.yaw,pose.roll,'XYZ'));
 assert.ok(Math.abs(faceEdge.y/faceEdge.x-clipEdge.y/clipEdge.x)<1e-8,'projected eye line and clip have identical screen slope');
});
