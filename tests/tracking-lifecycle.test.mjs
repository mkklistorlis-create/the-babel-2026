import test from 'node:test';
import assert from 'node:assert/strict';
import {createTracker} from '../public/tracking.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const names = ['isSecureContext','navigator','Worker','createImageBitmap','setTimeout','clearTimeout','performance'];
  const previous = new Map(names.map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const workers = [], timers = new Map(), statuses = [], frames = [], bitmaps = [];
  let nextTimer = 0, cameraRequests = 0, stopped = 0, now = 1000;
  const cameraTrack = {stop(){stopped++;}};
  const stream = {getTracks:()=>[cameraTrack],getVideoTracks:()=>[cameraTrack]};
  const video = {readyState:2,currentTime:1,videoWidth:640,videoHeight:360,play:async()=>{},pause(){}};
  class Worker {
    constructor(){workers.push(this);this.messages=[];this.terminated=false;}
    terminate(){this.terminated=true;}
    postMessage(data){this.messages.push(data);if(data.type==='init')queueMicrotask(()=>this.emit({type:'ready'}));}
    emit(data){this.onmessage?.({data});}
  }
  const globals = {
    isSecureContext:true,navigator:{mediaDevices:{getUserMedia:async()=>{cameraRequests++;return stream;}}},Worker,performance:{now:()=>now},
    createImageBitmap:async()=>{const bitmap={closed:0,close(){this.closed++;}};bitmaps.push(bitmap);return bitmap;},
    setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},
    clearTimeout:id=>timers.delete(id),
  };
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const tracker=createTracker({video,onStatus:event=>statuses.push(event),onFrame:frame=>frames.push(frame)});
  return {tracker,workers,statuses,frames,video,bitmaps,
    get cameraRequests(){return cameraRequests;},get stopped(){return stopped;},
    async tick(ms=100){now+=ms;const entry=[...timers].find(([,timer])=>timer.ms===80);assert.ok(entry,'camera polling continues');timers.delete(entry[0]);video.currentTime+=ms/1000;entry[1].fn();await flush();},
    cleanup(){tracker.stop();for(const name of names){const descriptor=previous.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}},
  };
}
function result(people=[],extra={}) {
  return {type:'result',people,videoWidth:640,videoHeight:360,timestamp:performance.now(),latencyMs:25,faceCount:people.length,poseCount:people.length,observedPeopleCount:people.length,occupancy:people.length===1?'single':people.length>=2?'multiple':'empty',countGuardHealthy:true,countGuardAgeMs:0,...extra};
}
const person=x=>({bbox:{x:x-.1,y:.1,width:.2,height:.7},points:[{x:0,y:0},{x:1,y:0},{x:.5,y:1}],landmarks:[],faceCenter:{x,y:.2},faceSeen:true,mouthOpen:0,source:'foreground-segmentation'});

test('one camera keeps a single stable identity and color as the participant moves across the frame',async()=>{
  const h=harness();
  try{
    await h.tracker.start();await flush();
    const active=h.workers[0],warning={stage:'pose',message:'身体模型异常，继续使用同帧轮廓。'};
    active.emit(result([person(.25)],{warnings:[warning]}));
    const first=h.frames.at(-1).people[0];
    assert.equal(h.frames.at(-1).count,1);
    assert.equal(h.frames.at(-1).people.length,1);
    assert.equal(h.frames.at(-1).speechEligible,true);
    assert.deepEqual(h.frames.at(-1).trackingWarnings,[warning]);
    assert.equal(h.statuses.at(-1).state,'warning');
    assert.equal(h.workers.length,1);assert.equal(h.stopped,0);
    await h.tick();active.emit(result([person(.75)],{warnings:[warning]}));
    const moved=h.frames.at(-1).people[0];
    assert.equal(moved.id,first.id);assert.equal(moved.slot,0);assert.equal(moved.color,first.color);
    assert.ok(moved.bbox.x>.6,'whole-camera movement stays responsive');
  }finally{h.cleanup();}
});

