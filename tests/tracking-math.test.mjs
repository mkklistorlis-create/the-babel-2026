import test from 'node:test';
import assert from 'node:assert/strict';
import {alignContour,stabilizeContour,smoothBBox,RobustPointFilter,SinglePersonGate,InputOwnershipGate,smoothFacialActions} from '../public/tracking-math.js';
const contour=(n=320)=>Array.from({length:n},(_,i)=>{const a=i/n*Math.PI*2,r=.35+Math.sin(5*a)*.055+Math.cos(3*a)*.023;return{x:.5+Math.cos(a)*r,y:.5+Math.sin(a)*r};});
const error=(a,b)=>a.reduce((s,p,i)=>s+Math.hypot(p.x-b[i].x,p.y-b[i].y),0)/a.length;

test('closed contour alignment removes shifted start and reversed winding without removing detail',()=>{
 const base=contour();const shifted=[...base.slice(91),...base.slice(0,91)].reverse();
 const aligned=alignContour(base,shifted);
 assert.equal(aligned.length,320);assert.ok(error(base,aligned)<1e-9);
});

test('stationary subpixel jitter freezes, stronger noise is damped and local motion stays responsive',()=>{
 const base=contour();
 const tiny=base.map((p,i)=>({x:p.x+Math.sin(i)*.0008,y:p.y+Math.cos(i)*.0008}));
 assert.ok(error(base,stabilizeContour(base,tiny,.1))<1e-10);
 const noisy=base.map((p,i)=>({x:p.x+Math.sin(i*7)*.008,y:p.y+Math.cos(i*11)*.008}));
 const stable=stabilizeContour(base,noisy,.1);
 assert.ok(error(base,stable)<error(base,noisy)*.85);
 assert.equal(stable.length,base.length);
 // A locally moving hand is preserved rather than averaged into a convex hull.
 const moved=base.map((p,i)=>({x:p.x+(i>=65&&i<90?.12:0),y:p.y}));
 const response=stabilizeContour(base,moved,.1);
 assert.ok(response[76].x-base[76].x>.09);
});

test('bbox noise is held but a real translation follows quickly',()=>{
 const b={x:.1,y:.2,width:.3,height:.5};
 assert.deepEqual(smoothBBox(b,{x:.1005,y:.1995,width:.3005,height:.5}),b);
 const moved=smoothBBox(b,{...b,x:.22},.1);
 assert.ok(moved.x>.21&&moved.x<.22);
});

test('face anchor jitter is damped and isolated jumps are rejected before accepting coherent movement',()=>{
 const filter=new RobustPointFilter();
 const head={x:.5,y:.2};
 filter.update(head,.1);
 assert.deepEqual(filter.update({x:.5007,y:.1993},.1),head);
 const noisy={x:.506,y:.196},damped=filter.update(noisy,.1);
 assert.ok(Math.hypot(damped.x-head.x,damped.y-head.y)<Math.hypot(noisy.x-head.x,noisy.y-head.y)*.75);
 assert.deepEqual(filter.update({x:.91,y:.65},.1),damped,'one bad landmark cannot fling the anchor');
 assert.equal(filter.accepted,false);
 const returned=filter.update(head,.1);assert.ok(Math.hypot(returned.x-head.x,returned.y-head.y)<.006);
 const held=filter.update({x:.65,y:.3},.1);assert.deepEqual(held,returned);
 const moved=filter.update({x:.651,y:.301},.1);
 assert.ok(moved.x>.64&&moved.y>.29);
});

test('continuous fast movement passes the point filter after one corroborating frame',()=>{
 const filter=new RobustPointFilter();filter.update({x:.2,y:.2},.1);
 assert.equal(filter.update({x:.3,y:.2},.1).x,.2);
 assert.ok(filter.update({x:.4,y:.2},.1).x>.38);
 assert.ok(filter.update({x:.5,y:.2},.1).x>.47);
});

test('input ownership survives brief misses without renewing its deadline or changing epoch',()=>{
 const gate=new InputOwnershipGate();
 const first=gate.update({occupancy:'single',observedPeopleCount:1,countGuardHealthy:true,fresh:true,now:1000});
 assert.equal(first.inputEligible,true);assert.equal(first.inputEligibleUntil,1900);
 const missed=gate.update({occupancy:'uncertain',countGuardHealthy:true,now:1500});
 assert.deepEqual(missed,first);
 assert.equal(gate.update({occupancy:'empty',countGuardHealthy:true,now:1899}).inputEligible,true);
 const expired=gate.update({occupancy:'empty',countGuardHealthy:true,now:1900});
 assert.equal(expired.inputEligible,false);assert.ok(expired.ownershipEpoch>first.ownershipEpoch);
 const renewed=gate.update({occupancy:'single',observedPeopleCount:1,countGuardHealthy:true,fresh:true,now:2000});
 assert.equal(renewed.inputEligible,true);assert.ok(renewed.ownershipEpoch>expired.ownershipEpoch);
});

