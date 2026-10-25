// R07: a small visual vocabulary of observed facial configurations.
// These labels describe movements, not a person's feelings, intent or speech.
export const EXPRESSION_LIBRARY=Object.freeze([
 {id:'neutral',emoji:'😐',label:'自然表情',description:'没有持续的明显面部动作'},
 {id:'smile',emoji:'😀',label:'嘴角上扬',description:'持续的微笑形状'},
 {id:'open-mouth',emoji:'😮',label:'张口抬眉',description:'张口，同时抬眉或睁大眼睛'},
 {id:'wink',emoji:'😉',label:'单眼闭合',description:'一只眼持续闭合，另一只眼睁开'},
 {id:'eyes-closed',emoji:'😌',label:'双眼闭合',description:'双眼持续闭合，忽略普通眨眼'},
 {id:'pucker',emoji:'😗',label:'噘嘴',description:'嘴唇向前收拢'},
 {id:'brow-furrow',emoji:'😠',label:'皱眉',description:'眉部持续下压'},
 {id:'squint-smile',emoji:'😄',label:'眯眼微笑',description:'嘴角上扬，同时眼睛眯起'},
 {id:'open-smile',emoji:'😃',label:'张嘴微笑',description:'嘴角上扬，同时张开嘴'},
 {id:'closed-laugh',emoji:'😆',label:'闭眼张嘴笑',description:'嘴角上扬、张嘴，并持续闭合双眼'},
 {id:'one-brow',emoji:'🤨',label:'单边抬眉',description:'一侧眉毛明显高于另一侧'},
 {id:'mouth-frown',emoji:'🙁',label:'嘴角下压',description:'嘴角持续向下收拢'},
 {id:'raised-eyes',emoji:'😳',label:'睁大双眼',description:'双眼持续睁大，嘴部保持较闭合'},
 {id:'closed-pucker',emoji:'😙',label:'闭眼噘嘴',description:'嘴唇收拢，并持续闭合双眼'},
 {id:'eyes-narrow',emoji:'😑',label:'双眼眯起',description:'双眼持续眯起，嘴部可以保持自然'},
 {id:'one-eye-squint',emoji:'🧐',label:'单眼眯起',description:'一只眼明显眯起，另一只眼保持睁开'},
 {id:'gaze-side',emoji:'👀',label:'视线侧移',description:'头部基本朝前，双眼持续朝同一侧看'},
 {id:'gaze-up',emoji:'🙄',label:'视线上移',description:'头部基本朝前，双眼持续向上看'},
].map(Object.freeze));

const byId=new Map(EXPRESSION_LIBRARY.map(item=>[item.id,item]));
const gazeKeys=['eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight','eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight'];
const keys=['smile','browRaise','browRaiseLeft','browRaiseRight','browLower','jawOpen','eyeWide','mouthPucker','eyeBlinkLeft','eyeBlinkRight','eyeSquint','mouthFrown',
 'eyeWideLeft','eyeWideRight','eyeSquintLeft','eyeSquintRight',...gazeKeys];
const clamp=value=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
const rules={
 'smile':{enter:.45,exit:.31,dwell:220,bias:0},
 'open-mouth':{enter:.58,exit:.40,dwell:260,bias:.03},
 'wink':{enter:.70,exit:.49,dwell:360,bias:.16},
 'eyes-closed':{enter:.68,exit:.46,dwell:550,bias:.08},
 'pucker':{enter:.52,exit:.35,dwell:300,bias:.04},
 'brow-furrow':{enter:.50,exit:.34,dwell:400,bias:0},
 'squint-smile':{enter:.55,exit:.38,dwell:300,bias:0,priority:2},
 'open-smile':{enter:.55,exit:.38,dwell:300,bias:.05,priority:2},
 'closed-laugh':{enter:.65,exit:.45,dwell:550,bias:0,priority:3},
 'one-brow':{enter:.60,exit:.40,dwell:400,bias:.04,priority:2},
 'mouth-frown':{enter:.50,exit:.34,dwell:400,bias:0},
 'raised-eyes':{enter:.50,exit:.34,dwell:350,bias:0,priority:2},
 'closed-pucker':{enter:.65,exit:.45,dwell:550,bias:0,priority:3},
 'eyes-narrow':{enter:.53,exit:.34,dwell:380,bias:0,priority:2},
 'one-eye-squint':{enter:.56,exit:.36,dwell:420,bias:0,priority:2},
 'gaze-side':{enter:.52,exit:.32,dwell:450,bias:0,priority:2},
 'gaze-up':{enter:.52,exit:.32,dwell:450,bias:0,priority:2},
};

