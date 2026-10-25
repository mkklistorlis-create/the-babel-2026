import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {MaskStabilizer} from '../public/mask-stability.js';
import {HandTrackFilter} from '../public/tracking-math.js';
import {SixSevenGestureTracker} from '../public/six-seven-gesture.js';
const source=readFileSync(new URL('../public/tracking-worker.js',import.meta.url),'utf8');
const context=vm.createContext({URL,self:{location:{href:'http://127.0.0.1/tracking-worker.js'}},performance});
vm.runInContext(source+'\nglobalThis.testFns={traceMask,copyConfidenceMask,unionPoseMasks};',context);
const {traceMask,copyConfidenceMask,unionPoseMasks}=context.testFns;

test('worker preserves offscreen finger geometry through filtering and six/seven activation',async()=>{
 let y=.1;
 const h=workerHarness({pose:poseModel(),face:faceModel(),foreground:foregroundModel(),hands:{detectForVideo(){
  return {landmarks:[.75,.25].map((x,n)=>Array.from({length:21},(_,i)=>({x,y:(n?.32-y:y)-([4,8,12,16,20].includes(i)?.3:0),z:-i*.001}))),
   handedness:[[{categoryName:'Left',score:.9}],[{categoryName:'Right',score:.9}]]};
 }}});
 const filter=new HandTrackFilter(),gesture=new SixSevenGestureTracker();
 await h.frame(1000);let raw=h.messages.at(-1).message.people[0].hands;
 assert.ok(raw[0].tip.y<0,'offscreen tip must retain its measured position');
 assert.equal(raw[0].landmarks[8].y,-.19999999999999998);
 gesture.update(filter.update(raw,1000),1000);
 y=.22;await h.frame(1300);raw=h.messages.at(-1).message.people[0].hands;
 assert.equal(gesture.update(filter.update(raw,1300),1300).latched,true);
 y=-.1;await h.frame(1600);raw=h.messages.at(-1).message.people[0].hands;
 assert.equal(raw.length,1,'offscreen palm is absent, never fabricated at the edge');
 const partial=gesture.update(filter.update(raw,1600),1600);
 assert.equal(partial.latched,true);assert.equal(partial.hands.length,1);
});
function mask(width,height,fill){const values=new Float32Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)values[y*width+x]=fill(x,y)?1:0;return {width,height,getAsFloat32Array:()=>values};}
test('contour uses the person seed rather than always selecting the largest body',()=>{
 const m=mask(100,100,(x,y)=>(x>5&&x<30&&y>10&&y<80)||(x>55&&x<95&&y>5&&y<90));
 const left=traceMask(m,{x:.15,y:.4}),right=traceMask(m,{x:.75,y:.4});
 assert.ok(left.bbox.x<.3);assert.ok(right.bbox.x>.5);
 assert.equal(left.points.length,320);assert.equal(right.points.length,320);
});
test('contour retains concave gaps and emits normalized detailed boundary',()=>{
 const m=mask(100,100,(x,y)=>x>10&&x<90&&y>10&&y<90&&!(x>35&&x<65&&y<60));
 const traced=traceMask(m,{x:.2,y:.6});assert.equal(traced.points.length,320);
 assert.ok(traced.points.some(p=>p.x>.3&&p.x<.7&&p.y>.5&&p.y<.7),'arm/torso concavity remains');
 assert.ok(traced.points.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1));
 assert.equal(traceMask(mask(40,40,()=>false)),null);
});
test('single-channel foreground confidence preserves both people and background without category-label ambiguity',()=>{
 const source=new Float32Array([0,.9,.1,0,.7,.2]);
 const m=copyConfidenceMask({width:6,height:1,getAsFloat32Array:()=>source});
 assert.equal(m.encoding,'probability32');assert.ok(Math.abs(m.data[1]-.9)<1e-6);assert.ok(Math.abs(m.data[4]-.7)<1e-6);assert.equal(m.complete,true);
 source.fill(0);assert.ok(m.data[1]>.89,'continuous probabilities copied before model callback memory expires');
});
test('pose union remains an incomplete measured fallback',()=>{
 const pose=unionPoseMasks([mask(5,5,(x,y)=>x===2&&y===2)],5,5);
 assert.equal(pose.complete,false);assert.equal(pose.data[12],1);
 assert.equal(pose.data[0],0);
});