test('a second person clears attribution immediately and return to one is confirmed for a second',async()=>{
  const h=harness();
  try{
    await h.tracker.start();await flush();const active=h.workers[0];
    active.emit(result([person(.4)]));assert.equal(h.frames.at(-1).speechEligible,true);
    await h.tick();active.emit(result([],{occupancy:'multiple',observedPeopleCount:2,faceCount:2}));
    assert.equal(h.frames.at(-1).count,0);assert.equal(h.frames.at(-1).occupancy,'multiple');
    assert.equal(h.frames.at(-1).speechEligible,false);assert.equal(h.stopped,0);
    for(let i=0;i<6;i++){
      await h.tick(200);active.emit(result([person(.5)]));
      if(i<5){assert.equal(h.frames.at(-1).occupancy,'multiple');assert.equal(h.frames.at(-1).count,0);}
    }
    assert.equal(h.frames.at(-1).occupancy,'single');assert.equal(h.frames.at(-1).count,1);
    assert.equal(h.frames.at(-1).speechEligible,true);assert.equal(h.frames.at(-1).people[0].slot,0);
  }finally{h.cleanup();}
});

test('brief detection loss holds the contour but never authorizes speech; an uncertain pose remains visual only',async()=>{
  const h=harness();
  try{
    await h.tracker.start();await flush();const active=h.workers[0];
    active.emit(result([person(.5)]));const id=h.frames.at(-1).people[0].id;
    await h.tick(100);active.emit(result());
    assert.equal(h.frames.at(-1).people[0].id,id);assert.equal(h.frames.at(-1).people[0].stale,true);
    assert.equal(h.frames.at(-1).people[0].faceSeen,false);assert.equal(h.frames.at(-1).speechEligible,false);
    await h.tick(450);active.emit(result());assert.equal(h.frames.at(-1).count,0);
    await h.tick();active.emit(result([person(.5)],{occupancy:'uncertain',faceCount:0}));
    assert.equal(h.frames.at(-1).count,1);assert.equal(h.frames.at(-1).speechEligible,false);
    await h.tick();active.emit(result([{...person(.5),faceSeen:false}],{faceCount:0}));
    assert.equal(h.frames.at(-1).speechEligible,true,'a fresh pose during a head turn needs no mouth threshold');
  }finally{h.cleanup();}
});

test('input ownership survives short visual misses but expires and cannot cross a multi-person boundary',async()=>{
  const h=harness();
  try{
    await h.tracker.start();await flush();const active=h.workers[0];
    active.emit(result([person(.5)]));const first=h.frames.at(-1);
    assert.equal(first.inputEligible,true);
    await h.tick(100);active.emit(result());
    assert.equal(h.frames.at(-1).speechEligible,false);assert.equal(h.frames.at(-1).inputEligible,true);
    assert.equal(h.frames.at(-1).ownershipEpoch,first.ownershipEpoch);
    await h.tick(600);active.emit(result([],{occupancy:'uncertain'}));
    assert.equal(h.frames.at(-1).inputEligible,true);assert.equal(h.frames.at(-1).inputEligibleUntil,first.inputEligibleUntil);
    await h.tick(201);active.emit(result());
    assert.equal(h.frames.at(-1).inputEligible,false);assert.ok(h.frames.at(-1).ownershipEpoch>first.ownershipEpoch);
    await h.tick();active.emit(result([person(.5)]));const renewed=h.frames.at(-1);
    assert.equal(renewed.inputEligible,true);
    await h.tick();active.emit(result([],{occupancy:'multiple',faceCount:2,observedPeopleCount:2}));
    assert.equal(h.frames.at(-1).inputEligible,false);assert.ok(h.frames.at(-1).ownershipEpoch>renewed.ownershipEpoch);
  }finally{h.cleanup();}
});

test('a failed count guard revokes input immediately and observable facial actions are smoothed without retaining stale actions',async()=>{
  const h=harness();
  try{
    await h.tracker.start();await flush();const active=h.workers[0];
    active.emit(result([{...person(.5),facialActions:{smile:0,jawOpen:0}}]));
    const epoch=h.frames.at(-1).ownershipEpoch;
    await h.tick();active.emit(result([{...person(.5),mouthOpen:.6,facialActions:{smile:1,jawOpen:.8}}]));
    const current=h.frames.at(-1).people[0];
    assert.ok(current.facialActions.smile>.4&&current.facialActions.smile<.8);
    assert.ok(current.mouthOpen>0,'mouth dynamics remain independent');
    await h.tick();active.emit(result([{...person(.5),faceSeen:false}],{occupancy:'uncertain',countGuardHealthy:false}));
    assert.equal(h.frames.at(-1).inputEligible,false);assert.ok(h.frames.at(-1).ownershipEpoch>epoch);
    assert.equal(h.frames.at(-1).people[0].facialActions,null);
  }finally{h.cleanup();}
});

