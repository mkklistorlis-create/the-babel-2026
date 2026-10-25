import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpressionRecorder,normalizeSessionSummary,MAX_SESSION_MS} from '../public/session-stats.js';
import {EXPRESSION_LIBRARY} from '../public/expressions.js';

const identity={sessionId:'a'.repeat(32),role:'A',mode:'live'};
const recorder=options=>createExpressionRecorder({...identity,now:()=>0,...options});
const seen=id=>({expressionId:id,valid:true});
const row=(summary,id)=>summary.counts.find(item=>item.id===id);

test('session statistics are measured in elapsed time independent of sample/render count',()=>{
 function run(step){
  const r=recorder();
  for(let time=0;time<=2000;time+=step)r.sample(seen(time<1000?'smile':'wink'),time);
  return r.finish(2000);
 }
 const slow=run(200),fast=run(20);
 assert.equal(slow.durationMs,2000);assert.equal(slow.validMs,2000);assert.equal(slow.missingMs,0);
 assert.deepEqual(slow.counts,fast.counts);
 assert.equal(row(slow,'smile').durationMs,1000);assert.equal(row(slow,'smile').episodes,1);
 assert.equal(row(slow,'wink').durationMs,1000);assert.equal(row(slow,'wink').episodes,1);
});

test('continuous expression is one episode while return from another expression is another',()=>{
 const r=recorder();
 r.sample(seen('smile'),0);r.sample(seen('smile'),100);r.sample(seen('wink'),300);
 r.sample(seen('smile'),400);const result=r.finish(600);
 assert.deepEqual(row(result,'smile'),{id:'smile',durationMs:500,episodes:2});
 assert.deepEqual(row(result,'wink'),{id:'wink',durationMs:100,episodes:1});
 assert.equal(result.validMs,600);
});

test('initial missing, invalid face and unknown IDs are missing, never neutral',()=>{
 const r=recorder();r.sample(seen('smile'),100);r.sample({expressionId:'smile',valid:false},300);
 r.sample(seen('not-an-expression'),500);r.sample(seen('smile'),700);
 const result=r.finish(900);
 assert.equal(result.durationMs,900);assert.equal(result.validMs,400);assert.equal(result.missingMs,500);
 assert.equal(row(result,'smile').episodes,2);assert.deepEqual(row(result,'neutral'),{id:'neutral',durationMs:0,episodes:0});
});

test('long stalls count only bounded evidence, then missing; a returning face starts another episode',()=>{
 const r=recorder();r.sample(seen('smile'),0);r.sample(seen('smile'),2000);
 const result=r.finish(2200);
 assert.equal(result.durationMs,2200);assert.equal(result.validMs,700);assert.equal(result.missingMs,1500);
 assert.equal(row(result,'smile').episodes,2);
});

test('frequent summary reads do not keep an old observation alive',()=>{
 const r=recorder();r.sample(seen('smile'),0);
 for(let time=100;time<=2000;time+=100)r.snapshot(time);
 const result=r.finish(2100);
 assert.equal(result.validMs,500);assert.equal(result.missingMs,1600);assert.equal(row(result,'smile').episodes,1);
});

test('exact freshness boundary is continuous and longer gap closes the episode',()=>{
 const r=recorder();r.sample(seen('smile'),0);r.snapshot(500);r.sample(seen('smile'),500);
 r.sample(seen('smile'),1000);r.sample(seen('smile'),1501);
 const result=r.finish(1600);
 assert.equal(row(result,'smile').episodes,2);assert.equal(result.missingMs,1);assert.equal(result.validMs,1599);
});

test('clock regressions and invalid timestamps do not rewrite state or overcount time',()=>{
 const r=recorder();r.sample(seen('smile'),0);const before=r.sample(seen('smile'),200);
 assert.deepEqual(r.sample(seen('wink'),100),before);
 assert.deepEqual(r.sample(seen('wink'),NaN),before);
 const result=r.finish(400);assert.equal(result.validMs,400);assert.equal(row(result,'wink').episodes,0);
});

test('finish is idempotent and later sampling cannot mutate a completed session',()=>{
 const r=recorder();r.sample(seen('smile'),0);const done=r.finish(300);
 assert.deepEqual(r.finish(800),done);assert.deepEqual(r.sample(seen('wink'),1000),done);assert.deepEqual(r.snapshot(2000),done);
});

test('snapshots are detached and revisions change only as statistical data changes',()=>{
 const r=recorder();const initial=r.snapshot(0);assert.equal(initial.revision,0);
 const first=r.sample(seen('smile'),0),repeat=r.sample(seen('smile'),0);
 assert.equal(first.revision,repeat.revision);assert.ok(first.revision>initial.revision);
 first.counts[0].episodes=999;first.counts.push({id:'fake'});
 const later=r.snapshot(100);assert.equal(later.counts.length,18);assert.equal(later.counts[0].episodes,0);
 assert.ok(later.revision>repeat.revision);assert.equal(later.counts.find(item=>item.id==='smile').durationMs,100);
});

