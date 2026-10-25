/** R10: observed facial configurations drive five artistic ring families.
 * This is a visual mapping of the existing emoji output, not emotion inference.
 * No camera, microphone, model, DOM or renderer is created here.
 */
import {EXPRESSION_LIBRARY} from './expressions.js';

const clamp=value=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
const freeze=value=>{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))freeze(child);
  Object.freeze(value);
 }
 return value;
};
export const AFFECT_FAMILIES=Object.freeze(['calm','joy','surprise','tension','sadness']);
export const AFFECT_REFERENCE=freeze({width:900,height:430,centerX:450,centerY:215});
export const AFFECT_FAMILY_LABELS=freeze({calm:'自然、平静',joy:'愉悦、舒展',surprise:'惊异、扩张',tension:'紧张、收紧',sadness:'低落、下沉'});

// Ambiguous eye direction, squints, puckering and one raised brow retain the
// calm visual family. Only the established brow-furrow configuration selects
// tension. These assignments are this implementation's explicit art mapping.
export const EXPRESSION_ART_FAMILIES=freeze({
 neutral:'calm',smile:'joy','open-mouth':'surprise',wink:'calm','eyes-closed':'calm',pucker:'calm',
 'brow-furrow':'tension','squint-smile':'joy','open-smile':'joy','closed-laugh':'joy','one-brow':'calm',
 'mouth-frown':'sadness','raised-eyes':'surprise','closed-pucker':'calm','eyes-narrow':'calm',
 'one-eye-squint':'calm','gaze-side':'calm','gaze-up':'calm',
});
export const AFFECT_SOURCE_MAP=freeze(EXPRESSION_LIBRARY.map(({id,label,emoji})=>({id,label,emoji,family:EXPRESSION_ART_FAMILIES[id]})));

// Actual Figma node 134:11 LOW / BASIC / HIGH keyframe measurements.
// Arrays correspond to intensity 0 / .5 / 1 at the 900 x 430 reference size.
// The photographic background and the person's sampled colors are unaffected.
export const AFFECT_VISUAL_PROFILES=freeze({
 calm:{label:AFFECT_FAMILY_LABELS.calm,width:[2,5,10],opacity:[.30,.65,1],palette:['#A8C5B0','#F2EBDD','#C7E3DD'],gradientStops:[0,.65,1],
  geometry:{kind:'ellipse',angles:[0,-55,55],radiusX:[205,205,205],radiusY:[78,78,78],scale:[.94,1,1.06],offsetY:[0,0,0]}},
 joy:{label:AFFECT_FAMILY_LABELS.joy,width:[6,20,38],opacity:[.30,.65,1],palette:['#FFAE70','#FFD65A','#FFF1BA'],gradientStops:[0,.65,1],
  geometry:{kind:'ellipse',angles:[0,-55,55],radiusX:[205,205,205],radiusY:[78,78,78],scale:[.96,1,1.04],offsetY:[0,0,0]}},
 surprise:{label:AFFECT_FAMILY_LABELS.surprise,width:[3,8,15],opacity:[.35,.70,1],palette:['#9566F2','#F19AE8','#FFF0FA'],gradientStops:[0,.65,1],
  geometry:{kind:'spiked',angles:[0,-55,55],radiusX:[205,205,205],radiusY:[78,78,78],scale:[1,1,1],offsetY:[0,0,0],spikeHeight:[8,19,32],spikeCount:12}},
 tension:{label:AFFECT_FAMILY_LABELS.tension,width:[.8,1.3,2],opacity:[.35,.70,1],palette:['#F06464','#F06464','#F06464'],gradientStops:[0,.65,1],
  geometry:{kind:'chevrons',angles:[0,-55,55],radiusX:[205,205,205],radiusY:[78,78,78],scale:[1,1,1],offsetY:[0,0,0],chevronCount:64,chevronLeg:Math.sqrt(128)}},
 sadness:{label:AFFECT_FAMILY_LABELS.sadness,width:[10,6,2.5],opacity:[.95,.60,.28],palette:['#8D9FB5','#666780','#363C55'],gradientStops:[0,.5,1],
  geometry:{kind:'droop',angles:[0,-48,48],radiusX:[96,82,68],radiusY:[140,155,168],scale:[1,1,1],offsetY:[-10,-1,8]}},
});

function sampleThree(values,intensity){
 const t=clamp(intensity)*2,index=t<1?0:1;
 return values[index]+(values[index+1]-values[index])*(t-index);
}
/** Sample the three design keyframes; angles remain the three orbit angles. */
export function sampleAffectStyle(family,intensity){
 const key=Object.hasOwn(AFFECT_VISUAL_PROFILES,family)?family:'calm';
 const p=AFFECT_VISUAL_PROFILES[key],geometry={};
 for(const [name,value] of Object.entries(p.geometry))geometry[name]=Array.isArray(value)&&name!=='angles'?sampleThree(value,intensity):value;
 return {family:key,label:p.label,width:sampleThree(p.width,intensity),opacity:sampleThree(p.opacity,intensity),palette:p.palette,gradientStops:p.gradientStops,geometry};
}

const actionKeys=['smile','browRaise','browRaiseLeft','browRaiseRight','browLower','jawOpen','eyeWide','mouthPucker','eyeBlinkLeft','eyeBlinkRight','eyeSquint','mouthFrown',
 'eyeWideLeft','eyeWideRight','eyeSquintLeft','eyeSquintRight','eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight',
 'eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight'];