function workerHarness(models){
 const messages=[];
 const context=vm.createContext({URL,performance,MaskStabilizer,console:{error(){}},self:{location:{href:'http://127.0.0.1/tracking-worker.js'},postMessage:(message,transfers)=>messages.push({message,transfers})}});
 vm.runInContext(source+`
globalThis.install=(m)=>{detector=m.pose;faceDetector=m.face;countDetector=m.count;handDetector=m.hands;backgroundSegmenter=m.foreground;maskStabilizer=new MaskStabilizer();};`,context);
 context.install({count:countModel(),...models});
 return {messages,context,frame:async(timestamp=1000,width=100,height=100)=>{const bitmap={width,height,closed:false,close(){this.closed=true;}};await context.self.onmessage({data:{type:'frame',bitmap,timestamp}});return bitmap;}};
}
function faceResult(count=1){
 const ovalIndices=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
 return {faceLandmarks:[.25,.75].slice(0,count).map(cx=>{
  const points=Array.from({length:478},()=>({x:cx,y:.25,z:0}));
  ovalIndices.forEach((id,i)=>{points[id]={x:cx+Math.cos(i/ovalIndices.length*Math.PI*2)*.08,y:.25+Math.sin(i/ovalIndices.length*Math.PI*2)*.12,z:0};});
  points[13]={x:cx,y:.27};points[14]={x:cx,y:.29};points[61]={x:cx-.04,y:.28};points[291]={x:cx+.04,y:.28};return points;
 })};
}
const fullForeground=()=>mask(100,100,(x,y)=>(x>10&&x<40&&y>12&&y<95)||(x>60&&x<90&&y>12&&y<95));
const faceModel=(count=1)=>({detectForVideo:()=>faceResult(count)});
const countResult=(count=1)=>({detections:Array.from({length:count},(_,i)=>({boundingBox:{originX:i*50+10,originY:10,width:25,height:30}}))});
const countModel=(count=1)=>({detectForVideo:()=>countResult(count)});
const foregroundModel=(makeMask=fullForeground)=>({segmentForVideo:(image,time,callback)=>callback({confidenceMasks:[makeMask()]})});
function singlePoseResult(){
 const landmarks=Array.from({length:33},()=>({x:.25,y:.4,visibility:.95}));landmarks[0]={x:.25,y:.25,visibility:.95};
 return {landmarks:[landmarks],segmentationMasks:[mask(100,100,(x,y)=>x>15&&x<35&&y>15&&y<85)]};
}
const poseModel=()=>({detectForVideo:(image,time,callback)=>callback(singlePoseResult())});
const emptyPose=()=>({detectForVideo:(image,time,callback)=>callback({landmarks:[],segmentationMasks:[]})});

test('single pose abort retires only that task and preserves measured single-person foreground and frame ownership',async()=>{
 let calls=0;
 const h=workerHarness({pose:{detectForVideo(){calls++;throw new Error('Aborted(native pose)');}},face:faceModel(),foreground:foregroundModel()});
 const bitmap=await h.frame();const {message,transfers}=h.messages.at(-1);
 assert.equal(message.type,'result');assert.equal(message.occupancy,'single');assert.equal(message.observedPeopleCount,1);assert.equal(message.people.length,1);
 assert.equal(message.people[0].source,'foreground-segmentation');assert.ok(message.people[0].bbox.height>.7);
 assert.equal(message.foregroundMask.complete,true);assert.equal(message.matchedFrame,bitmap);assert.equal(bitmap.closed,false);assert.ok(transfers.includes(bitmap));
 assert.ok(message.warnings.some(w=>w.stage==='pose'&&w.count===1));
 await h.frame(1500);assert.equal(calls,1);assert.equal(h.messages.at(-1).message.people.length,1);
});

