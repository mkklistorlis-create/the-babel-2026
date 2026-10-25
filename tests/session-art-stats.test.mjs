import test from 'node:test';
import assert from 'node:assert/strict';
import {AFFECT_FAMILIES,observedAffectSignal} from '../public/affect-visual-state.js';
import {createSessionArtAccumulator,normalizeSessionArt,EXPRESSION_ART_METRIC} from '../public/session-art-stats.js';
import {createExpressionRecorder,normalizeSessionSummary,MAX_SESSION_MS} from '../public/session-stats.js';
import {readMessage,MAX_MESSAGE_LENGTH} from '../public/room-protocol.js';

const identity={sessionId:'abcdef0123456789abcdef0123456789',role:'A',mode:'live'};
const recorder=options=>createExpressionRecorder({...identity,now:()=>0,...options});
const observed=(expressionId,actions)=>({valid:true,expressionId,actions,score:1});
const row=(art,family)=>art.families.find(f=>f.family===family);
const signal=(family,intensity)=>({family,intensity});
const close=(a,b)=>assert.ok(Math.abs(a-b)<.0001,`${a} != ${b}`);

test('art signal reuses the live family/strength mapping without treating match score as intensity',()=>{
 assert.deepEqual(observedAffectSignal({id:'smile',visible:true,actions:{smile:.2},score:1}),{family:'joy',intensity:.2,demo:false});
 assert.deepEqual(observedAffectSignal({id:'smile',visible:true,actions:{smile:.2},score:0}),{family:'joy',intensity:.2,demo:false});
 assert.equal(observedAffectSignal({id:'smile',visible:true,actions:null}),null);
 assert.equal(observedAffectSignal({id:'smile',visible:false,actions:{smile:1}}),null);
 assert.equal(observedAffectSignal({id:'unknown',visible:true,actions:{smile:1}}),null);
 assert.equal(observedAffectSignal({id:'smile',visible:true,demo:true}).intensity,.65);
 assert.equal(observedAffectSignal({id:'gaze-up',visible:true,actions:{eyeLookUpLeft:1,eyeLookUpRight:1}}).family,'calm');
});

test('two-second windows preserve duration-weighted family quotas, strength and three solid-color bands',()=>{
 const a=createSessionArtAccumulator();
 a.interval(0,1000,signal('joy',.2));a.interval(1000,2000,signal('calm',.3));
 a.interval(2000,4000,signal('joy',.8));
 const result=a.snapshot();
 assert.equal(result.metric,EXPRESSION_ART_METRIC);assert.equal(result.windowMs,2000);assert.equal(result.windows,2);assert.equal(result.validMs,4000);
 assert.equal(row(result,'joy').durationMs,3000);assert.equal(row(result,'calm').durationMs,1000);
 close(row(result,'joy').meanStrength,.6);close(row(result,'calm').meanStrength,.3);
 assert.equal(row(result,'joy').bands[0][0],1000);assert.equal(row(result,'joy').bands[1][0],0);assert.equal(row(result,'joy').bands[2][0],2000);
 assert.ok(result.variation>0);assert.ok(row(result,'joy').variation>0);assert.ok(row(result,'calm').variation>0,'leaving a family contributes variation too');
 assert.deepEqual(normalizeSessionArt(result,4000),result);
});

test('a partial window is included on a copy and repeated reads never count it again',()=>{
 const a=createSessionArtAccumulator();a.interval(0,500,signal('joy',.1));
 const early=a.snapshot();assert.equal(early.windows,1);assert.equal(early.validMs,500);
 for(let i=0;i<30;i++)assert.deepEqual(a.snapshot(),early);
 early.families[1].bands[0][0]=99999;
 a.interval(500,2000,signal('joy',.9));const end=a.snapshot();
 assert.equal(end.validMs,2000);assert.equal(end.windows,1);close(row(end,'joy').meanStrength,.7);
 assert.equal(row(end,'joy').bands[0][0],0,'the finished window is classified by its final mean, not an earlier read');
 assert.equal(row(end,'joy').bands[2][0],2000);
});

test('missing evidence keeps measured contribution but breaks adjacent-window variation',()=>{
 const a=createSessionArtAccumulator();
 a.interval(0,2000,signal('joy',.1));a.interval(2000,3000,null);a.interval(3000,4000,signal('tension',1));a.interval(4000,6000,signal('surprise',1));
 const result=a.snapshot();
 assert.equal(result.validMs,5000);assert.equal(result.windows,3);assert.equal(result.variation,0);
 assert.equal(row(result,'tension').durationMs,1000);assert.equal(row(result,'tension').variation,0);
 assert.ok(normalizeSessionArt(result,6000,5000));
 a.interval(6000,8000,signal('calm',.18));assert.ok(a.snapshot().variation>0,'two consecutive complete windows can compare again');
});

