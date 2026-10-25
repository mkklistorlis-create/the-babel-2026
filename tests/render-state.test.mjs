import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import {DuetCanvas,getDemoPeople,cameraProjection,hairclipPlacement,mosaicFragmentShader} from '../public/duet-canvas.js';
import {HandTrailTracker} from '../public/hand-trails.js';
import {ParticleMotion} from '../public/particle-motion.js';
import {FingertipInk} from '../public/fingertip-ink.js';
import {SixSevenOverlay} from '../public/six-seven-overlay.js';
import {AffectBackdrop} from '../public/affect-backdrop.js';

// These exercise actual scene state and sampling math, with GPU rendering
// stubbed. Physical-camera and WebGL shader validation remain separate checks.
function harness(){
 const original=globalThis.document,originalPath=globalThis.Path2D;
 globalThis.Path2D=class{};
 globalThis.document={createElement(){const canvas={width:0,height:0};canvas.getContext=()=>({scale(){},translate(){},transform(){},save(){},restore(){},stroke(){},fill(){},clearRect(){},fillText(){},drawImage(){},getImageData(){return {data:new Uint8ClampedArray(canvas.width*canvas.height*4).fill(128)};}});return canvas;}};
 const r=Object.create(DuetCanvas.prototype),mesh=()=>new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({transparent:true}));
 const clipMesh=mesh(),group=new THREE.Group();group.add(clipMesh);
 Object.assign(r,{width:1440,height:900,reducedMotion:false,scene:new THREE.Scene(),camera:new THREE.OrthographicCamera(),renderer:{render(){}},
  particleMotion:new ParticleMotion(),handTrails:new HandTrailTracker(),particleGeometry:new THREE.BufferGeometry(),particles:mesh(),clip:{group,mesh:clipMesh,anchor:null,key:''},
  state:{mode:'live',count:1,people:getDemoPeople(),occupancy:'single',interactionsEnabled:true,ownershipEpoch:1,expression:{id:'smile',emoji:'😀',visible:true}},
 });r.particleMotion.resize(1440,900);r.fingertipInk=new FingertipInk(r.scene,{order:10});r.sixSeven=new SixSevenOverlay(r.scene);r.affectBackdrop=new AffectBackdrop(r.scene);
 return {r,cleanup(){for(const m of[r.cameraImage,r.cameraMask,r.particles,r.clip.mesh]){m?.geometry.dispose();m?.material.map?.dispose();m?.material.dispose();}r.particleGeometry.dispose();r.affectBackdrop.dispose();r.sixSeven.dispose();r.fingertipInk.dispose();r.maskTexture?.dispose();r.state.matchedFrame?.close?.();globalThis.document=original;globalThis.Path2D=originalPath;}};
}
const frame=()=>({width:640,height:360,close(){}});
const mask=()=>({width:3,height:2,data:new Uint8Array([0,48,128,255,255,0]),encoding:'alpha8',complete:true});

test('camera background, mask, face and fingertip use one mirrored cover projection',()=>{
 const p=cameraProjection(1440,900,640,360);assert.equal(p.width,1600);assert.equal(p.x,-80);
 assert.deepEqual(p.point(0,0),{x:1520,y:0});assert.deepEqual(p.point(1,1),{x:-80,y:900});
 const b=p.box({x:.1,y:.2,width:.2,height:.4});assert.equal(b.x+b.width/2,p.point(.2,.4).x);
 for(const[w,h]of[[390,844],[900,900],[1920,1080]]){const q=cameraProjection(w,h,640,360);assert.ok(q.width>=w&&q.height>=h);}
});

test('synchronized complete alpha remains authoritative and body underfill samples coarse camera colors',()=>{
 const {r,cleanup}=harness();try{
  const f=frame(),m=mask();r.setState({matchedFrame:f,foregroundMask:m});
  const p=r.updateCameraLayer(f,m);
  assert.equal(r.cameraTexture.image,f);assert.equal(r.cameraTexture.flipY,false);
  assert.deepEqual([...r.maskTexture.image.data],[0,48,128,255,255,0]);
  assert.equal(r.cameraImage.scale.x,-p.width);assert.equal(r.cameraMask.scale.x,-p.width);
  assert.equal(r.cameraMask.material.uniforms.uCamera.value,r.cameraTexture);
  assert.match(mosaicFragmentShader,/floor\(p\*uGrid\)/);assert.doesNotMatch(mosaicFragmentShader,/uArtWave|uColorA/);
  assert.equal(r.updateCameraLayer(f,{...m,complete:false}),null);
  assert.equal(r.cameraImage.visible,false);assert.equal(r.cameraMask.visible,false);
 }finally{cleanup();}
});

