// Temporal filters for observed geometry. These do not invent people or infer emotion.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const copy=points=>points.map(p=>({x:p.x,y:p.y}));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function signedArea(points){let sum=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];sum+=a.x*b.y-b.x*a.y;}return sum/2;}

/** Match a closed contour's winding and cyclic starting index to the preceding
 * frame. Otherwise a harmless boundary start change can morph a face into a fan.
 * Coarse search is followed by a full-resolution local refinement.
 */
export function alignContour(previous,next){
 if(!previous?.length||previous.length!==next?.length)return copy(next||[]);
 const n=next.length;
 const source=signedArea(previous)*signedArea(next)<0?[...next].reverse():next;
 const score=(shift,stride)=>{let error=0;for(let i=0;i<n;i+=stride){const a=previous[i],b=source[(i+shift)%n];error+=(a.x-b.x)**2+(a.y-b.y)**2;}return error;};
 const step=n>80?4:1,sample=Math.max(1,Math.floor(n/48));
 let best=0,bestScore=Infinity;
 for(let shift=0;shift<n;shift+=step){const error=score(shift,sample);if(error<bestScore){bestScore=error;best=shift;}}
 const coarse=best;bestScore=Infinity;
 for(let offset=-step;offset<=step;offset++){const shift=(coarse+offset+n)%n,error=score(shift,1);if(error<bestScore){bestScore=error;best=shift;}}
 return Array.from({length:n},(_,i)=>({x:source[(i+best)%n].x,y:source[(i+best)%n].y}));
}

/** Adaptive low-pass + subpixel deadzone. Slow noisy boundaries settle; genuine
 * broad motion gets a larger gain. No points or concavities are removed.
 * dt is seconds (not milliseconds), bounded to keep reacquisition responsive.
 */
export function stabilizeContour(previous,next,dt=.1){
 if(!previous?.length||previous.length!==next?.length)return copy(next||[]);
 const aligned=alignContour(previous,next),delta=aligned.map((p,i)=>distance(p,previous[i]));
 const mean=delta.reduce((a,b)=>a+b,0)/delta.length;
 const elapsed=clamp(Number(dt)||.1,.016,.3);
 return aligned.map((point,i)=>{
  const old=previous[i],d=delta[i];
  if(d<.0018)return {x:old.x,y:old.y};
  // Broad coherent movement raises the base gain, while a local hand movement
  // still responds independently. Tiny mask flicker has low gain.
  const speed=Math.max(mean*.8,d)/elapsed;
  const hz=.6+Math.min(8,Math.max(0,speed-.1)*15);
  const alpha=1-Math.exp(-2*Math.PI*hz*elapsed);
  return {x:old.x+(point.x-old.x)*alpha,y:old.y+(point.y-old.y)*alpha};
 });
}

export function smoothBBox(previous,next,dt=.1){
 if(!previous)return {...next};
 const elapsed=clamp(Number(dt)||.1,.016,.3),result={};
 for(const key of ['x','y','width','height']){
  const d=next[key]-previous[key];
  if(Math.abs(d)<.0015){result[key]=previous[key];continue;}
  const hz=1.0+Math.min(7,Math.abs(d)/elapsed*18);
  const alpha=1-Math.exp(-2*Math.PI*hz*elapsed);
  result[key]=previous[key]+d*alpha;
 }
 return result;
}

/** Reject a lone large landmark jump before adapting the smoothing gain.
 * A second nearby observation or coherent continuation accepts genuine motion
 * after one frame. This is a custom outlier filter, not an emotion classifier.
 */
export class RobustPointFilter{
 constructor(){this.reset();}
 reset(){this.point=null;this.raw=null;this.pending=null;this.velocity=0;this.accepted=false;}
 update(next,dt=.1){
  this.accepted=false;
  if(!next||!Number.isFinite(next.x)||!Number.isFinite(next.y))return this.point?{...this.point}:null;
  const value={x:next.x,y:next.y},elapsed=clamp(Number(dt)||.1,.016,.4);
  if(!this.point){this.point={...value};this.raw={...value};this.accepted=true;return {...value};}
  const delta=distance(this.raw,value),limit=Math.max(.065,Math.min(.18,.035+this.velocity*elapsed*2));
  if(delta>limit){
   let confirmed=false;
   if(this.pending){
    const a={x:this.pending.x-this.raw.x,y:this.pending.y-this.raw.y},b={x:value.x-this.pending.x,y:value.y-this.pending.y};
    const before=Math.hypot(a.x,a.y),after=Math.hypot(b.x,b.y),dot=(a.x*b.x+a.y*b.y)/Math.max(1e-9,before*after);
    confirmed=after<.035||(dot>.8&&after<before*1.25);
   }
   if(!confirmed){this.pending=value;return {...this.point};}
  }
  this.pending=null;this.accepted=true;
  const velocityAlpha=1-Math.exp(-2*Math.PI*1.2*elapsed);
  this.velocity+=velocityAlpha*(delta/elapsed-this.velocity);
  this.raw=value;
  const d=distance(this.point,value);
  if(d<.002)return {...this.point};
  const hz=.85+Math.min(7,this.velocity*6),alpha=1-Math.exp(-2*Math.PI*hz*elapsed);
  this.point={x:this.point.x+(value.x-this.point.x)*alpha,y:this.point.y+(value.y-this.point.y)*alpha};
  return {...this.point};
 }
}

