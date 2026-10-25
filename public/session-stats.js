import {EXPRESSION_LIBRARY} from './expressions.js';
import {createFacialActivityTracker,FACIAL_ACTIVITY_METRIC} from './expression-activity.js';

// Statistics describe observed emoji configurations, never inferred feelings.
export const MAX_SESSION_MS=24*60*60*1000;
const SESSION_ID=/^[a-f0-9]{32}$/;
const ids=EXPRESSION_LIBRARY.map(item=>item.id);
const knownIds=new Set(ids);
const MAX_REVISION=10_000_000,MAX_EPISODES=1_000_000;
const finiteDuration=value=>Number.isFinite(value)&&value>=0&&value<=MAX_SESSION_MS;
const near=(a,b)=>Math.abs(a-b)<=.01;
const validIdentity=({sessionId,role,mode}={})=>typeof sessionId==='string'&&SESSION_ID.test(sessionId)&&(role==='A'||role==='B')&&(mode==='live'||mode==='demo');
const BASE_TIMELINE_STEP=250,MAX_TIMELINE_POINTS=240;

function normalizeTimeline(input,durationMs){
 if(!input||typeof input!=='object'||Array.isArray(input)||input.metric!==FACIAL_ACTIVITY_METRIC||
    !Number.isSafeInteger(input.stepMs)||input.stepMs<BASE_TIMELINE_STEP||input.stepMs>MAX_SESSION_MS||
    !Number.isInteger(Math.log2(input.stepMs/BASE_TIMELINE_STEP))||!Array.isArray(input.points)||
    !input.points.length||input.points.length>MAX_TIMELINE_POINTS)return null;
 let previous=-1;
 const points=[];
 for(const point of input.points){
  if(!Array.isArray(point)||point.length!==2)return null;
  const [at,value]=point;
  if(!Number.isSafeInteger(at)||at<0||at>Math.floor(durationMs)||at<=previous||
     (value!==null&&(!Number.isFinite(value)||value<0||value>100||Math.abs(value*10-Math.round(value*10))>1e-8)))return null;
  previous=at;points.push([at,value]);
 }
 if(points[0][0]!==0||points.at(-1)[0]!==Math.floor(durationMs))return null;
 return {metric:FACIAL_ACTIVITY_METRIC,stepMs:input.stepMs,points};
}

/**
 * Events and regular observations feed 250ms windows. Every window stores its
 * peak, or null if ANY part of it lacked activity evidence. Coarsening doubles
 * the window width and repeats that rule, conservatively retaining gaps. The
 * full time axis survives: at most 239 windows plus the current/final endpoint.
 */
function createActivityTimeline(){
 let stepMs=BASE_TIMELINE_STEP,buckets=new Map();
 function merge(index,value){
  const old=buckets.get(index);
  if(old===undefined)buckets.set(index,value);
  else if(old===null||value===null)buckets.set(index,null);
  else buckets.set(index,Math.max(old,value));
 }
 function fit(end){
  while(Math.floor(end/stepMs)+1>MAX_TIMELINE_POINTS-1){
   const old=buckets;buckets=new Map();stepMs*=2;
   for(const [index,value] of old)merge(Math.floor(index/2),value);
  }
 }
 return {
  interval(start,end,value){
   if(end<=start)return;
   fit(end);
   for(let index=Math.floor(start/stepMs);index<=Math.floor(end/stepMs);index++){
    if(Math.min(end,(index+1)*stepMs)>Math.max(start,index*stepMs))merge(index,value);
   }
  },
  // A zero-duration invalid event is not a missing interval. The current
  // endpoint still exposes null; interval() marks gaps once time elapses.
  observe(at,value){fit(at);if(value!==null)merge(Math.floor(at/stepMs),value);},
  snapshot(end,value){
   fit(end);
   const points=[...buckets].sort((a,b)=>a[0]-b[0]).map(([index,peak])=>[index*stepMs,peak]);
   const at=Math.floor(end);
   if(!points.length)points.push([0,value]);
   if(points.at(-1)[0]<at)points.push([at,value]);
   return {metric:FACIAL_ACTIVITY_METRIC,stepMs,points};
  },
 };
}