test('foreground bytes are copied into reused texture without erasing antialiasing',()=>{
 const {r,cleanup}=harness();try{
  r.updateCameraLayer(frame(),mask());const texture=r.maskTexture;
  r.updateCameraLayer(frame(),{...mask(),data:new Uint8Array([11,29,67,151,255,0])});
  assert.equal(r.maskTexture,texture);assert.deepEqual([...texture.image.data],[11,29,67,151,255,0]);
 }finally{cleanup();}
});

test('full draw assembles camera, sampled particles and head clip; uncertainty removes interaction only',()=>{
 const {r,cleanup}=harness();try{
  r.setState({matchedFrame:frame(),foregroundMask:mask()});r.draw(100,.016);
  assert.equal(r.cameraImage.visible,true);assert.equal(r.cameraMask.visible,true);
  assert.equal(r.particles.visible,true);assert.ok(r.particleGeometry.drawRange.count>0);
  assert.equal(r.clip.group.visible,true);
  const capacity=r.particleBuffers;r.draw(116,.016);assert.equal(r.particleBuffers,capacity,'particle buffers are reused between frames');
  r.setState({interactionsEnabled:false,occupancy:'multiple',people:[],count:0});r.draw(132,.016);
  assert.equal(r.clip.group.visible,false);assert.equal(r.fingertipInk.stats.vertices,0);
  assert.equal(r.cameraImage.visible,true);assert.equal(r.cameraMask.visible,true);
 }finally{cleanup();}
});

test('hairclip sits on measured upper-right temple and rotates as a plane with the head',()=>{
 const {r,cleanup}=harness();try{
  const p=cameraProjection(1440,900,640,360),person={...getDemoPeople()[0],headPose:{yaw:.4,pitch:-.2,roll:.13},faceObservedAt:100};
  const target=hairclipPlacement(person,p),center=p.point(person.faceCenter.x,person.faceCenter.y);
  assert.ok(target.x>center.x);assert.ok(target.y<center.y);
  const head=p.box(person.faceBBox),previousSize=Math.max(34,Math.min(126,Math.min(head.width,head.height)*.52));
  assert.equal(target.size,previousSize*2,'radius and diameter are twice the R07.2 size');
  r.updateClip(person,p,.016,true,100);
  assert.equal(r.clip.group.visible,true);assert.equal(r.clip.mesh.isMesh,true);assert.equal(r.clip.mesh.isSprite,undefined);
  assert.equal(r.clip.group.position.x,target.x);assert.equal(r.clip.group.rotation.y,.4);
  assert.equal(r.clip.group.rotation.x,-.2);assert.equal(r.clip.group.rotation.z,.13);
  assert.equal(r.clip.key,'😀');assert.equal(r.clip.mesh.material.map.isCanvasTexture,true);
  r.updateClip(person,p,.016,true,1001);assert.equal(r.clip.group.visible,false,'stale face hides attachment');
  r.updateClip({...person,faceSeen:false},p,.016,true,101);assert.equal(r.clip.group.visible,false);
 }finally{cleanup();}
});

test('expression collage is composited behind the original body without replacing camera, emoji or hand overlays',()=>{
 const {r,cleanup}=harness();try{
  r.setState({matchedFrame:frame(),foregroundMask:mask(),expression:{id:'smile',emoji:'😀',score:.8,visible:true,demo:true}});r.draw(100,.016);
  assert.equal(r.affectBackdrop.stats.visible,true);assert.equal(r.affectBackdrop.mesh.renderOrder,-30);
  assert.ok(r.cameraImage.renderOrder<r.affectBackdrop.mesh.renderOrder);assert.ok(r.affectBackdrop.mesh.renderOrder<r.cameraMask.renderOrder);
  assert.equal(r.cameraImage.visible,true);assert.equal(r.cameraMask.visible,true);assert.equal(r.particles.visible,true);assert.equal(r.clip.group.visible,true);
  r.setState({occupancy:'multiple',interactionsEnabled:false});assert.equal(r.affectBackdrop.mesh.visible,false);
  r.draw(150,.016);assert.equal(r.affectBackdrop.stats.visible,false);assert.equal(r.cameraImage.visible,true);
 }finally{cleanup();}
});