/** Hold the right to finish this participant's local utterance through a short
 * visual miss. A healthy independent count guard is mandatory throughout.
 * Epochs are monotonic across revocation/reacquisition so an old ASR response
 * cannot be attached to a later participant/session.
 */
export class InputOwnershipGate{
 constructor({holdMs=900}={}){this.holdMs=holdMs;this.epoch=0;this.active=false;this.confirmedAt=-Infinity;}
 invalidate(){if(this.active)this.epoch++;this.active=false;this.confirmedAt=-Infinity;return this.state(false);}
 state(eligible){return {inputEligible:eligible,ownershipEpoch:this.epoch,inputEligibleUntil:eligible?this.confirmedAt+this.holdMs:0};}
 update({occupancy,observedPeopleCount=0,countGuardHealthy=false,fresh=false,now,observedAt=now}){
  if(!Number.isFinite(now)||!countGuardHealthy||occupancy==='multiple'||observedPeopleCount>=2)return this.invalidate();
  if(occupancy==='single'&&fresh&&Number.isFinite(observedAt)&&now-observedAt<this.holdMs){
   if(!this.active){this.epoch++;this.active=true;}
   this.confirmedAt=Math.min(now,observedAt);
   return this.state(true);
  }
  if(this.active&&now-this.confirmedAt<this.holdMs)return this.state(true);
  return this.invalidate();
 }
}

const ACTION_KEYS=['smile','browRaise','browRaiseLeft','browRaiseRight','browLower','jawOpen','eyeWide','mouthPucker','eyeBlinkLeft','eyeBlinkRight','eyeSquint','mouthFrown',
 'eyeWideLeft','eyeWideRight','eyeSquintLeft','eyeSquintRight',
 'eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight',
 'eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight'];
export function smoothFacialActions(previous,next,dt=.1){
 if(!next)return null;
 const elapsed=clamp(Number(dt)||.1,.016,.4),alpha=1-Math.exp(-elapsed/.12),result={};
 for(const key of ACTION_KEYS){
  const measurement=Number(next[key]),value=Number.isFinite(measurement)?clamp(measurement,0,1):0;
  const prior=previous&&Number.isFinite(previous[key])?clamp(previous[key],0,1):null;
  result[key]=prior===null?value:prior+(value-prior)*alpha;
 }
 return result;
}

/** A face attachment uses only a measured face matrix. A single large angle
 * jump is held for one observation; a sustained turn is accepted. */
export class HeadPoseFilter{
 constructor(){this.reset();}
 reset(){this.value=null;this.pending=null;}
 update(next,dt=.1){
  if(!next||!['yaw','pitch','roll'].every(key=>Number.isFinite(next[key]))){this.reset();return null;}
  const bounded={yaw:clamp(next.yaw,-1.35,1.35),pitch:clamp(next.pitch,-1.15,1.15),roll:clamp(next.roll,-1.5,1.5)};
  if(!this.value){this.value=bounded;return {...bounded};}
  const delta=Math.max(...Object.keys(bounded).map(key=>Math.abs(bounded[key]-this.value[key])));
  if(delta>.65&&(!this.pending||Math.max(...Object.keys(bounded).map(key=>Math.abs(bounded[key]-this.pending[key])))>.2)){
   this.pending=bounded;return {...this.value};
  }
  this.pending=null;
  const alpha=1-Math.exp(-clamp(Number(dt)||.1,.016,.4)/.075);
  for(const key of Object.keys(bounded))if(Math.abs(bounded[key]-this.value[key])>.006)this.value[key]+=(bounded[key]-this.value[key])*alpha;
  return {...this.value};
 }
}

/** Match up to two measured hands by position and handedness, independently of
 * detection-array ordering. Only currently observed hands are emitted. Missing
 * observations break ink strokes; short reacquisition can keep the same id. */