test('separate two-face count guard suppresses attribution while main face landmarks remain single-person',async()=>{
 let calls=0,faces=2;
 const h=workerHarness({pose:{detectForVideo(image,time,cb){calls++;cb(singlePoseResult());}},face:faceModel(),count:{detectForVideo:()=>countResult(faces)},foreground:foregroundModel()});
 const bitmap=await h.frame();const {message}=h.messages.at(-1);
 assert.equal(message.occupancy,'multiple');assert.equal(message.observedPeopleCount,2);assert.equal(message.faceCount,1);assert.equal(message.people.length,0);assert.equal(calls,0);assert.equal(message.countGuardHealthy,true);
 assert.ok(message.warnings.some(w=>w.stage==='occupancy'));assert.equal(message.matchedFrame,bitmap);assert.equal(bitmap.closed,false);assert.equal(message.foregroundMask.complete,true);
 faces=1;await h.frame(1500);assert.equal(calls,1);assert.equal(h.messages.at(-1).message.people.length,1);
 assert.equal(h.messages.at(-1).message.occupancy,'single');
});

test('single silhouette consistently uses global-mask edges while pose only provides movement landmarks',async()=>{
 const h=workerHarness({pose:poseModel(),face:faceModel(),foreground:foregroundModel()});
 await h.frame();const p=h.messages.at(-1).message.people[0];
 assert.equal(p.source,'foreground-segmentation');assert.ok(p.bbox.width>.28);assert.equal(p.landmarks.length,33);assert.equal(p.faceSeen,true);
});

test('foreground abort degrades to a single measured face and marks mask incomplete without stopping camera',async()=>{
 let calls=0;
 const h=workerHarness({pose:emptyPose(),face:faceModel(),foreground:{segmentForVideo(){calls++;throw new Error('Aborted(mask)');}}});
 await h.frame();const {message}=h.messages.at(-1);
 assert.equal(message.type,'result');assert.equal(message.occupancy,'single');assert.equal(message.people.length,1);assert.equal(message.people[0].source,'face-landmarks');
 assert.equal(message.foregroundMask.complete,false);assert.ok(message.warnings.some(w=>w.stage==='foreground'));
 await h.frame(1500);assert.equal(calls,1);
});

test('unavailable separate count guard requests bounded recovery even while single-face and pose tasks survive',async()=>{
 const h=workerHarness({pose:poseModel(),face:faceModel(),count:{detectForVideo(){throw new Error('Aborted(count)');}},foreground:foregroundModel()});
 const bitmap=await h.frame();const {message}=h.messages.at(-1);
 assert.equal(message.type,'error');assert.equal(message.fatal,true);assert.equal(message.occupancy,'uncertain');
 assert.equal(message.stages.pose,true);assert.equal(message.stages.face,true);assert.equal(message.stages.count,false);assert.equal(message.countGuardHealthy,false);assert.equal(bitmap.closed,true);
 assert.ok(message.warnings.some(w=>w.stage==='occupancy'));
});

test('empty scene and foreground-without-person evidence have distinct non-attributable occupancy states',async()=>{
 const empty=workerHarness({pose:emptyPose(),face:faceModel(0),count:countModel(0),foreground:foregroundModel(()=>mask(20,20,()=>false))});
 await empty.frame();assert.equal(empty.messages.at(-1).message.occupancy,'empty');assert.equal(empty.messages.at(-1).message.people.length,0);
 const uncertain=workerHarness({pose:emptyPose(),face:faceModel(0),count:countModel(0),foreground:foregroundModel()});
 await uncertain.frame();assert.equal(uncertain.messages.at(-1).message.occupancy,'uncertain');assert.equal(uncertain.messages.at(-1).message.people.length,0);
});

test('invalid dimensions are skipped without a native call; losing both counting tasks requests explicit recovery',async()=>{
 let calls=0;const bad={detectForVideo(){calls++;throw new Error('Aborted');}};
 const h=workerHarness({pose:bad,face:bad,foreground:foregroundModel()});
 const badFrame=await h.frame(1000,NaN,100);assert.equal(badFrame.closed,true);assert.equal(calls,0);assert.equal(h.messages.at(-1).message.occupancy,'uncertain');
 const goodFrame=await h.frame(1500);assert.equal(h.messages.at(-1).message.type,'error');assert.equal(h.messages.at(-1).message.fatal,true);assert.equal(goodFrame.closed,true);
});

