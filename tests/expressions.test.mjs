import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPRESSION_LIBRARY,createExpressionTracker,expressionForDemo} from '../public/expressions.js';

const face=actions=>({faceSeen:true,stale:false,headPose:{yaw:0,pitch:0,roll:0},facialActions:{smile:0,browRaise:0,browLower:0,jawOpen:0,eyeWide:0,mouthPucker:0,eyeBlinkLeft:0,eyeBlinkRight:0,...actions}});
function feed(tracker,actions,start,duration,options={}){
 let result;
 for(let now=start;now<=start+duration;now+=50)result=tracker.update(face(actions),now,{owner:1,...options});
 return result;
}

test('visible configurations select distinct emoji after sustained observations',()=>{
 const cases=[
  [{smile:.9},'smile'],
  [{jawOpen:.8,browRaise:.7,eyeWide:.6},'open-mouth'],
  [{eyeBlinkLeft:.95,eyeBlinkRight:.05},'wink'],
  [{eyeBlinkLeft:.95,eyeBlinkRight:.95},'eyes-closed'],
  [{mouthPucker:.9},'pucker'],
  [{browLower:.85},'brow-furrow'],
  [{smile:.9,eyeSquint:.7},'squint-smile'],
  [{smile:.9,jawOpen:.6},'open-smile'],
  [{smile:.9,jawOpen:.7,eyeBlinkLeft:.95,eyeBlinkRight:.95},'closed-laugh'],
  [{browRaiseLeft:.9,browRaiseRight:.1},'one-brow'],
  [{mouthFrown:.8},'mouth-frown'],
  [{browRaise:.85,eyeWide:.75,jawOpen:.05},'raised-eyes'],
  [{mouthPucker:.9,eyeBlinkLeft:.95,eyeBlinkRight:.95},'closed-pucker'],
  [{eyeWideLeft:.75,eyeWideRight:.8},'raised-eyes'],
  [{eyeSquintLeft:.75,eyeSquintRight:.72},'eyes-narrow'],
  [{eyeSquintLeft:.85,eyeSquintRight:.1},'one-eye-squint'],
  [{eyeLookOutLeft:.8,eyeLookInRight:.75},'gaze-side'],
  [{eyeLookInLeft:.75,eyeLookOutRight:.8},'gaze-side'],
  [{eyeLookUpLeft:.8,eyeLookUpRight:.75},'gaze-up'],
 ];
 for(const [actions,id] of cases){
  const result=feed(createExpressionTracker(),actions,0,800);
  assert.equal(result.id,id);assert.equal(result.visible,true);assert.ok(result.score>0&&result.score<=1);
 }
 assert.equal(new Set(EXPRESSION_LIBRARY.map(item=>item.emoji)).size,EXPRESSION_LIBRARY.length);
});

test('ordinary bilateral and unilateral blinks do not flash an emoji',()=>{
 for(const blink of [{eyeBlinkLeft:.98,eyeBlinkRight:.98},{eyeBlinkLeft:.98,eyeBlinkRight:.03}]){
  const tracker=createExpressionTracker();feed(tracker,{},0,200);
  const ids=[];
  for(let now=250;now<=1500;now+=50){
   ids.push(tracker.update(face(now<400?blink:{}),now,{owner:1}).id);
  }
  assert.ok(ids.every(id=>id==='neutral'));
 }
 for(const base of [{smile:.9,jawOpen:.65},{mouthPucker:.9}]){
  const tracker=createExpressionTracker();const before=feed(tracker,base,0,700).id;
  for(let now=750;now<=1800;now+=50){
   const actions=now<900?{...base,eyeBlinkLeft:.98,eyeBlinkRight:.98}:base;
   assert.equal(tracker.update(face(actions),now,{owner:1}).id,before,'a short blink cannot create a closed-eye combination');
  }
 }
});

test('opening the mouth without matching eyes or brows does not imply surprise',()=>{
 const result=feed(createExpressionTracker(),{jawOpen:.98},0,1500);
 assert.equal(result.id,'neutral');
});

test('a momentary action spike and threshold noise do not repeatedly change emoji',()=>{
 const tracker=createExpressionTracker();feed(tracker,{},0,200);
 assert.equal(tracker.update(face({smile:1}),250,{owner:1}).id,'neutral');
 assert.equal(feed(tracker,{},300,400).id,'neutral');
 assert.equal(feed(tracker,{smile:.9},750,500).id,'smile');
 for(let now=1300;now<=2500;now+=50){
  const result=tracker.update(face({smile:now%100===0?.42:.48}),now,{owner:1});
  assert.equal(result.id,'smile','hysteresis retains an established smile near its entry threshold');
 }
 assert.equal(feed(tracker,{},2550,1000).id,'neutral','a genuine return to rest is not sticky');
});