test('recordings have a bounded 24h duration even after a system sleep',()=>{
 const r=recorder();r.sample(seen('smile'),0);const result=r.finish(MAX_SESSION_MS*2);
 assert.equal(result.durationMs,MAX_SESSION_MS);assert.equal(result.validMs,500);assert.equal(result.missingMs,MAX_SESSION_MS-500);
 assert.ok(normalizeSessionSummary(result));
});

test('summary validation strips extras, orders known labels and detaches data',()=>{
 const r=recorder();r.sample(seen('smile'),0);const input=r.finish(300);
 input.extra='ignored';input.counts.reverse();input.counts[0].secret='ignored';
 const out=normalizeSessionSummary(input);
 assert.ok(out);assert.equal(out.extra,undefined);assert.deepEqual(out.counts.map(item=>item.id),EXPRESSION_LIBRARY.map(item=>item.id));
 assert.equal(out.counts.find(item=>item.secret),undefined);
 input.counts[0].episodes=1234;assert.equal(out.counts.at(-1).episodes,0);
});

test('summary validation rejects invalid identity, duplicate or unknown labels and inconsistent accounting',()=>{
 const r=recorder();r.sample(seen('smile'),0);const good=r.finish(300);
 const mutations=[
  x=>x.sessionId='not-a-session',x=>x.sessionId=[identity.sessionId],x=>x.role='C',x=>x.mode='recorded',x=>x.revision=-1,x=>x.revision=.5,
  x=>x.durationMs=Infinity,x=>x.durationMs=-1,x=>x.durationMs=MAX_SESSION_MS+1,
  x=>x.validMs=301,x=>x.missingMs=1,x=>x.counts.pop(),
  x=>x.counts[0].id=x.counts[1].id,x=>x.counts[0].id='untrusted',
  x=>x.counts[0].durationMs=-1,x=>x.counts[0].episodes=1.1,x=>x.counts[0].episodes=1_000_001,
  x=>x.counts[1].episodes=0,x=>x.counts[1].durationMs=299,
 ];
 for(const mutate of mutations){const input=structuredClone(good);mutate(input);assert.equal(normalizeSessionSummary(input),null,String(mutate));}
 for(const value of [null,undefined,[],{},'bad'])assert.equal(normalizeSessionSummary(value),null);
});

test('tiny floating point total differences are accepted without coercing strings',()=>{
 const r=recorder();r.sample(seen('smile'),0);const value=r.finish(.3);
 value.validMs=.1+.2;value.missingMs=0;assert.ok(normalizeSessionSummary(value));
 value.counts[1].durationMs='0.3';assert.equal(normalizeSessionSummary(value),null);
});

test('recorder rejects invalid construction rather than generating unusable summaries',()=>{
 assert.throws(()=>createExpressionRecorder(),TypeError);
 assert.throws(()=>recorder({role:'C'}),TypeError);
 assert.throws(()=>recorder({now:()=>NaN}),TypeError);
 assert.throws(()=>recorder({maxGapMs:0}),TypeError);
});

const observed=(id,actions)=>({expressionId:id,valid:true,actions});

test('activity timeline includes the full axis and a fractional final time is floored safely',()=>{
 const r=recorder();
 for(let at=0;at<=1000;at+=100)r.sample(observed('neutral',{smile:0}),at);
 const result=r.finish(1123.7),timeline=result.timeline;
 assert.equal(timeline.metric,'facial-activity-v1');assert.equal(timeline.stepMs,250);
 assert.deepEqual(timeline.points[0],[0,0]);assert.deepEqual(timeline.points.at(-1),[1123,0]);
 assert.ok(normalizeSessionSummary(result));
});

test('timeline missing observations are null while observed stillness is zero',()=>{
 const r=recorder();r.sample(observed('neutral',{smile:0}),0);
 r.snapshot(1000);
 const stale=r.snapshot(1100).timeline.points;
 assert.ok(stale.some(([at,value])=>at>=500&&value===null));
 assert.deepEqual(stale[0],[0,0]);assert.equal(stale.at(-1)[1],null);
 r.sample(observed('smile',{smile:1}),1100);
 const recovered=r.finish(1200);
 assert.ok(recovered.timeline.points.some(([,v])=>v!==null&&v>30));
 assert.ok(recovered.timeline.points.some(([,v])=>v===null));
 assert.equal(recovered.validMs,600);assert.equal(recovered.missingMs,600);
});

test('short action events contribute a peak within their window even between cadence ticks',()=>{
 const r=recorder();r.sample(observed('neutral',{smile:0}),0);
 r.sample(observed('open-mouth',{jawOpen:1,browRaise:1}),40);
 r.sample(observed('neutral',{smile:0}),80);
 const result=r.finish(250);
 assert.ok(result.timeline.points[0][1]>10,'a 40ms event must leave visible activity evidence');
 assert.equal(row(result,'open-mouth').episodes,1);assert.equal(row(result,'open-mouth').durationMs,40);
});