test('stage warning retains bounded native RET_CHECK context without object or image payloads',async()=>{
 const h=workerHarness({pose:null,face:faceModel(),foreground:foregroundModel()});
 vm.runInContext(`detector={detectForVideo(){console.error('RET_CHECK failure while processing pose', {secretFrame:'DO_NOT_CAPTURE'});throw new Error('Aborted');}};`,h.context);
 await h.frame();const warning=h.messages.at(-1).message.warnings.find(w=>w.stage==='pose');
 assert.ok(warning.nativeMessages.some(line=>line.includes('RET_CHECK')));
 assert.ok(warning.nativeMessages.every(line=>line.length<=500&&!line.includes('DO_NOT_CAPTURE')));
 assert.ok(warning.nativeMessages.length<=4);assert.match(warning.message,/单人人体分割/);
});

test('count guard runs at low frequency and suppresses attribution in the same frame as a second-face observation',async()=>{
 let calls=0,count=1;
 const h=workerHarness({pose:poseModel(),face:faceModel(),count:{detectForVideo(){calls++;return countResult(count);}},foreground:foregroundModel()});
 await h.frame(1000);assert.equal(calls,1);assert.equal(h.messages.at(-1).message.countGuardAgeMs,0);
 await h.frame(1100);assert.equal(calls,1);assert.equal(h.messages.at(-1).message.countGuardHealthy,true);assert.equal(h.messages.at(-1).message.countGuardAgeMs,100);
 count=2;await h.frame(1300);assert.equal(calls,2);assert.equal(h.messages.at(-1).message.occupancy,'multiple');assert.equal(h.messages.at(-1).message.people.length,0);
 await h.frame(1400);assert.equal(calls,2);assert.equal(h.messages.at(-1).message.occupancy,'multiple','cached positive count is not lost between guard checks');
});

test('single-face blendshapes become bounded observable actions and share the authoritative mask with contours',async()=>{
 const result=faceResult();result.faceBlendshapes=[{categories:[{categoryName:'mouthSmileLeft',score:.8},{categoryName:'mouthSmileRight',score:.6},{categoryName:'browInnerUp',score:.4},{categoryName:'jawOpen',score:2}]}];
 const h=workerHarness({pose:poseModel(),face:{detectForVideo:()=>result},foreground:foregroundModel()});
 const bitmap=await h.frame();const {message,transfers}=h.messages.at(-1);
 const p=message.people[0];assert.ok(Math.abs(p.facialActions.smile-.7)<1e-6);assert.equal(p.facialActions.browRaise,.4);assert.equal(p.facialActions.jawOpen,1);
 assert.deepEqual(Object.keys(p.facialActions).sort(),['browLower','browRaise','browRaiseLeft','browRaiseRight','eyeBlinkLeft','eyeBlinkRight','eyeSquint','eyeWide','jawOpen','mouthFrown','mouthPucker','smile',
  'eyeWideLeft','eyeWideRight','eyeSquintLeft','eyeSquintRight','eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight','eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight'].sort());
 assert.equal(message.foregroundMask.encoding,'alpha8');assert.equal(message.foregroundMask.authoritative,true);assert.equal(message.foregroundMask.data[40*100+25],255);
 assert.equal(message.matchedFrame,bitmap);assert.ok(transfers.includes(message.foregroundMask.data.buffer));assert.equal(bitmap.closed,false);
});

test('per-eye shape and gaze coefficients remain independent, bounded and separate from the mouth',async()=>{
 const samples={eyeWideLeft:.85,eyeWideRight:.15,eyeSquintLeft:.2,eyeSquintRight:.75,
  eyeLookInLeft:.05,eyeLookInRight:.8,eyeLookOutLeft:.9,eyeLookOutRight:.1,
  eyeLookUpLeft:.45,eyeLookUpRight:.5,eyeLookDownLeft:-.4,eyeLookDownRight:2};
 const result=faceResult();result.faceBlendshapes=[{categories:Object.entries(samples).map(([categoryName,score])=>({categoryName,score}))}];
 const h=workerHarness({pose:poseModel(),face:{detectForVideo:()=>result},foreground:foregroundModel()});
 await h.frame();const first=h.messages.at(-1).message.people[0].facialActions;
 for(const [key,value]of Object.entries(samples))assert.equal(first[key],Math.max(0,Math.min(1,value)));
 assert.equal(first.eyeWide,.5);assert.equal(first.eyeSquint,.475);assert.equal(first.jawOpen,0);assert.equal(first.smile,0);
 result.faceBlendshapes=[{categories:[{categoryName:'eyeLookInLeft',score:NaN},{categoryName:'eyeLookUpRight',score:Infinity},{categoryName:'eyeSquintRight',score:.8}]}];
 await h.frame(1400);const next=h.messages.at(-1).message.people[0].facialActions;
 assert.equal(next.eyeLookInLeft,0);assert.equal(next.eyeLookUpRight,0);assert.equal(next.eyeLookOutLeft,0,'missing coefficient does not reuse the earlier gaze');
 assert.equal(next.eyeSquintLeft,0);assert.equal(next.eyeSquintRight,.8);
 assert.ok(Object.values(next).every(Number.isFinite));
});

