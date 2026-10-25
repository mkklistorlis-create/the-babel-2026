import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPRESSION_LIBRARY,expressionForDemo} from '../public/expressions.js';
import {AFFECT_FAMILIES,AFFECT_REFERENCE,AFFECT_SOURCE_MAP,EXPRESSION_ART_FAMILIES,AFFECT_VISUAL_PROFILES,createAffectVisualState,sampleAffectStyle} from '../public/affect-visual-state.js';

const live=(id='neutral',actions={},score=1)=>({id,visible:true,score,actions:{smile:0,browLower:0,mouthFrown:0,jawOpen:0,eyeWide:0,...actions}});
const opts={owner:'participant-a'};
const close=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('all 18 observed emoji configurations have an explicit five-family art mapping',()=>{
 assert.equal(AFFECT_SOURCE_MAP.length,18);
 assert.deepEqual(AFFECT_SOURCE_MAP.map(x=>x.id),EXPRESSION_LIBRARY.map(x=>x.id));
 for(const entry of AFFECT_SOURCE_MAP){
  assert.ok(AFFECT_FAMILIES.includes(entry.family));assert.ok(entry.label);assert.ok(entry.emoji);
 }
 for(const id of ['smile','squint-smile','open-smile','closed-laugh'])assert.equal(EXPRESSION_ART_FAMILIES[id],'joy');
 for(const id of ['open-mouth','raised-eyes'])assert.equal(EXPRESSION_ART_FAMILIES[id],'surprise');
 assert.equal(EXPRESSION_ART_FAMILIES['brow-furrow'],'tension');
 assert.equal(EXPRESSION_ART_FAMILIES['mouth-frown'],'sadness');
 for(const id of ['one-brow','eyes-narrow','one-eye-squint','wink','pucker','gaze-side','gaze-up'])assert.equal(EXPRESSION_ART_FAMILIES[id],'calm');
});