export class HandTrackFilter{
 constructor(){this.nextId=0;this.reset();}
 reset(){this.tracks=[];this.lastTimestamp=-Infinity;}
 update(hands,timestamp){
  if(!Number.isFinite(timestamp))return [];
  if(timestamp<this.lastTimestamp)this.reset();
  const current=(hands||[]).filter(h=>h.landmarks?.length===21&&h.landmarks.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z))&&h.palm&&Number.isFinite(h.palm.x)&&Number.isFinite(h.palm.y)).slice(0,2);
  // Sequential CPU vision can produce only 3–5 observations/second. Keep a
  // continuous measured stroke through that cadence, but never a missing
  // observation or an unbounded spatial jump.
  const continuityMs=550;
  const previous=this.tracks.filter(t=>timestamp-t.seen<=continuityMs);
  const cost=(t,h)=>{
   const dt=clamp((timestamp-t.seen)/1000,.016,.35),d=distance(t.palm,h.palm);
   if(d>Math.min(.65,.18+dt*1.8))return Infinity;
   const mismatch=t.handedness!=='Unknown'&&h.handedness!=='Unknown'&&t.handedness!==h.handedness;
   return d+(mismatch?.16:0);
  };
  // Exhaustive assignment is tiny (at most 2x2), and avoids a greedy first
  // match stealing the second hand's identity during crossing or reorder.
  let assignment=[],best=Infinity;
  function choose(index,used,chosen,total){
   if(index===current.length){if(total<best){best=total;assignment=chosen.slice();}return;}
   choose(index+1,used,[...chosen,-1],total+.5);
   for(let i=0;i<previous.length;i++)if(!used.has(i)){
    const c=cost(previous[i],current[index]);if(!Number.isFinite(c))continue;
    used.add(i);choose(index+1,used,[...chosen,i],total+c);used.delete(i);
   }
  }
  choose(0,new Set(),[],0);
  const observed=current.map((h,index)=>{
   const old=previous[assignment[index]],dt=old?clamp((timestamp-old.seen)/1000,.016,.35):.1;
   const travel=old?distance(old.palm,h.palm):0,alpha=1-Math.exp(-dt/(travel>.02?.035:.075));
   const landmarks=h.landmarks.map((p,i)=>{const prev=old?.landmarks[i];return prev?{x:prev.x+(p.x-prev.x)*alpha,y:prev.y+(p.y-prev.y)*alpha,z:prev.z+(p.z-prev.z)*alpha}:{...p};});
   const palm={x:0,y:0,z:0};for(const i of [0,5,9,13,17])for(const key of ['x','y','z'])palm[key]+=landmarks[i][key]/5;
   return {id:old?.id||`hand-${++this.nextId}`,handedness:old?.handedness&&old.handedness!=='Unknown'?old.handedness:h.handedness||'Unknown',score:h.score||0,landmarks,palm,tip:{...landmarks[8]},wrist:{...landmarks[0]},timestamp,seen:timestamp,breakTrail:!old||old.seen!==this.lastTimestamp||timestamp-old.seen>continuityMs};
  });
  const assignedIds=new Set(observed.map(h=>h.id));
  this.tracks=[...observed,...previous.filter(h=>!assignedIds.has(h.id))];this.lastTimestamp=timestamp;
  return observed.map(({seen,...hand})=>hand);
 }
}

export class ContourFilter{
 constructor(){this.points=null;}
 update(points,dt=.1){this.points=stabilizeContour(this.points,points,dt);return this.points;}
 reset(){this.points=null;}
}

/** This device admits one participant. A second person blocks attribution
 * immediately. Reopening requires at least three distinct single-person
 * observations spanning a second, so intermittent misses cannot flicker it.
 */
export class SinglePersonGate{
 constructor(){this.reset();}
 reset(){this.blocked=false;this.singleSince=null;this.samples=0;this.lastTimestamp=-Infinity;this.previousState='empty';}
 update(state,observedCount,nowMs){
  const now=Number(nowMs);
  if(!Number.isFinite(now))return 'uncertain';
  if(now<this.lastTimestamp)this.reset();
  const previousTime=this.lastTimestamp,fresh=now>previousTime;
  this.lastTimestamp=now;
  const observed=observedCount>=2?'multiple':['empty','single','multiple','uncertain'].includes(state)?state:'uncertain';
  if(observed==='multiple'){this.blocked=true;this.singleSince=null;this.samples=0;}
  else if(this.blocked){
   if(observed==='single'){
    if(this.previousState!=='single'||this.singleSince===null||now-previousTime>1600){this.singleSince=now;this.samples=0;}
    if(fresh)this.samples++;
    if(now-this.singleSince>=1000&&this.samples>=3){this.blocked=false;this.singleSince=null;this.samples=0;}
   }else{this.singleSince=null;this.samples=0;}
  }
  this.previousState=observed;
  return this.blocked?'multiple':observed;
 }
}