test('multiple people, guard failure, and old frame evidence revoke input ownership immediately',()=>{
 const gate=new InputOwnershipGate();
 const single=now=>gate.update({occupancy:'single',observedPeopleCount:1,countGuardHealthy:true,fresh:true,now});
 let epoch=single(1000).ownershipEpoch;
 const blocked=gate.update({occupancy:'multiple',observedPeopleCount:2,countGuardHealthy:true,now:1010});
 assert.equal(blocked.inputEligible,false);assert.ok(blocked.ownershipEpoch>epoch);
 epoch=single(2000).ownershipEpoch;
 const failed=gate.update({occupancy:'single',observedPeopleCount:1,countGuardHealthy:false,fresh:true,now:2010});
 assert.equal(failed.inputEligible,false);assert.ok(failed.ownershipEpoch>epoch);
 assert.equal(gate.update({occupancy:'single',observedPeopleCount:1,countGuardHealthy:true,fresh:true,observedAt:2000,now:3000}).inputEligible,false,'stale model output does not grant a new lease');
});

test('facial action coefficients are bounded and smoothed independently of mouth motion',()=>{
 const base=smoothFacialActions(null,{smile:0,browRaise:0,jawOpen:0});
 const next=smoothFacialActions(base,{smile:1,browRaise:.8,jawOpen:1,eyeWide:7,mouthPucker:-1},.1);
 assert.ok(next.smile>.4&&next.smile<.8);assert.ok(next.browRaise<.8);
 assert.ok(Object.values(next).every(value=>value>=0&&value<=1));
 assert.equal(next.mouthPucker,0);assert.equal(smoothFacialActions(next,null),null);
});

test('per-eye gaze and eyelid channels survive smoothing without bilateral averaging or invalid spikes',()=>{
 const base=smoothFacialActions(null,{eyeWideLeft:.8,eyeWideRight:.1,eyeSquintLeft:.05,eyeSquintRight:.7,
  eyeLookOutLeft:.8,eyeLookInRight:.75,eyeLookInLeft:.05,eyeLookOutRight:.1,
  eyeLookUpLeft:.3,eyeLookUpRight:.4,eyeLookDownLeft:.1,eyeLookDownRight:.2,jawOpen:0,smile:0});
 const next=smoothFacialActions(base,{...base,eyeWideLeft:.9,eyeSquintRight:.9,eyeLookOutLeft:1,eyeLookInRight:1},.1);
 assert.ok(next.eyeWideLeft>.8&&next.eyeWideLeft<.9);assert.equal(next.eyeWideRight,.1);
 assert.ok(next.eyeSquintRight>.7);assert.equal(next.eyeSquintLeft,.05);
 assert.ok(next.eyeLookOutLeft>.8);assert.ok(next.eyeLookInRight>.75);
 assert.equal(next.eyeLookInLeft,.05);assert.equal(next.eyeLookOutRight,.1);
 for(const key of ['eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight'])assert.equal(next[key],base[key]);
 assert.equal(next.jawOpen,0);assert.equal(next.smile,0);
 const invalid=smoothFacialActions(null,{eyeLookOutLeft:Infinity,eyeLookInRight:NaN,eyeWideLeft:-10,eyeSquintRight:10});
 assert.equal(invalid.eyeLookOutLeft,0);assert.equal(invalid.eyeLookInRight,0);assert.equal(invalid.eyeWideLeft,0);assert.equal(invalid.eyeSquintRight,1);
 assert.equal(invalid.eyeLookUpLeft,0);assert.equal(smoothFacialActions(next,null),null);
 let missing=next;for(let i=0;i<12;i++)missing=smoothFacialActions(missing,{},.1);
 assert.ok(missing.eyeLookOutLeft<.001,'missing eye measurements decay instead of keeping an old gaze');
});

test('a second person blocks immediately and one-person recovery needs sustained distinct evidence',()=>{
 const gate=new SinglePersonGate();
 assert.equal(gate.update('single',1,0),'single');
 assert.equal(gate.update('multiple',2,100),'multiple');
 assert.equal(gate.update('single',1,200),'multiple');
 assert.equal(gate.update('single',1,700),'multiple');
 assert.equal(gate.update('single',1,1200),'single');
 assert.equal(gate.update('single',2,1300),'multiple','count overrides an inconsistent single label');
 assert.equal(gate.update('single',1,1400),'multiple');
 for(let i=0;i<4;i++)assert.equal(gate.update('single',1,2400),'multiple','same timestamp is one observation');
 assert.equal(gate.update('single',1,2500),'single');
});

test('uncertain and empty evidence reset multi-person recovery rather than silently authorizing speech',()=>{
 const gate=new SinglePersonGate();
 assert.equal(gate.update('empty',0,0),'empty');
 assert.equal(gate.update('uncertain',1,100),'uncertain');
 gate.update('multiple',2,200);gate.update('single',1,300);gate.update('single',1,800);
 assert.equal(gate.update('uncertain',1,1000),'multiple');
 assert.equal(gate.update('single',1,1300),'multiple');
 assert.equal(gate.update('single',1,1800),'multiple');
 assert.equal(gate.update('single',1,2300),'single');
});