test('no positive-length gap is invented for an invalid then valid sample at the same instant',()=>{
 const r=recorder();r.sample({valid:false},0);r.sample(observed('neutral',{smile:0}),0);
 assert.deepEqual(r.finish(100).timeline.points,[[0,0],[100,0]]);
});

test('live unavailable action data stays null even when emoji time is valid; demo is marked and numeric',()=>{
 const live=recorder(),demo=recorder({mode:'demo'});
 live.sample(seen('smile'),0);demo.sample(seen('smile'),0);
 const real=live.finish(200),synthetic=demo.finish(200);
 assert.equal(real.validMs,200);assert.ok(real.timeline.points.every(([,v])=>v===null));
 assert.equal(synthetic.mode,'demo');assert.ok(synthetic.timeline.points.every(([,v])=>typeof v==='number'));
});

test('adaptive window coarsening preserves early peaks, the full axis and at most 240 points',()=>{
 const r=recorder();r.sample(observed('smile',{smile:1}),0);
 for(let at=100;at<=180000;at+=100)r.sample(observed('neutral',{smile:0}),at);
 const result=r.finish(180123),{timeline}=result;
 assert.ok(timeline.stepMs>250);assert.ok(timeline.points.length<=240);
 assert.equal(timeline.points[0][0],0);assert.ok(timeline.points[0][1]>50);
 assert.equal(timeline.points.at(-1)[0],180123);
 assert.ok(timeline.points.every(([at],i,a)=>i===0||at>a[i-1][0]));
 assert.ok(normalizeSessionSummary(result));
 assert.ok(JSON.stringify({v:1,type:'session',body:{action:'final',sessionId:identity.sessionId,role:'A',summary:result}}).length<8192);
});

test('coarsening conservatively keeps any missing interval null instead of drawing through it',()=>{
 const r=recorder();r.sample(observed('smile',{smile:1}),0);
 r.sample({valid:false},100);r.sample(observed('smile',{smile:1}),150);
 for(let at=250;at<=120000;at+=250)r.sample(observed('smile',{smile:1}),at);
 const result=r.finish(120100);
 assert.ok(result.timeline.stepMs>250);assert.equal(result.timeline.points[0][1],null);
 assert.equal(result.missingMs,50);assert.ok(result.timeline.points.slice(1).some(([,v])=>v!==null));
});

test('24h timeline and the largest permitted 240-point envelope remain below 8192 bytes',()=>{
 const r=recorder();r.sample(observed('smile',{smile:1}),0);const result=r.finish(MAX_SESSION_MS);
 assert.ok(result.timeline.points.length<=240);assert.equal(result.timeline.points.at(-1)[0],MAX_SESSION_MS);
 const hostile=structuredClone(result);
 hostile.timeline.points=Array.from({length:240},(_,i)=>[Math.floor(MAX_SESSION_MS*i/239),99.9]);
 assert.ok(normalizeSessionSummary(hostile));
 const payload=JSON.stringify({v:1,type:'session',body:{action:'final',sessionId:identity.sessionId,role:'A',summary:hostile}});
 assert.ok(new TextEncoder().encode(payload).length<8192);
});

test('timeline remains detached and frozen after finish; legacy summaries without a timeline still validate',()=>{
 const r=recorder();r.sample(observed('neutral',{smile:0}),0);const done=r.finish(1000);
 const edited=r.snapshot(1000);edited.timeline.points[0][1]=99;edited.timeline.stepMs=500;
 assert.deepEqual(r.finish(99999),done);assert.deepEqual(r.sample(observed('smile',{smile:1}),5000),done);
 const legacy=structuredClone(done);delete legacy.timeline;
 assert.deepEqual(normalizeSessionSummary(legacy),legacy);
 const normalized=normalizeSessionSummary(done);normalized.timeline.points[0][1]=12;
 assert.equal(done.timeline.points[0][1],0);
});

test('timeline validation rejects hostile coordinates, values, limits and metric mismatches',()=>{
 const r=recorder();r.sample(observed('neutral',{smile:0}),0);const good=r.finish(1000);
 const changes=[
  t=>t.metric='emotion-confidence',t=>t.stepMs=0,t=>t.stepMs=251,t=>t.stepMs=NaN,t=>t.stepMs=MAX_SESSION_MS*2,
  t=>t.points=[],t=>t.points=Array.from({length:241},(_,i)=>[i,0]),t=>t.points[0]=[1,0],
  t=>t.points[1]=t.points[0],t=>t.points[1][0]=.5,t=>t.points[1][0]=Infinity,
  t=>t.points.at(-1)[0]=1001,t=>t.points.at(-1)[0]=999,
  t=>t.points[0][1]=-1,t=>t.points[0][1]=100.1,t=>t.points[0][1]=1.23,
  t=>t.points[0][1]='20',t=>t.points[0][1]=NaN,t=>t.points[0].push(1),
 ];
 for(const change of changes){const bad=structuredClone(good);change(bad.timeline);assert.equal(normalizeSessionSummary(bad),null,String(change));}
 for(const timeline of [null,[],false,'bad'])assert.equal(normalizeSessionSummary({...good,timeline}),null);
});