test('gaps supplied implicitly and long missing runs never invent neutral or retained window history',()=>{
 const a=createSessionArtAccumulator();a.interval(0,200,signal('joy',.8));
 a.interval(10_000,10_500,signal('sadness',.6));
 const result=a.snapshot();assert.equal(result.validMs,700);assert.equal(result.windows,2);assert.equal(result.variation,0);
 assert.equal(row(result,'calm').durationMs,0);assert.equal(row(result,'joy').durationMs,200);assert.equal(row(result,'sadness').durationMs,500);
 a.interval(10_500,MAX_SESSION_MS,null);const end=a.snapshot();
 assert.equal(end.validMs,700);assert.equal(end.windows,2);assert.ok(JSON.stringify(end).length<1300);
 assert.ok(normalizeSessionArt(end,MAX_SESSION_MS));
});

test('art time follows the existing freshness budget and leaves brief emoji episodes untouched',()=>{
 const r=recorder();r.sample(observed('smile',{smile:.8}),0);r.sample(observed('wink',{eyeBlinkLeft:.9,eyeBlinkRight:0}),20);r.sample(observed('neutral',{smile:0}),40);
 const result=r.finish(3000);
 assert.equal(result.validMs,540);assert.equal(result.art.validMs,540);
 assert.equal(result.counts.find(f=>f.id==='wink').episodes,1);assert.equal(result.counts.find(f=>f.id==='wink').durationMs,20);
 assert.equal(result.art.windows,1);assert.equal(result.art.variation,0);
 assert.ok(normalizeSessionSummary(result));
 assert.deepEqual(r.snapshot(9999),result);
});

test('live observations without actions contribute no art while explicit demo uses preset intensity',()=>{
 const live=recorder(),demo=recorder({mode:'demo'});
 live.sample({valid:true,expressionId:'smile',score:1},0);demo.sample({valid:true,expressionId:'smile',score:1},0);
 const l=live.finish(400),d=demo.finish(400);
 assert.equal(l.validMs,400);assert.equal(l.art.validMs,0);assert.equal(l.art.windows,0);
 assert.equal(d.art.validMs,400);assert.equal(row(d.art,'joy').meanStrength,.65);
 assert.ok(normalizeSessionSummary(l));assert.ok(normalizeSessionSummary(d));
});

test('30-second single-family input remains complete across sample frequencies',()=>{
 for(const step of [40,100,250,500]){
  const r=recorder();for(let at=0;at<30000;at+=step)r.sample(observed('smile',{smile:.8}),at);
  const result=r.finish(30000);assert.equal(result.validMs,30000);assert.equal(result.art.validMs,30000);assert.equal(result.art.windows,15);
  assert.equal(row(result.art,'joy').meanStrength,.8);assert.equal(row(result.art,'joy').variation,0);assert.ok(normalizeSessionSummary(result));
 }
});

test('normalizer rejects forged art accounting, unbounded fields and malformed bands; old summaries remain supported',()=>{
 const r=recorder();r.sample(observed('smile',{smile:.8}),0);const good=r.finish(300);
 const changes=[
  a=>a.metric='emotion-confidence',a=>a.windowMs=100,a=>a.validMs=301,a=>a.validMs=-1,a=>a.windows=99,a=>a.windows=.5,
  a=>a.variation=2,a=>a.variation=NaN,a=>a.families.pop(),a=>a.families[0].family='joy',a=>a.families[1].durationMs=299,
  a=>a.families[1].meanStrength=.12345,a=>a.families[1].bands[2][0]=400,a=>a.families[1].bands[2][1]=.2,
  a=>a.families[1].bands[0][2]=.1,a=>a.families[1].bands[2].push(9),a=>a.families[1].bands=[],
 ];
 for(const change of changes){const bad=structuredClone(good);change(bad.art);assert.equal(normalizeSessionSummary(bad),null,String(change));}
 const legacy=structuredClone(good);delete legacy.art;assert.deepEqual(normalizeSessionSummary(legacy),legacy);
 const normalized=normalizeSessionSummary(good);normalized.art.families[1].bands[2][0]=0;assert.equal(good.art.families[1].bands[2][0],300);
});

test('full 240-point timeline plus all art families/bands and large count fields fit the existing 8192-byte room envelope',()=>{
 const r=recorder();r.sample(observed('smile',{smile:1}),0);const result=r.finish(MAX_SESSION_MS);
 result.timeline.points=Array.from({length:240},(_,i)=>[Math.floor(MAX_SESSION_MS*i/239),99.9]);
 const art=createSessionArtAccumulator();let at=0;
 for(const family of AFFECT_FAMILIES)for(const intensity of [.1234,.5432,.9876]){art.interval(at,at+2000,signal(family,intensity));at+=2000;}
 result.art=art.snapshot();result.validMs=MAX_SESSION_MS;result.missingMs=0;
 const per=MAX_SESSION_MS/result.counts.length;
 result.counts=result.counts.map((f,i)=>({...f,durationMs:i===17?MAX_SESSION_MS-per*17:per,episodes:55555}));
 const message={v:1,type:'session',body:{action:'final',sessionId:identity.sessionId,role:'A',summary:result}};
 assert.ok(normalizeSessionSummary(result));assert.ok(readMessage(message));
 assert.ok(new TextEncoder().encode(JSON.stringify(message)).length<MAX_MESSAGE_LENGTH);
});