function readActions(input){
 if(!input||!actionKeys.some(key=>Number.isFinite(input[key])))return null;
 const a=Object.fromEntries(actionKeys.map(key=>[key,clamp(input[key])]));
 for(const base of ['eyeWide','eyeSquint'])for(const side of ['Left','Right']){
  if(input[base+side]===undefined)a[base+side]=a[base];
 }
 return a;
}
function calmCue(a,id){
 const closed=Math.min(a.eyeBlinkLeft,a.eyeBlinkRight);
 switch(id){
  case 'wink':return Math.abs(a.eyeBlinkLeft-a.eyeBlinkRight);
  case 'eyes-closed':return closed;
  case 'pucker':return a.mouthPucker;
  case 'closed-pucker':return Math.min(a.mouthPucker,closed);
  case 'one-brow':return Math.abs(a.browRaiseLeft-a.browRaiseRight);
  case 'eyes-narrow':return Math.min(a.eyeSquintLeft,a.eyeSquintRight);
  case 'one-eye-squint':return Math.abs(a.eyeSquintLeft-a.eyeSquintRight);
  case 'gaze-side':return Math.max(Math.min(a.eyeLookOutLeft,a.eyeLookInRight),Math.min(a.eyeLookInLeft,a.eyeLookOutRight));
  case 'gaze-up':return Math.min(a.eyeLookUpLeft,a.eyeLookUpRight);
  default:return 0;
 }
}
function targetStrengths(expression,actions){
 // Demo selection carries an explicit synthetic flag and never pretends that
 // its null actions were measured. It also previews every selected art family.
 if(expression.demo===true)return Object.fromEntries(AFFECT_FAMILIES.map(key=>[key,.65]));
 const a=actions,wide=Math.min(a.eyeWideLeft,a.eyeWideRight);
 const gatedMouth=Math.min(clamp(a.jawOpen*1.5),clamp(Math.max(wide,a.browRaise)*2));
 return {
  calm:.18+.22*calmCue(a,expression.id),
  joy:a.smile,
  surprise:expression.id==='open-mouth'?gatedMouth:expression.id==='raised-eyes'?clamp(wide*1.6):Math.max(gatedMouth,clamp(wide*1.6)),
  tension:a.browLower,
  sadness:a.mouthFrown,
 };
}
const zeros=()=>Object.fromEntries(AFFECT_FAMILIES.map(key=>[key,0]));
const oneHot=family=>Object.fromEntries(AFFECT_FAMILIES.map(key=>[key,Number(key===family)]));
const smoothstep=value=>{const t=clamp(value);return t*t*(3-2*t);};

/**
 * Independent visual state. The caller supplies the existing face/occupancy
 * eligibility and a participant ownership token; upstream expression.visible
 * already rejects stale face samples. No inference or sample counting occurs.
 * Weights are artistic crossfade amounts, not probabilities of feelings.
 */
export function createAffectVisualState({transitionMs=600,intensityTimeConstantMs=180}={}){
 const transitionDuration=Number.isFinite(transitionMs)&&transitionMs>0?transitionMs:600;
 const strengthDuration=Number.isFinite(intensityTimeConstantMs)&&intensityTimeConstantMs>0?intensityTimeConstantMs:180;
 let owner,lastNow,pausedAt,visible,family,weights,strengths,fromWeights,transitionStarted,sourceId,sourceScore,demo;
 function clear(){
  lastNow=null;pausedAt=null;visible=false;family='calm';weights=zeros();strengths=zeros();fromWeights=zeros();
  transitionStarted=null;sourceId=null;sourceScore=0;demo=false;
 }
 function reset(){owner=undefined;clear();}
 function output(){return {visible,family,label:AFFECT_FAMILY_LABELS[family],weights:{...weights},strengths:{...strengths},intensity:visible?strengths[family]:0,sourceId,sourceScore,demo};}
 function advance(now){
  if(transitionStarted===null)return;
  const t=smoothstep((now-transitionStarted)/transitionDuration),target=oneHot(family);
  weights=Object.fromEntries(AFFECT_FAMILIES.map(key=>[key,fromWeights[key]+(target[key]-fromWeights[key])*t]));
  if(now-transitionStarted>=transitionDuration){weights=target;transitionStarted=null;}
 }
 reset();
 return {
  reset,
  update(expression,now,{eligible=true,owner:nextOwner=null,paused=false}={}){
   if(owner!==nextOwner){clear();owner=nextOwner;}
   if(!Number.isFinite(now)||now<0||(lastNow!==null&&now<lastNow)){clear();return output();}
   const actions=readActions(expression?.actions);
   if(!eligible||!expression?.visible||!Object.hasOwn(EXPRESSION_ART_FAMILIES,expression.id)||(!actions&&expression.demo!==true)){
    clear();lastNow=now;return output();
   }
   // Safety gates above still apply during pause. A paused owner change cannot
   // keep showing or initialize another participant's previous visual state.
   if(paused){
    if(pausedAt===null)pausedAt=lastNow??now;
    lastNow=now;return output();
   }
   let dt=lastNow===null?0:now-lastNow;
   if(pausedAt!==null){
    if(transitionStarted!==null)transitionStarted+=now-pausedAt;
    pausedAt=null;dt=0;
   }
   lastNow=now;
   const nextFamily=EXPRESSION_ART_FAMILIES[expression.id],target=targetStrengths(expression,actions);
   if(!visible){
    visible=true;family=nextFamily;weights=oneHot(family);fromWeights={...weights};strengths={...target};transitionStarted=null;
   }else{
    advance(now);
    if(nextFamily!==family){fromWeights={...weights};family=nextFamily;transitionStarted=now;}
    const alpha=1-Math.exp(-dt/strengthDuration);
    strengths=Object.fromEntries(AFFECT_FAMILIES.map(key=>[key,clamp(strengths[key]+(target[key]-strengths[key])*alpha)]));
   }
   sourceId=expression.id;sourceScore=clamp(expression.score);demo=expression.demo===true;
   return output();
  },
 };
}