/** Validate an untrusted cumulative snapshot; return fresh, library-ordered data. */
export function normalizeSessionSummary(input){
 if(!input||typeof input!=='object'||!validIdentity(input))return null;
 const {sessionId,role,mode,revision,durationMs,validMs,missingMs}=input;
 if(!Number.isSafeInteger(revision)||revision<0||revision>MAX_REVISION||
    ![durationMs,validMs,missingMs].every(finiteDuration)||
    !near(validMs+missingMs,durationMs)||validMs>durationMs+.01||missingMs>durationMs+.01||
    !Array.isArray(input.counts)||input.counts.length!==ids.length)return null;
 const byId=new Map();let total=0,episodes=0;
 for(const item of input.counts){
  if(!item||typeof item!=='object'||!knownIds.has(item.id)||byId.has(item.id)||
     !finiteDuration(item.durationMs)||!Number.isSafeInteger(item.episodes)||item.episodes<0||item.episodes>MAX_EPISODES||
     (item.durationMs>0&&item.episodes===0))return null;
  total+=item.durationMs;episodes+=item.episodes;
  byId.set(item.id,{id:item.id,durationMs:item.durationMs,episodes:item.episodes});
 }
 if(episodes>MAX_EPISODES||!near(total,validMs))return null;
 const output={sessionId,role,mode,revision,durationMs,validMs,missingMs,counts:ids.map(id=>byId.get(id))};
 if(input.timeline!==undefined){
  const timeline=normalizeTimeline(input.timeline,durationMs);
  if(!timeline)return null;
  output.timeline=timeline;
 }
 return output;
}

/**
 * Local monotonic-clock recorder. Call sample with an already stabilized emoji.
 * A sample owns the following interval until replaced, invalidated or expired.
 * Snapshots integrate elapsed time but never refresh a sample's expiry.
 * Missing observations close an episode. Every later valid entry starts one.
 */
export function createExpressionRecorder({sessionId,role,mode,now=()=>performance.now(),maxGapMs=500}={}){
 if(!validIdentity({sessionId,role,mode}))throw new TypeError('Invalid session identity');
 if(typeof now!=='function'||!Number.isFinite(maxGapMs)||maxGapMs<=0||maxGapMs>5000)throw new TypeError('Invalid recorder clock or freshness budget');
 const startedAt=now();
 if(!Number.isFinite(startedAt)||startedAt<0)throw new TypeError('Invalid recorder start time');
 const counts=ids.map(id=>({id,durationMs:0,episodes:0}));
 const entries=new Map(counts.map(item=>[item.id,item]));
 const activity=createFacialActivityTracker({mode,maxGapMs}),timeline=createActivityTimeline();
 let activityValue=null;
 let lastAt=startedAt,expiresAt=startedAt,current=null,revision=0,validMs=0,finished=false;
 function advance(at){
  if(finished||!Number.isFinite(at)||at<lastAt)return false;
  const end=Math.min(at,startedAt+MAX_SESSION_MS),dt=end-lastAt;
  if(dt>0){
   const observed=current?Math.max(0,Math.min(end,expiresAt)-lastAt):0;
   if(observed>0){entries.get(current).durationMs+=observed;validMs+=observed;}
   const evidenceEnd=Math.max(lastAt,Math.min(end,expiresAt));
   timeline.interval(lastAt-startedAt,evidenceEnd-startedAt,activityValue);
   timeline.interval(evidenceEnd-startedAt,end-startedAt,null);
   lastAt=end;
   // At the exact expiry a contiguous new observation can continue the episode.
   if(end>expiresAt){current=null;activityValue=null;activity.update({valid:false},end);}
   revision++;
  }
  if(at>=startedAt+MAX_SESSION_MS)finished=true;
  return !finished;
 }
 function copy(){
  const durationMs=lastAt-startedAt;
  return {sessionId,role,mode,revision,durationMs,validMs,missingMs:Math.max(0,durationMs-validMs),counts:counts.map(item=>({...item})),
   timeline:timeline.snapshot(durationMs,activityValue)};
 }
 return {
  sample(input,at=now()){
   if(advance(at)){
    const next=input?.valid===true&&knownIds.has(input.expressionId)?input.expressionId:null;
    if(next!==current){
     current=next;revision++;
     if(next)entries.get(next).episodes++;
    }
    const previousActivity=activityValue;
    activityValue=activity.update({...input,valid:Boolean(next)},lastAt);
    timeline.observe(lastAt-startedAt,activityValue);
    if(previousActivity!==activityValue)revision++;
    expiresAt=lastAt+maxGapMs;
   }
   return copy();
  },
  snapshot(at=now()){advance(at);return copy();},
  finish(at=now()){advance(at);finished=true;return copy();},
 };
}