test('new compound actions supersede an established simple expression and release cleanly',()=>{
 const tracker=createExpressionTracker();
 assert.equal(feed(tracker,{smile:.95},0,500).id,'smile');
 assert.equal(feed(tracker,{smile:.95,eyeSquint:.65},550,700).id,'squint-smile');
 assert.equal(feed(tracker,{smile:.95,jawOpen:.7},1300,800).id,'open-smile');
 assert.equal(feed(tracker,{smile:.95,jawOpen:.7,eyeBlinkLeft:.95,eyeBlinkRight:.95},2150,900).id,'closed-laugh');
 assert.equal(feed(tracker,{smile:.95},3100,900).id,'smile');
 assert.equal(feed(tracker,{},4050,900).id,'neutral');
 const pucker=createExpressionTracker();
 assert.equal(feed(pucker,{mouthPucker:.9},0,600).id,'pucker');
 assert.equal(feed(pucker,{mouthPucker:.9,eyeBlinkLeft:.95,eyeBlinkRight:.95},650,900).id,'closed-pucker');
 assert.equal(feed(pucker,{mouthPucker:.9},1600,900).id,'pucker');
 assert.equal(feed(createExpressionTracker(),{browRaiseLeft:.9,browRaiseRight:.9},0,800).id,'neutral','symmetric brows alone do not imply a unilateral brow raise');
});

test('participant, occupancy and face loss immediately clear expression history',()=>{
 for(const interruption of ['owner','eligibility','face','stale','confidence']){
  const tracker=createExpressionTracker();assert.equal(feed(tracker,{smile:.9},0,500).id,'smile');
  const person=face({});const options={owner:1};
  if(interruption==='owner')options.owner=2;
  if(interruption==='eligibility')options.eligible=false;
  if(interruption==='face')person.faceSeen=false;
  if(interruption==='stale')person.stale=true;
  if(interruption==='confidence')person.faceConfidence=.2;
  const result=tracker.update(person,550,options);
  assert.equal(result.id,'neutral');
  assert.equal(result.visible,interruption==='owner');
  assert.equal(tracker.update(face({}),600,{owner:2}).id,'neutral');
 }
});

test('a render loop cannot turn one inference sample into a sustained expression',()=>{
 const tracker=createExpressionTracker();const person=face({eyeBlinkLeft:.99});
 for(let now=0;now<600;now+=16)assert.equal(tracker.update(person,now,{owner:1}).id,'neutral');
 assert.equal(tracker.update(person,700,{owner:1}).visible,false);
 assert.equal(tracker.update(person,720,{owner:1}).visible,false);
 // New samples can establish a shape again after the stale frame expires.
 assert.equal(feed(tracker,{eyeBlinkLeft:.99},750,650).id,'wink');
});

test('sample timestamps also prevent cloned stale data from establishing an expression',()=>{
 const tracker=createExpressionTracker();
 for(let now=0;now<600;now+=20){
  const result=tracker.update({...face({smile:.95}),faceObservedAt:123},now,{owner:1});
  assert.equal(result.id,'neutral');
 }
});

test('missing or invalid movement measurements remain unassigned; reset and clock gaps are safe',()=>{
 const tracker=createExpressionTracker();
 assert.equal(tracker.update({faceSeen:true},0).visible,false);
 assert.equal(tracker.update(face({smile:NaN,browRaise:Infinity}),100).id,'neutral');
 assert.equal(feed(tracker,{smile:.95},200,500).id,'smile');
 assert.equal(tracker.update(face({}),2000,{owner:1}).id,'neutral');
 feed(tracker,{smile:.95},2100,500);
 assert.equal(tracker.update(face({}),10,{owner:1}).id,'neutral');
 tracker.reset();assert.equal(tracker.update(face({}),20,{owner:1}).id,'neutral');
 assert.equal(tracker.update(face({}),NaN,{owner:1}).visible,false);
});

test('demo output is explicitly synthetic and invalid ids are bounded to neutral',()=>{
 assert.equal(expressionForDemo('wink').emoji,'😉');
 assert.equal(expressionForDemo('not-an-expression').id,'neutral');
 assert.equal(expressionForDemo('smile').demo,true);
});