test('two fingertip strokes are rendered independently; no speech state is required',()=>{
 const {r,cleanup}=harness();try{
  const p=cameraProjection(1440,900,640,360),person={...getDemoPeople(.1)[0]};
  r.updateTrails(person,p,100,true);
  person.hands=person.hands.map((h,i)=>({...h,tip:{x:h.tip.x+(i?.03:-.03),y:h.tip.y+.04},timestamp:150}));
  r.updateTrails(person,p,150,true);
  assert.equal(r.trailCount,2);assert.ok(r.fingertipInk.stats.vertices>12);assert.equal(r.fingertipInk.stats.handIds.length,2);
  assert.ok(r.fingertipInk.layers.every(layer=>layer.alphas.every(a=>a>=0&&a<=1)));
  r.updateTrails(person,p,151,false);assert.equal(r.fingertipInk.stats.vertices,0);assert.equal(r.trailCount,0);
 }finally{cleanup();}
});

test('six/seven appears above tracked hands through the full draw and clears with multiple occupancy',()=>{
 const {r,cleanup}=harness();try{
  r.setState({matchedFrame:frame(),foregroundMask:mask()});
  for(const [i,y] of [.5,.42,.58,.42].entries()){
   const timestamp=100+i*250;
   const hands=[{id:'a',palm:{x:.75,y},tip:{x:.75,y:y-.04},timestamp},
    {id:'b',palm:{x:.25,y:1-y},tip:{x:.25,y:1-y-.04},timestamp}];
   r.setState({people:[{...getDemoPeople()[0],hands}]});r.draw(timestamp,.25);
  }
  assert.equal(r.sixSeven.stats.active,true);
  const p=cameraProjection(1440,900,640,360);
  for(const hand of r.state.people[0].hands){
   const digit=hand.id==='a'?'6':'7',mesh=r.sixSeven.meshes.get(digit),palm=p.point(hand.palm.x,hand.palm.y);
   assert.equal(mesh.visible,true);assert.equal(mesh.position.x,palm.x);
   assert.ok(mesh.position.y<palm.y);assert.ok(mesh.scale.y<0,'glyph reads upright in the Y-down scene');
   assert.equal(mesh.material.map.isCanvasTexture,true);
  }
  assert.equal(r.clip.group.visible,true);assert.equal(r.cameraImage.visible,true);assert.equal(r.particles.visible,true);
  r.setState({occupancy:'multiple',interactionsEnabled:false});r.draw(900,.05);
  assert.equal(r.sixSeven.stats.active,false);assert.ok([...r.sixSeven.meshes.values()].every(m=>!m.visible));
  assert.equal(r.cameraImage.visible,true,'hand overlays do not replace the existing camera layer');
 }finally{cleanup();}
});

test('owner changes and multiple occupancy immediately revoke trails and head attachment',()=>{
 const {r,cleanup}=harness();try{
  const p=cameraProjection(1440,900,640,360),person=getDemoPeople(.1)[0];r.updateTrails(person,p,100,true);r.updateClip(person,p,.016,true,100);
  assert.equal(r.clip.group.visible,true);assert.equal(r.handTrails.strokes.length,2);
  r.setState({ownershipEpoch:2});assert.equal(r.clip.group.visible,false);assert.equal(r.handTrails.strokes.length,0);
  r.updateClip(person,p,.016,true,100);r.setState({occupancy:'multiple'});assert.equal(r.clip.group.visible,false);
 }finally{cleanup();}
});

test('latched numerals stay opaque through reprojection and hide only the hand that leaves',()=>{
 const {r,cleanup}=harness();try{
  const p=cameraProjection(1440,900,640,360);
  const pair=(y,t)=>[{id:'a',palm:{x:.75,y},tip:{x:.75,y:y-.04},timestamp:t},
   {id:'b',palm:{x:.25,y:1-y},tip:{x:.25,y:1-y-.04},timestamp:t}];
  r.sixSeven.update(pair(.42,100),p,100,{dt:.1});
  const hands=pair(.58,350);r.sixSeven.update(hands,p,350,{dt:.25});
  r.sixSeven.reproject();const next=cameraProjection(800,600,640,360);
  r.sixSeven.update(hands,next,450,{dt:.1});
  assert.equal(r.sixSeven.stats.latched,true);
  assert.equal(r.sixSeven.meshes.get('6').position.x,next.point(.75,.58).x);
  assert.equal(r.sixSeven.meshes.get('6').material.opacity,1);
  r.sixSeven.update([pair(.58,750)[0]],next,750,{dt:.1});
  assert.equal(r.sixSeven.meshes.get('6').visible,true);assert.equal(r.sixSeven.meshes.get('7').visible,false);
  assert.equal(r.sixSeven.stats.latched,true);
  r.sixSeven.update([],next,800,{dt:.1});assert.equal(r.sixSeven.stats.latched,true);
  assert.ok([...r.sixSeven.meshes.values()].every(m=>!m.visible));
  r.sixSeven.update([],next,1800,{dt:.1});assert.equal(r.sixSeven.stats.latched,false);
 }finally{cleanup();}
});

