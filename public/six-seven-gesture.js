/** One vertical hand-order swap starts a latched accessory. Fresh observations
 * move it; two missing hands or two sustained fists end it. No motion timer.
 */
import {isClosedFist} from './hand-pose.js';
const validPoint=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const knownSide=h=>h?.handedness==='Left'||h?.handedness==='Right';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

export class SixSevenGestureTracker{
 constructor({crossThreshold=.012,staleAfterMs=2200,maxGapMs=1400,exitHoldMs=1000,fistHoldMs=200,maxJump=.4}={}){
  Object.assign(this,{crossThreshold,staleAfterMs,maxGapMs,exitHoldMs,fistHoldMs,maxJump});this.reset();
 }
 reset(){
  this._owner=undefined;this._time=-Infinity;this._slots=[];this._visible=[];
  this._latched=false;this._side=0;this._lastSource=-Infinity;this._pairSource=-Infinity;
  this._missingSince=null;this._fistSince=null;this._fistSamples=0;this._fistHands=0;
  this._sampleInterval=null;this._status='waiting-hands';
 }
 _stop(status){
  this._latched=false;this._side=0;this._fistSince=null;this._fistSamples=0;this._status=status;
 }
 _seed(hands){
  this._slots=[...hands].sort((a,b)=>b.palm.x-a.palm.x).map((hand,i)=>({digit:i?'7':'6',hand}));
  this._side=0;this._pairSource=-Infinity;
 }
 _result(now,observed){
  const timestamps=observed.map(h=>h?.timestamp).filter(Number.isFinite);
  const hands=this._latched?this._visible.map(({hand,digit})=>({...hand,digit})):[];
  return {active:this._latched&&hands.length>0,latched:this._latched,hands,opacity:this._latched?1:0,
   diagnostics:{status:this._status,crossings:this._latched?1:0,trackedHands:observed.length,fistHands:this._fistHands,
    sourceAgeMs:timestamps.length?Math.max(0,now-Math.min(...timestamps)):null,sampleIntervalMs:this._sampleInterval}};
 }
 _assign(observed){
  const orders=observed.length===2?[[0,1],[1,0]]:[[0],[1]];
  let best=null,cost=Infinity;
  for(const indices of orders){
   let total=0;
   for(let i=0;i<observed.length;i++){
    const hand=observed[i],slot=this._slots[indices[i]];
    const exact=this._slots.findIndex(s=>s.hand.id===hand.id);
    if(exact!==-1&&exact!==indices[i]){total=Infinity;break;}
    const travel=distance(hand.palm,slot.hand.palm);
    if(!this._latched&&travel>this.maxJump){total=Infinity;break;}
    total+=travel+(knownSide(hand)&&knownSide(slot.hand)&&hand.handedness!==slot.hand.handedness ? .35 : 0);
   }
   if(total<cost){cost=total;best=indices;}
  }
  return best;
 }
 update(hands,now,{enabled=true,owner=null}={}){
  const observed=Array.isArray(hands)?hands:[];
  if(!Number.isFinite(now)){this.reset();this._status='invalid';return this._result(0,[]);}
  if(!enabled){this.reset();this._status='disabled';return this._result(now,observed);}
  if(this._owner!==owner||now<this._time)this.reset();
  this._owner=owner;this._time=now;
  if(!Array.isArray(hands)||observed.length>2||observed.some(h=>typeof h?.id!=='string'||!h.id
   ||!validPoint(h.palm)||!validPoint(h.tip)||!Number.isFinite(h.timestamp)||h.timestamp>now+50)
   ||observed.length===2&&observed[0].id===observed[1].id){
   this.reset();this._status='invalid';return this._result(now,observed);
  }
  if(observed.some(h=>now-h.timestamp>this.staleAfterMs)){
   this.reset();this._status='stale';return this._result(now,observed);
  }
  if(!observed.length){
   this._visible=[];this._fistHands=0;this._fistSince=null;this._fistSamples=0;
   this._missingSince??=now;
   if(now-this._missingSince>=this.exitHoldMs){
    this._stop('stopped-missing');this._slots=[];this._pairSource=-Infinity;
   }else this._status=this._latched?'missing':'waiting-hands';
   return this._result(now,observed);
  }
  const timestamp=Math.min(...observed.map(h=>h.timestamp));
  // Rendering repeats each observation many times; these repeats cannot cross
  // heights or accumulate the two distinct samples needed to confirm fists.
  if(timestamp<=this._lastSource)return this._result(now,observed);
  this._sampleInterval=Number.isFinite(this._lastSource)?timestamp-this._lastSource:null;
  this._lastSource=timestamp;this._missingSince=null;
  if(this._slots.length!==2){
   if(observed.length<2){this._visible=[];this._status='waiting-hands';return this._result(now,observed);}
   this._seed(observed);
  }
  let assignment=this._assign(observed);
  if(!assignment){
   this._side=0;this._visible=[];
   if(observed.length!==2){this._status='waiting-hands';return this._result(now,observed);}
   this._seed(observed);assignment=this._assign(observed);
  }
  for(let i=0;i<observed.length;i++)this._slots[assignment[i]].hand=observed[i];
  this._visible=assignment.map(index=>this._slots[index]);
  this._fistHands=observed.filter(isClosedFist).length;
  if(observed.length<2){
   // A single visible hand keeps its own numeral. The missing hand has no
   // fabricated position; the latch stays on until both hands leave.
   this._fistSince=null;this._fistSamples=0;
   if(!this._latched)this._side=0;
   this._status=this._latched?'partial':'waiting-hands';return this._result(now,observed);
  }
  if(this._fistHands===2){
   this._fistSince??=timestamp;this._fistSamples++;
   if(this._fistSamples>=2&&timestamp-this._fistSince>=this.fistHoldMs)this._stop('stopped-fists');
   else this._status=this._latched?'confirming-fists':'waiting-open';
   this._side=0;this._pairSource=timestamp;return this._result(now,observed);
  }
  this._fistSince=null;this._fistSamples=0;
  if(!this._latched&&timestamp-this._pairSource>this.maxGapMs)this._side=0;
  this._pairSource=timestamp;
  const delta=this._slots[0].hand.palm.y-this._slots[1].hand.palm.y;
  const side=Math.abs(delta)>=this.crossThreshold?Math.sign(delta):0;
  if(!this._latched&&side){
   if(this._side&&side!==this._side)this._latched=true;
   this._side=side;
  }
  this._status=this._latched?'active':'ready';
  return this._result(now,observed);
 }
}