test('eyes alone change the emoji while the mouth remains still, and return to neutral',()=>{
 const tracker=createExpressionTracker();
 assert.equal(feed(tracker,{eyeWideLeft:.8,eyeWideRight:.8},0,800).id,'raised-eyes');
 assert.equal(feed(tracker,{eyeSquintLeft:.75,eyeSquintRight:.75},850,900).id,'eyes-narrow');
 assert.equal(feed(tracker,{eyeLookOutLeft:.8,eyeLookInRight:.8},1800,900).id,'gaze-side');
 assert.equal(feed(tracker,{eyeLookUpLeft:.8,eyeLookUpRight:.8},2750,900).id,'gaze-up');
 assert.equal(feed(tracker,{},3700,1000).id,'neutral');
 const smiling=createExpressionTracker();assert.equal(feed(smiling,{smile:.8},0,600).id,'smile');
 assert.equal(feed(smiling,{smile:.8,eyeLookOutLeft:.8,eyeLookInRight:.8},650,900).id,'gaze-side','a still smiling mouth does not block sustained eye direction');
});

test('one-eye noise, conflicting directions and a turned or unknown head do not create gaze emoji',()=>{
 for(const actions of [{eyeWideLeft:.95,eyeWideRight:.05},{eyeLookOutLeft:.9},{eyeLookOutLeft:.9,eyeLookOutRight:.9},{eyeLookInLeft:.9,eyeLookInRight:.9},{eyeLookInLeft:.8,eyeLookInRight:.8,eyeLookOutLeft:.8,eyeLookOutRight:.8},{eyeLookUpLeft:.9,eyeLookDownRight:.9}]){
  assert.equal(feed(createExpressionTracker(),actions,0,1000).id,'neutral');
 }
 for(const headPose of [null,{yaw:.8,pitch:0},{yaw:0,pitch:.6}]){
  const tracker=createExpressionTracker();let result;
  for(let now=0;now<=1000;now+=100)result=tracker.update({...face({eyeLookOutLeft:.9,eyeLookInRight:.9}),headPose},now,{owner:1});
  assert.equal(result.id,'neutral');
 }
});

test('eye direction requires sustained fresh samples and yields to sustained eyelid closure',()=>{
 const actions={eyeLookOutLeft:.85,eyeLookInRight:.85},tracker=createExpressionTracker();feed(tracker,{},0,200);
 for(let now=250;now<=1200;now+=50)assert.equal(tracker.update(face(now<450?actions:{}),now,{owner:1}).id,'neutral','a brief glance is filtered');
 const repeated=createExpressionTracker();for(let now=0;now<600;now+=20)assert.equal(repeated.update({...face(actions),faceObservedAt:1},now,{owner:1}).id,'neutral');
 assert.equal(feed(tracker,actions,1250,900).id,'gaze-side');
 assert.equal(feed(tracker,{...actions,eyeBlinkLeft:.96,eyeBlinkRight:.96},2200,1000).id,'eyes-closed');
 assert.equal(feed(createExpressionTracker(),{...actions,eyeBlinkLeft:.96,eyeBlinkRight:.04},0,1000).id,'wink');
});

test('eye-only expressions work at realistic 3–5 Hz inference rates',()=>{
 for(const interval of [200,334])for(const [actions,id]of[[{eyeSquintLeft:.8,eyeSquintRight:.8},'eyes-narrow'],[{eyeLookUpLeft:.8,eyeLookUpRight:.8},'gaze-up']]){
  const tracker=createExpressionTracker();let result;
  for(let now=0;now<=1400;now+=interval)result=tracker.update({...face(actions),faceObservedAt:now},now,{owner:1});
  assert.equal(result.id,id);
 }
});

test('lost or turned head pose immediately invalidates pending and established gaze',()=>{
 const actions={eyeLookOutLeft:.9,eyeLookInRight:.9};
 for(const headPose of [null,{yaw:.8,pitch:0},{yaw:0,pitch:.6}]){
  const pending=createExpressionTracker();
  for(const now of [0,450])pending.update({...face(actions),faceObservedAt:now},now,{owner:1});
  assert.equal(pending.update({...face(actions),headPose,faceObservedAt:466},466,{owner:1}).id,'neutral','old filtered gaze cannot complete its dwell on invalid pose');
  const active=createExpressionTracker();assert.equal(feed(active,actions,0,900).id,'gaze-side');
  assert.equal(active.update({...face(actions),headPose,faceObservedAt:950},950,{owner:1}).id,'neutral','existing gaze clears immediately');
 }
});