function frontalHead(headPose){
 return Number.isFinite(headPose?.yaw)&&Number.isFinite(headPose?.pitch)&&Math.abs(headPose.yaw)<.6&&Math.abs(headPose.pitch)<.45;
}
function readActions(input,headPose){
 if(!input||!keys.some(key=>Number.isFinite(input[key])))return null;
 const values=Object.fromEntries(keys.map(key=>[key,clamp(input[key])]));
 // Preserve compatibility with aggregate-only observations. Native per-eye
 // channels always take precedence, including a measured zero.
 for(const base of ['eyeWide','eyeSquint'])for(const side of ['Left','Right']){
  const key=base+side;if(input[key]===undefined)values[key]=values[base];
 }
 // These are coarse eye-motion cues, not a calibrated screen gaze tracker.
 // Require a measured, mostly frontal head pose before accepting direction.
 if(!frontalHead(headPose))for(const key of gazeKeys)values[key]=0;
 return values;
}
function scoresFor(a){
 const closed=Math.min(a.eyeBlinkLeft,a.eyeBlinkRight),one=Math.max(a.eyeBlinkLeft,a.eyeBlinkRight);
 const wide=Math.min(a.eyeWideLeft,a.eyeWideRight),squint=Math.min(a.eyeSquintLeft,a.eyeSquintRight),squintMax=Math.max(a.eyeSquintLeft,a.eyeSquintRight);
 const open=1-one;
 // In/out are relative to each eye: a coherent sideways glance needs one
 // outward eye and the opposite inward eye. Opposing signals do not count.
 const left=Math.min(a.eyeLookOutLeft,a.eyeLookInRight),right=Math.min(a.eyeLookInLeft,a.eyeLookOutRight);
 const side=Math.max(left,right),up=Math.min(a.eyeLookUpLeft,a.eyeLookUpRight),down=Math.min(a.eyeLookDownLeft,a.eyeLookDownRight);
 const gazeOpen=open*(1-squintMax*.5);
 return {
  smile:a.smile,
  // Opening the mouth alone can occur while speaking; it is not a surprise cue.
  'open-mouth':Math.min(clamp(a.jawOpen*1.5),clamp(Math.max(a.eyeWide,a.browRaise)*2)),
  wink:one*clamp((one-closed)/.6)*(1-closed),
  'eyes-closed':closed,
  pucker:a.mouthPucker*(1-a.jawOpen*.7),
  'brow-furrow':a.browLower*(1-a.smile*.6),
  'squint-smile':Math.min(a.smile,clamp(a.eyeSquint*1.4))*(1-closed*.6),
  'open-smile':Math.min(a.smile,clamp(a.jawOpen*1.6))*(1-closed*.6),
  'closed-laugh':Math.min(a.smile,clamp(a.jawOpen*1.6),closed),
  'one-brow':Math.max(a.browRaiseLeft,a.browRaiseRight)*clamp(Math.abs(a.browRaiseLeft-a.browRaiseRight)/.6),
  'mouth-frown':a.mouthFrown*(1-a.smile*.8),
  'raised-eyes':clamp(wide*1.6)*open*(1-a.jawOpen*.85),
  'closed-pucker':Math.min(a.mouthPucker*(1-a.jawOpen*.7),closed),
  'eyes-narrow':clamp(squint*1.6)*open*(1-a.smile*.85),
  'one-eye-squint':squintMax*clamp(Math.abs(a.eyeSquintLeft-a.eyeSquintRight)/.45)*open,
  'gaze-side':clamp((side-.1)*1.8)*clamp(Math.abs(left-right)/.25)*gazeOpen*(1-up*.6),
  'gaze-up':clamp((up-.1)*1.8)*clamp((up-down)/.25)*gazeOpen*(1-side*.45),
 };
}
function result(id,score,visible,actions,changedAt){
 return {...byId.get(id),score:clamp(score),visible,actions:actions?{...actions}:null,changedAt};
}

/** Explicitly synthetic output for the no-camera demo; never used as live input. */
export function expressionForDemo(id='neutral'){
 return {...result(byId.has(id)?id:'neutral',1,true,null,0),demo:true};
}

