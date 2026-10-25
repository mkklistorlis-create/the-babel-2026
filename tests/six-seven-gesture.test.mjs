import test from 'node:test';
import assert from 'node:assert/strict';
import {SixSevenGestureTracker} from '../public/six-seven-gesture.js';
import {HandTrackFilter} from '../public/tracking-math.js';

const hand=(id,x,y,t,extra={})=>({id,palm:{x,y,z:0},tip:{x,y:y-.05,z:0},timestamp:t,...extra});
const pair=(a,b,t)=>[hand('a',.75,a,t,{handedness:'Left'}),hand('b',.25,b,t,{handedness:'Right'})];
function activate(tracker,start=100,delay=0,options={}){
 tracker.update(pair(.42,.58,start),start+delay,options);
 return tracker.update(pair(.58,.42,start+250),start+250+delay,options);
}
function pose(closed=[true,true,true,true]){
 const bases=[{x:.39,y:.60,z:-.02},{x:.47,y:.55,z:-.03},{x:.55,y:.57,z:-.02},{x:.62,y:.63,z:0}];
 const landmarks=[{x:.5,y:.86,z:0},{x:.39,y:.78,z:0},{x:.31,y:.70,z:-.01},{x:.28,y:.62,z:-.02},{x:.25,y:.57,z:-.02}];
 for(let i=0;i<4;i++){
  const b=bases[i],s=i===3?.72:i===0?.88:1;landmarks.push({...b});
  for(const [dy,dz]of closed[i]?[[-.13,-.08],[-.07,-.16],[.07,-.09]]:[[-.17,0],[-.27,-.005],[-.36,-.01]])
   landmarks.push({x:b.x,y:b.y+dy*s,z:b.z+dz*s});
 }
 return landmarks;
}
const fists=t=>pair(.58,.42,t).map(h=>({...h,landmarks:pose()}));

test('one vertical height exchange activates and assigns 6/7 to original mirrored hands',()=>{
 const tracker=new SixSevenGestureTracker();
 const result=activate(tracker,100,430);
 assert.equal(result.latched,true);assert.equal(result.active,true);assert.equal(result.opacity,1);
 assert.deepEqual(result.hands.map(h=>[h.id,h.digit]),[['a','6'],['b','7']]);
 assert.equal(result.diagnostics.crossings,1);
});
test('static hands, one visible hand, horizontal movement and near-level jitter never start it',()=>{
 for(const kind of ['still','one','horizontal','together','jitter']){
  const tracker=new SixSevenGestureTracker();
  for(let i=0;i<30;i++){
   const t=100+i*150,w=Math.sin(i)*.1;let hands=pair(.5,.5,t);
   if(kind==='one')hands=[hand('a',.75,.5+w,t)];
   if(kind==='horizontal')hands.forEach((h,n)=>{h.palm.x+=n?w:-w;h.tip.x=h.palm.x;});
   if(kind==='together')hands=pair(.5+w,.5+w,t);
   if(kind==='jitter')hands=pair(.5+w*.03,.5-w*.03,t);
   assert.equal(tracker.update(hands,t).latched,false,kind);
  }
 }
});
test('level hands first establish one side; only a new measured exchange triggers',()=>{
 const tracker=new SixSevenGestureTracker();
 tracker.update(pair(.5,.5,100),100);
 const first=pair(.44,.56,350);assert.equal(tracker.update(first,350).latched,false);
 for(let now=370;now<900;now+=16)assert.equal(tracker.update(first,now).latched,false);
 assert.equal(tracker.update(pair(.56,.44,950),950).latched,true);
});
test('numbers remain fully visible indefinitely while fresh hands are stationary',()=>{
 const tracker=new SixSevenGestureTracker();activate(tracker);
 for(let t=600;t<20600;t+=250){
  const state=tracker.update(pair(.58,.42,t),t);
  assert.equal(state.latched,true);assert.equal(state.active,true);assert.equal(state.opacity,1);
 }
});
test('one hand can leave for a long time; its numeral hides and the other keeps following',()=>{
 const tracker=new SixSevenGestureTracker();activate(tracker);
 for(let t=600;t<10600;t+=250){
  const state=tracker.update([hand('a',.75,.58,t,{handedness:'Left'})],t);
  assert.equal(state.latched,true);assert.equal(state.hands.length,1);assert.equal(state.hands[0].digit,'6');
 }
 const both=tracker.update(pair(.57,.43,10600),10600);
 assert.equal(both.hands.length,2);assert.equal(both.latched,true);
});
test('brief total misses hide both numerals but retain the latch; both absent for a second end it',()=>{
 const tracker=new SixSevenGestureTracker();activate(tracker);
 const missing=tracker.update([],600);assert.equal(missing.active,false);assert.equal(missing.latched,true);assert.deepEqual(missing.hands,[]);
 assert.equal(tracker.update(pair(.58,.42,1100),1100).latched,true);
 tracker.update([],1200);
 assert.equal(tracker.update([],2199).latched,true);
 const stopped=tracker.update([],2200);assert.equal(stopped.latched,false);assert.equal(stopped.diagnostics.status,'stopped-missing');
 assert.equal(tracker.update(pair(.58,.42,2300),2300).latched,false);
 assert.equal(tracker.update(pair(.42,.58,2550),2550).latched,true);
});
test('two fists stop only after two fresh observations; cached frames cannot confirm closure',()=>{
 const tracker=new SixSevenGestureTracker();activate(tracker);
 const first=fists(600);assert.equal(tracker.update(first,600).latched,true);
 for(let t=616;t<1100;t+=16)assert.equal(tracker.update(first,t).latched,true);
 const stopped=tracker.update(fists(1100),1100);
 assert.equal(stopped.latched,false);assert.equal(stopped.diagnostics.status,'stopped-fists');assert.equal(stopped.diagnostics.fistHands,2);
 for(let t=1350;t<=1850;t+=250)assert.equal(tracker.update(fists(t),t).latched,false,'closed hands cannot rearm');
 assert.equal(tracker.update(pair(.58,.42,2100),2100).latched,false);
 assert.equal(tracker.update(pair(.42,.58,2350),2350).latched,true);
});
test('one fist or two pointing index fingers do not stop the accessory',()=>{
 for(const kind of ['one-fist','pointing']){
  const tracker=new SixSevenGestureTracker();activate(tracker);
  for(let t=600;t<2600;t+=250){
   const hands=pair(.58,.42,t).map((h,i)=>({...h,landmarks:pose(kind==='pointing'?[false,true,true,true]:i?[false,false,false,false]:[true,true,true,true])}));
   assert.equal(tracker.update(hands,t).latched,true,kind);
  }
 }
});
test('hand IDs may renew or arrays reorder without losing the latch or exchanging numerals',()=>{
 const tracker=new SixSevenGestureTracker();activate(tracker);
 for(let i=1;i<=12;i++){
  const t=350+i*650;
  const hands=pair(.58,.42,t).map((h,n)=>({...h,id:'renewed-'+i+'-'+n,breakTrail:true})).reverse();
  const state=tracker.update(hands,t+430);assert.equal(state.active,true);
  assert.deepEqual(new Map(state.hands.map(h=>[h.handedness,h.digit])),new Map([['Left','6'],['Right','7']]));
 }
});
test('true tracking loss, invalid input, a new person and disable still clear the latch',()=>{
 for(const kind of ['stale','invalid','owner','disabled']){
  const tracker=new SixSevenGestureTracker();activate(tracker,100,0,{owner:'first'});
  const observed=kind==='invalid'?null:pair(.58,.42,600),now=kind==='stale'?2900:600;
  const state=tracker.update(observed,now,{owner:kind==='owner'?'second':'first',enabled:kind!=='disabled'});
  assert.equal(state.latched,false,kind);
 }
});
test('out-of-order data cannot move an active attachment or manufacture a new crossing',()=>{
 const tracker=new SixSevenGestureTracker();activate(tracker);
 const state=tracker.update(pair(.2,.8,200),500);
 assert.equal(state.latched,true);assert.equal(state.hands[0].palm.y,.58);
 tracker.reset();tracker.update(pair(.42,.58,500),500);
 assert.equal(tracker.update(pair(.58,.42,400),600).latched,false);
});