test('a short pose miss retains body geometry and damps head jitter without altering raw coverage',async()=>{
  const h=harness();
  try{
    await h.tracker.start();await flush();const active=h.workers[0];
    const body=person(.5);active.emit(result([body]));
    const face={...person(.5005),source:'face-landmarks',bbox:{x:.45,y:.15,width:.1,height:.16}};
    await h.tick();active.emit(result([face]));
    const current=h.frames.at(-1).people[0];
    assert.equal(current.source,'foreground-segmentation');assert.equal(current.bbox.height,.7);
    assert.equal(current.faceCenter.x,.5,'tiny measured head noise is held');
    assert.equal(current.rawSource,'face-landmarks');assert.deepEqual(current.rawBBox,face.bbox);
    assert.equal(current.faceSeen,true);assert.equal(h.frames.at(-1).speechEligible,true);
  }finally{h.cleanup();}
});

test('fatal worker failure rebuilds once without reacquiring camera; stale bitmaps close',async()=>{
  const h=harness();
  try{
    await h.tracker.start();await flush();
    const old=h.workers[0];old.emit(result([person(.5)]));const ownerEpoch=h.frames.at(-1).ownershipEpoch;
    old.emit({type:'error',message:'Aborted at pose'});
    assert.equal(h.frames.at(-1).inputEligible,false,'recovery revokes audio ownership synchronously');
    assert.ok(h.frames.at(-1).ownershipEpoch>ownerEpoch);
    await flush();
    assert.equal(old.terminated,true);assert.equal(h.workers.length,2);
    assert.equal(h.cameraRequests,1);assert.equal(h.stopped,0);
    assert.ok(h.statuses.some(s=>s.state==='recovering'));
    assert.equal(h.statuses.at(-1).state,'ready');
    const stale={closed:0,close(){this.closed++;}};old.emit(result([],{matchedFrame:stale}));
    assert.equal(stale.closed,1);
    await h.tick();assert.ok(h.workers[1].messages.some(m=>m.type==='frame'));
    h.workers[1].emit(result());
    h.workers[1].emit({type:'error',message:'second failure'});await flush();
    assert.equal(h.workers.length,2,'no unbounded restart loop');
    assert.equal(h.stopped,1);assert.equal(h.statuses.at(-1).state,'error');
  }finally{h.cleanup();}
});

test('exiting during automatic recovery cannot reopen the camera or resume tracking',async()=>{
  const h=harness();
  try{
    await h.tracker.start();await flush();
    h.workers[0].emit({type:'error',message:'worker failure'});
    h.tracker.stop();await flush();
    assert.equal(h.cameraRequests,1);assert.equal(h.stopped,1);
    assert.ok(h.workers.every(w=>w.terminated));
    assert.equal(h.video.srcObject,null);assert.equal(h.statuses.at(-1).state,'off');
    assert.equal(h.frames.at(-1).count,0);
  }finally{h.cleanup();}
});

test('head attachment and two hands follow fresh observations and are suppressed during misses and multiple occupancy',async()=>{
 const h=harness();
 const hands=[.3,.7].map((x,i)=>({handedness:i?'Right':'Left',score:.9,palm:{x,y:.6,z:0},landmarks:Array.from({length:21},()=>({x,y:.6,z:0}))}));
 const measured={...person(.5),faceBBox:{x:.42,y:.1,width:.16,height:.24},faceAnchor:{x:.43,y:.11},headPose:{yaw:.2,pitch:.1,roll:.05},hands,facialActions:{eyeBlinkLeft:.9,eyeBlinkRight:.05}};
 try{
  await h.tracker.start();await flush();const active=h.workers[0];
  active.emit(result([measured]));const first=h.frames.at(-1).people[0];
  assert.equal(first.hands.length,2);assert.equal(first.hands[0].tip.x,.3);assert.equal(first.faceObservedAt,1000);assert.equal(first.headPose.yaw,.2);assert.equal(first.faceAnchor.x,.43);
  await h.tick();active.emit(result());const held=h.frames.at(-1).people[0];
  assert.deepEqual(held.hands,[]);assert.equal(held.headPose,null);assert.equal(held.faceAnchor,null);assert.equal(held.faceObservedAt,null);assert.equal(held.faceSeen,false);
  await h.tick();active.emit(result([measured]));const recovered=h.frames.at(-1).people[0];
  assert.equal(recovered.hands[0].id,first.hands[0].id);assert.equal(recovered.hands[0].breakTrail,true);assert.equal(recovered.faceObservedAt,1200);
  await h.tick();active.emit(result([],{occupancy:'multiple',faceCount:2,observedPeopleCount:2}));assert.equal(h.frames.at(-1).people.length,0);
 }finally{h.cleanup();}
});