test('short face display timeouts do not clear a pending six/seven sequence; person changes do',()=>{
 const {r,cleanup}=harness();try{
  r.setState({matchedFrame:frame(),foregroundMask:mask(),gestureEnabled:true,gestureOwner:'session:person'});
  for(const [i,y] of [.5,.42,.58,.42].entries()){
   const timestamp=100+i*480;
   const hands=[{id:'a',palm:{x:.75,y},tip:{x:.75,y:y-.04},timestamp},
    {id:'b',palm:{x:.25,y:1-y},tip:{x:.25,y:1-y-.04},timestamp}];
   r.setState({people:[{...getDemoPeople()[0],hands}],interactionsEnabled:true});
   r.draw(timestamp+430,.016);
   for(let now=timestamp+446;now<timestamp+910;now+=16){
    r.setState({interactionsEnabled:now-timestamp<900});r.draw(now,.016);
   }
  }
  assert.equal(r.sixSeven.stats.active,true);
  r.setState({interactionsEnabled:false,ownershipEpoch:2});
  assert.equal(r.sixSeven.stats.active,true,'speech/face epoch cannot erase this same-person gesture');
  r.setState({gestureOwner:'session:new-person'});assert.equal(r.sixSeven.stats.active,false);
  assert.ok([...r.sixSeven.meshes.values()].every(m=>!m.visible));
 }finally{cleanup();}
});

test('matched ImageBitmap ownership closes exactly once on replacement and exit',()=>{
 const {r,cleanup}=harness();try{
  let a=0,b=0;const first={width:640,height:360,close(){a++;}},second={width:640,height:360,close(){b++;}};
  r.setState({matchedFrame:first});r.setState({matchedFrame:first});assert.equal(a,0);
  r.setState({matchedFrame:second});assert.equal(a,1);assert.equal(b,0);
  r.setState({mode:'idle'});assert.equal(b,1);r.setState({mode:'idle'});assert.equal(b,1);
 }finally{cleanup();}
});

test('particle system uses source RGB, moves at rest, fades departed pixels and resets cleanly',()=>{
 const {r,cleanup}=harness();try{
  const motion=r.particleMotion,f=frame();motion.setMask({width:1,height:1,data:new Uint8Array([255])});
  const first=Float32Array.from(motion.update(f,100));assert.ok(first.length>0);assert.equal(first[3],Math.fround(128/255));
  const next=Float32Array.from(motion.update(f,150));assert.notEqual(first[0],next[0]);assert.ok(motion.stats.movingCount>0);
  motion.setMask({width:1,height:1,data:new Uint8Array([0])});const tail=motion.update(f,200);assert.ok(tail.length>0);assert.ok(tail[6]<next[6]);
  for(let now=250;now<2500;now+=40)motion.update(f,now);assert.equal(motion.count,0);
  motion.reset();motion.setMask({width:1,height:1,data:new Uint8Array([255])});assert.ok(motion.update(f,2600).length>0,'same frame can be sampled after reset');
 }finally{cleanup();}
});

test('pausing particle art freezes motion while accepting a changed foreground mask',()=>{
 const {r,cleanup}=harness();try{
  const motion=r.particleMotion,f=frame();motion.setMask({width:1,height:1,data:new Uint8Array([255])});
  const first=Float32Array.from(motion.update(f,100));const paused=Float32Array.from(motion.update(f,150,{animate:false}));
  assert.equal(first[0],paused[0]);assert.equal(first[1],paused[1]);assert.equal(first[2],paused[2]);
  motion.setMask({width:1,height:1,data:new Uint8Array([0])});for(let now=200;now<2500;now+=40)motion.update(f,now,{animate:false});assert.equal(motion.count,0);
 }finally{cleanup();}
});

test('demo contains one person, two moving hands and a bounded 3D head pose',()=>{
 const a=getDemoPeople(1),b=getDemoPeople(2);assert.equal(a.length,1);assert.equal(a[0].hands.length,2);
 assert.notDeepEqual(a[0].hands[0].tip,b[0].hands[0].tip);assert.notDeepEqual(a[0].headPose,b[0].headPose);
 assert.ok(Math.abs(a[0].headPose.yaw)<1);assert.equal(a[0].hands[0].timestamp,1000);
});