const measuredHand=(x,y,handedness)=>({handedness,score:.99,palm:{x,y,z:0},
 landmarks:Array.from({length:21},(_,i)=>({x:x+(i%4)*.001,y:y+(i===8?-.04:0),z:0}))});
function livePipeline({cadence,delay,together=false,missingEvery=0}){
 const filter=new HandTrackFilter(),tracker=new SixSevenGestureTracker();
 let next=100,index=0,hands=[],lastAt=-Infinity,lastSource=-Infinity,firstActive=null,renewed=false,priorIds='';
 for(let now=100;now<12100;now+=16){
  if(now>=next+delay){
   const low=index===0?.42:.58,high=index===0?.58:.42;
   const raw=[measuredHand(.75,low,'Left'),measuredHand(.25,together?low:high,'Right')];
   if(missingEvery&&++index%missingEvery===0)raw.pop();else if(!missingEvery)index++;
   hands=filter.update(raw,next);lastAt=now;lastSource=next;next+=cadence;
   const ids=hands.map(h=>h.id).join(',');if(priorIds&&ids!==priorIds)renewed=true;priorIds=ids;
  }
  const result=tracker.update(hands,now,{enabled:now-lastAt<1400&&now-lastSource<2200,owner:'same-person'});
  if(result.active)firstActive??=now;
  if(firstActive&&hands.length)assert.equal(result.latched,true,'fresh stationary observations retain the latch');
 }
 return {firstActive,renewed};
}
test('single crossing survives slow CPU, identity renewal and rAF duplicates, then stays on at rest',()=>{
 for(const [cadence,delay]of[[480,430],[500,450],[600,550],[900,850]]){
  const result=livePipeline({cadence,delay});
  assert.ok(result.firstActive!==null&&result.firstActive<3500,cadence+'/'+delay);
  if(cadence>550)assert.equal(result.renewed,true);
  assert.equal(livePipeline({cadence,delay,together:true}).firstActive,null);
 }
});
test('occasional missing single hands do not end the latched state in the full hand filter pipeline',()=>{
 assert.ok(livePipeline({cadence:333,delay:280,missingEvery:4}).firstActive!==null);
});