test('main face task failure does not poison the independent count guard or measured pose tracking',async()=>{
 const h=workerHarness({pose:poseModel(),face:{detectForVideo(){throw new Error('Aborted(face)');}},count:countModel(),foreground:foregroundModel()});
 await h.frame();const message=h.messages.at(-1).message;
 assert.equal(message.type,'result');assert.equal(message.countGuardHealthy,true);assert.equal(message.occupancy,'single');assert.equal(message.people.length,1);
 assert.equal(message.stages.face,false);assert.equal(message.stages.count,true);assert.equal(message.people[0].facialActions,undefined);
});

test('both measured hands are emitted in unmirrored camera coordinates and multiple occupancy skips hand inference',async()=>{
 let count=1,calls=0;
 const landmarks=[.2,.8].map(x=>Array.from({length:21},(_,i)=>({x:x+i*.001,y:.4+i*.002,z:-i*.001})));
 const h=workerHarness({pose:poseModel(),face:faceModel(),count:{detectForVideo:()=>countResult(count)},foreground:foregroundModel(),hands:{detectForVideo(){calls++;return {landmarks,handedness:[[{categoryName:'Left',score:.9}],[{categoryName:'Right',score:.8}]]};}}});
 await h.frame();const hands=h.messages.at(-1).message.people[0].hands;
 assert.equal(hands.length,2);assert.equal(hands[0].handedness,'Left');assert.equal(hands[0].tip.x,.20800000000000002);assert.equal(hands[1].wrist.x,.8);assert.equal(hands[0].timestamp,1000);
 landmarks[0][8].x=.99;assert.ok(hands[0].tip.x<.3,'copy survives result reuse');
 count=2;await h.frame(1400);assert.equal(calls,1);assert.equal(h.messages.at(-1).message.people.length,0);
});

test('hand task failure retires only hands and keeps face actions, complete mask, and camera ownership',async()=>{
 let calls=0;const h=workerHarness({pose:poseModel(),face:faceModel(),foreground:foregroundModel(),hands:{detectForVideo(){calls++;throw new Error('Aborted(hand)');}}});
 const bitmap=await h.frame();const message=h.messages.at(-1).message;
 assert.equal(message.occupancy,'single');assert.equal(message.people[0].hands.length,0);assert.equal(message.stages.hands,false);assert.equal(message.stages.face,true);assert.equal(message.foregroundMask.complete,true);assert.equal(message.matchedFrame,bitmap);
 assert.ok(message.warnings.some(w=>w.stage==='hands'));
 await h.frame(1400);assert.equal(calls,1);
});

test('fresh face matrix and unilateral blink coefficients survive foreground recovery',async()=>{
 const result=faceResult();const yaw=.4,c=Math.cos(yaw),s=Math.sin(yaw);
 result.facialTransformationMatrixes=[{rows:4,columns:4,data:[c,0,-s,0,0,1,0,0,s,0,c,0,0,0,-30,1]}];
 result.faceBlendshapes=[{categories:[{categoryName:'eyeBlinkLeft',score:.92},{categoryName:'eyeBlinkRight',score:.04}]}];
 const h=workerHarness({pose:emptyPose(),face:{detectForVideo:()=>result},foreground:foregroundModel()});
 await h.frame();const person=h.messages.at(-1).message.people[0];
 assert.ok(Math.abs(person.headPose.yaw+.4)<1e-8,'one mirror reverses yaw');assert.ok(Math.abs(person.headPose.pitch)<1e-8);assert.ok(Math.abs(person.headPose.roll)<1e-8);
 assert.equal(person.facialActions.eyeBlinkLeft,.92);assert.equal(person.facialActions.eyeBlinkRight,.04);assert.ok(Number.isFinite(person.faceAnchor.x)&&Number.isFinite(person.faceAnchor.y));
});