/**
 * update(person, performance.now(), {eligible,owner}) ->
 * {id,emoji,label,description,score,visible,actions,changedAt}
 *
 * `score` is a bounded movement-match score, not calibrated emotion confidence.
 * `person` must have fresh faceSeen=true, stale=false and facialActions. A
 * numeric faceObservedAt/faceSampleAt can identify model samples; otherwise
 * object identity prevents a render loop from counting one sample repeatedly.
 * Eligibility/owner changes clear all history immediately. Caller should use
 * the tracking ownership epoch, not a reusable participant slot, as `owner`.
 */
export function createExpressionTracker({staleAfterMs=650}={}){
 let owner,lastTime,lastFreshAt,lastSample,filtered,current,candidate,candidateSince,candidateSamples,changedAt;
 function clear(){
  lastTime=null;lastFreshAt=-Infinity;lastSample=null;filtered=null;current='neutral';
  candidate=null;candidateSince=0;candidateSamples=0;changedAt=0;
 }
 function reset(){owner=undefined;clear();}
 reset();
 function output(visible){
  const scores=filtered?scoresFor(filtered):{};
  const score=current==='neutral'?1-Math.max(0,...Object.values(scores)):scores[current]||0;
  return result(current,score,visible,filtered,changedAt);
 }
 return {
  reset,
  update(person,now,{eligible=true,owner:nextOwner=null}={}){
   if(owner!==nextOwner){clear();owner=nextOwner;}
   if(!Number.isFinite(now)){clear();return output(false);}
   if(lastTime!==null&&now<lastTime)clear();
   lastTime=now;
   const raw=readActions(person?.facialActions,person?.headPose);
   if(!eligible||!person?.faceSeen||person.stale||!raw||
      (Number.isFinite(person.faceConfidence)&&person.faceConfidence<.5)){
    clear();lastTime=now;return output(false);
   }
   // Eligibility for eye direction is immediate. A smoothed value from an
   // earlier frontal sample cannot complete a dwell after head pose is lost.
   if(!frontalHead(person.headPose)){
    if(filtered)for(const key of gazeKeys)filtered[key]=0;
    if(current==='gaze-side'||current==='gaze-up'){current='neutral';changedAt=now;}
    if(candidate==='gaze-side'||candidate==='gaze-up'){candidate=null;candidateSamples=0;}
   }
   const sample=Number.isFinite(person.faceObservedAt)?person.faceObservedAt:
    Number.isFinite(person.faceSampleAt)?person.faceSampleAt:person;
   if(sample===lastSample){
    if(now-lastFreshAt>staleAfterMs){clear();lastTime=now;lastSample=sample;return output(false);}
    return output(true);
   }
   if(now-lastFreshAt>staleAfterMs){clear();lastTime=now;}
   const dt=Number.isFinite(lastFreshAt)?Math.max(0,Math.min(.25,(now-lastFreshAt)/1000)):.1;
   lastFreshAt=now;lastSample=sample;
   const alpha=filtered?1-Math.exp(-dt/.08):1;
   filtered=Object.fromEntries(keys.map(key=>[key,filtered?filtered[key]+(raw[key]-filtered[key])*alpha:raw[key]]));
   const scores=scoresFor(filtered);
   let next='neutral',best=-Infinity,bestPriority=0;
   for(const [id,rule] of Object.entries(rules)){
    const priority=rule.priority||1,strength=scores[id]+rule.bias;
    if(scores[id]>=rule.enter&&(priority>bestPriority||(priority===bestPriority&&strength>best))){next=id;best=strength;bestPriority=priority;}
   }
   // Retain an established shape through small threshold noise; a clearly
   // stronger or more specific combination can replace it after its own dwell.
   // A strong smile alone must not prevent detecting a squinting smile
   // or closed-eye laugh as the additional measured actions appear.
   if(current!=='neutral'&&scores[current]>=rules[current].exit){
    const currentStrength=scores[current]+rules[current].bias;
    const currentPriority=rules[current].priority||1;
    if(next==='neutral'||bestPriority<currentPriority||(bestPriority===currentPriority&&best<currentStrength+.10))next=current;
   }
   if(next===current){candidate=null;candidateSamples=0;return output(true);}
   if(candidate!==next){candidate=next;candidateSince=now;candidateSamples=1;}
   else candidateSamples++;
   const dwell=next==='neutral'?420:rules[next].dwell;
   if(candidateSamples>=3&&now-candidateSince>=dwell){
    current=next;changedAt=now;candidate=null;candidateSamples=0;
   }
   return output(true);
  },
 };
}