test('profiles preserve Figma hollow-ring keyframes including reverse sadness strength',()=>{
 assert.deepEqual(AFFECT_REFERENCE,{width:900,height:430,centerX:450,centerY:215});
 const expected={calm:[[2,5,10],[.3,.65,1]],joy:[[6,20,38],[.3,.65,1]],surprise:[[3,8,15],[.35,.7,1]],tension:[[.8,1.3,2],[.35,.7,1]],sadness:[[10,6,2.5],[.95,.6,.28]]};
 for(const family of AFFECT_FAMILIES){
  const p=AFFECT_VISUAL_PROFILES[family];assert.deepEqual(p.width,expected[family][0]);assert.deepEqual(p.opacity,expected[family][1]);
  assert.equal(p.geometry.angles.length,3);assert.ok(Object.isFrozen(p.geometry));
  for(const [i,t] of [0,.5,1].entries()){
   const s=sampleAffectStyle(family,t);close(s.width,p.width[i]);close(s.opacity,p.opacity[i]);
   assert.ok(s.palette.every(color=>/^#[0-9A-F]{6}$/.test(color)));
  }
 }
 assert.deepEqual(AFFECT_VISUAL_PROFILES.calm.palette,['#A8C5B0','#F2EBDD','#C7E3DD']);
 assert.deepEqual(AFFECT_VISUAL_PROFILES.surprise.palette,['#9566F2','#F19AE8','#FFF0FA']);
 assert.equal(AFFECT_VISUAL_PROFILES.surprise.geometry.spikeCount,12);
 assert.deepEqual(AFFECT_VISUAL_PROFILES.surprise.geometry.spikeHeight,[8,19,32]);
 assert.equal(AFFECT_VISUAL_PROFILES.tension.geometry.chevronCount,64);
 close(AFFECT_VISUAL_PROFILES.tension.geometry.chevronLeg,Math.sqrt(128));
 assert.deepEqual(AFFECT_VISUAL_PROFILES.sadness.geometry.radiusX,[96,82,68]);
 assert.deepEqual(AFFECT_VISUAL_PROFILES.sadness.geometry.radiusY,[140,155,168]);
 close(sampleAffectStyle('sadness',.75).width,4.25);
 close(sampleAffectStyle('joy',.25).width,13);
 close(sampleAffectStyle('joy',NaN).width,6);
});

test('live intensity follows measured action amounts and ignores neutral matching score',()=>{
 for(const score of [0,.5,1]){
  const s=createAffectVisualState().update(live('neutral',{},score),0,opts);
  assert.equal(s.family,'calm');close(s.intensity,.18);close(s.sourceScore,score);
 }
 for(const [id,channel,family] of [['smile','smile','joy'],['brow-furrow','browLower','tension'],['mouth-frown','mouthFrown','sadness']]){
  const low=createAffectVisualState().update(live(id,{[channel]:.25},.99),0,opts);
  const high=createAffectVisualState().update(live(id,{[channel]:.85},.01),0,opts);
  assert.equal(high.family,family);close(low.intensity,.25);close(high.intensity,.85);
 }
});

test('mouth-only movement cannot inflate surprise and native paired eye zeros remain respected',()=>{
 const mouthOnly=createAffectVisualState().update(live('open-mouth',{jawOpen:1}),0,opts);
 close(mouthOnly.intensity,0);
 const supported=createAffectVisualState().update(live('open-mouth',{jawOpen:.7,browRaise:.7}),0,opts);
 assert.ok(supported.intensity>.8);
 const eyes=createAffectVisualState().update(live('raised-eyes',{eyeWide:.9,eyeWideLeft:.8,eyeWideRight:0}),0,opts);
 close(eyes.intensity,0);
 const bilateral=createAffectVisualState().update(live('raised-eyes',{eyeWideLeft:.6,eyeWideRight:.7}),0,opts);
 close(bilateral.intensity,.96);
});

test('ambiguous eye and mouth gestures gently modulate calm without assigning another family',()=>{
 for(const [id,actions] of [
  ['wink',{eyeBlinkLeft:1,eyeBlinkRight:0}],['pucker',{mouthPucker:1}],['one-brow',{browRaiseLeft:1,browRaiseRight:0}],
  ['eyes-narrow',{eyeSquintLeft:1,eyeSquintRight:1}],['one-eye-squint',{eyeSquintLeft:1,eyeSquintRight:0}],
  ['gaze-side',{eyeLookOutLeft:1,eyeLookInRight:1}],['gaze-up',{eyeLookUpLeft:1,eyeLookUpRight:1}],
 ]){
  const s=createAffectVisualState().update(live(id,actions),0,opts);
  assert.equal(s.family,'calm');close(s.intensity,.4);
 }
});

test('family transition uses wall-clock time and repeated source ids never restart it',()=>{
 const t=createAffectVisualState();t.update(live(),0,opts);
 let s=t.update(live('smile',{smile:.8}),100,opts);
 close(s.weights.calm,1);close(s.weights.joy,0);
 for(let now=150;now<=400;now+=50)s=t.update(live('smile',{smile:.8}),now,opts);
 close(s.weights.calm,.5);close(s.weights.joy,.5);
 s=t.update(live('open-smile',{smile:.8,jawOpen:.8}),700,opts);
 close(s.weights.joy,1);close(s.weights.calm,0);
 close(Object.values(s.weights).reduce((a,b)=>a+b,0),1);
});

test('retargeting an unfinished family transition starts from the displayed mixture',()=>{
 const t=createAffectVisualState();t.update(live(),0,opts);t.update(live('smile',{smile:.8}),100,opts);
 const before=t.update(live('smile',{smile:.8}),400,opts);
 const changed=t.update(live('brow-furrow',{browLower:.9}),400,opts);
 assert.deepEqual(changed.weights,before.weights);
 const ended=t.update(live('brow-furrow',{browLower:.9}),1000,opts);
 close(ended.weights.tension,1);close(ended.weights.joy,0);close(ended.weights.calm,0);
});

test('continuous intensity smoothing is independent of render frame count',()=>{
 function run(step){
  const t=createAffectVisualState();t.update(live('smile',{smile:.2}),0,opts);t.update(live('smile',{smile:.9}),0,opts);
  for(let now=step;now<600;now+=step)t.update(live('smile',{smile:.9}),now,opts);
  return t.update(live('smile',{smile:.9}),600,opts).intensity;
 }
 close(run(10),run(100));close(run(10),.9+(.2-.9)*Math.exp(-600/180));
});

test('missing live actions, lost visibility, occupancy gate and ownership changes clear old art',()=>{
 const t=createAffectVisualState();t.update(live('smile',{smile:1}),0,opts);
 for(const [expression,options] of [
  [live('smile',{smile:1}),{...opts,eligible:false}],
  [{...live('smile',{smile:1}),visible:false},opts],
  [{...live('smile',{smile:1}),actions:null},opts],
  [{...live(),id:'unknown'},opts],
 ]){
  t.update(live('smile',{smile:1}),10,opts);
  const s=t.update(expression,20,options);
  assert.equal(s.visible,false);assert.equal(s.sourceId,null);assert.ok(Object.values(s.weights).every(x=>x===0));
  t.reset();
 }
 t.update(live('smile',{smile:1}),0,opts);
 const next=t.update(live('mouth-frown',{mouthFrown:.7}),100,{owner:'participant-b'});
 close(next.weights.joy,0);close(next.weights.sadness,1);close(next.intensity,.7);
});

test('pause freezes appearance but never bypasses owner and eligibility safety',()=>{
 const t=createAffectVisualState();t.update(live(),0,opts);t.update(live('smile',{smile:.8}),100,opts);
 const before=t.update(live('smile',{smile:.8}),200,opts);
 for(const now of [300,600,900]){
  const paused=t.update(live('brow-furrow',{browLower:1}),now,{...opts,paused:true});
  assert.deepEqual(paused,before);
 }
 const resumed=t.update(live('smile',{smile:.8}),1000,opts);
 assert.deepEqual(resumed.weights,before.weights);assert.deepEqual(resumed.strengths,before.strengths);
 const changed=t.update(live('smile',{smile:1}),1100,{owner:'participant-b',paused:true});
 assert.equal(changed.visible,false);
 assert.equal(t.update(live(),1200,{owner:'participant-b',eligible:false,paused:true}).visible,false);
});

test('explicit demo selections render every family without inventing live observations',()=>{
 for(const {id} of EXPRESSION_LIBRARY){
  const s=createAffectVisualState().update(expressionForDemo(id),0,opts);
  assert.equal(s.visible,true);assert.equal(s.demo,true);assert.equal(s.family,EXPRESSION_ART_FAMILIES[id]);close(s.intensity,.65);
 }
 const fake={...expressionForDemo('smile'),demo:false};
 assert.equal(createAffectVisualState().update(fake,0,opts).visible,false);
});

test('invalid clocks, malformed values and returned object edits cannot corrupt persistent state',()=>{
 const t=createAffectVisualState();
 assert.equal(t.update(live('smile',{smile:1}),-1,opts).visible,false);
 let s=t.update(live('smile',{smile:4}),100,opts);close(s.intensity,1);
 s.weights.joy=-100;s.strengths.joy=NaN;
 s=t.update(live('smile',{smile:4}),200,opts);close(s.weights.joy,1);close(s.intensity,1);
 assert.equal(t.update(live(),NaN,opts).visible,false);
 t.update(live('smile',{smile:.8}),500,opts);
 assert.equal(t.update(live(),400,opts).visible,false);
 const safe=t.update(live('smile',{smile:NaN,browLower:Infinity},NaN),600,opts);
 assert.ok(Object.values(safe.strengths).every(Number.isFinite));close(safe.intensity,0);close(safe.sourceScore,0);
 t.reset();assert.equal(t.update(live(),700,{...opts,paused:true}).visible,false);
});

test('decorative expressive families hold for 1.6 seconds after returning to calm',()=>{
 for(const [id,actions,family] of [['smile',{smile:.9},'joy'],['raised-eyes',{eyeWide:1},'surprise'],['brow-furrow',{browLower:.9},'tension']]){
  const t=createAffectVisualState({returnToCalmHoldMs:1600});
  t.update(live(id,actions),0,opts);const before=t.update(live(id,actions),100,opts);
  for(const now of [200,900,1699]){const s=t.update(live(),now,opts);assert.equal(s.family,family);close(s.intensity,before.intensity);}
  assert.equal(t.update(live(),1700,opts).family,'calm');
  close(t.update(live(),2300,opts).weights.calm,1);
 }
});
test('held backgrounds still retarget expressive cues and respect pause, ownership and lost tracking',()=>{
 const t=createAffectVisualState({returnToCalmHoldMs:1600});t.update(live('smile',{smile:.9}),0,opts);
 assert.equal(t.update(live('raised-eyes',{eyeWide:1}),100,opts).family,'surprise');
 t.update(live(),200,opts);t.update(live(),300,{...opts,paused:true});
 assert.equal(t.update(live(),2000,opts).family,'surprise');
 assert.equal(t.update(live(),3500,opts).family,'calm');
 t.update(live('smile',{smile:.9}),3600,opts);
 assert.equal(t.update(live(),3700,{...opts,owner:'new'}).family,'calm');
 t.update(live('smile',{smile:.9}),3800,opts);
 assert.equal(t.update(live(),3900,{...opts,eligible:false}).visible,false);
 assert.equal(t.update(live(),4000,opts).family,'calm');
});
