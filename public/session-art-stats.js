import {AFFECT_FAMILIES} from './affect-visual-state.js';

export const EXPRESSION_ART_METRIC='expression-art-v1';
export const ART_WINDOW_MS=2000;
export const EXPRESSION_ART_DESCRIPTION='每 2 秒汇总已有表情图形映射：有效时长决定五组图形占比，面部动作强度决定面积与三档纯色，相邻有效窗口的变化决定旋转范围。缺失或没有动作系数的片段不参与图形统计；包含缺失的窗口不用于跨窗口变化计算。模拟画面使用明确的预设强度。';
const MAX_MS=24*60*60*1000;
const clamp=v=>Math.max(0,Math.min(1,v));
const roundMs=v=>Math.round(v*1000)/1000;
const roundUnit=v=>Math.round(clamp(v)*10000)/10000;
const emptyMoment=()=>({ms:0,strength:0,variation:0,variationWeight:0});
const emptyTotal=()=>({windows:0,variation:0,variationWeight:0,families:AFFECT_FAMILIES.map(()=>({...emptyMoment(),bands:Array.from({length:3},emptyMoment)}))});
const emptyWindow=start=>({start,ms:AFFECT_FAMILIES.map(()=>0),strength:AFFECT_FAMILIES.map(()=>0),missing:false});
const familyIndex=new Map(AFFECT_FAMILIES.map((family,index)=>[family,index]));
const sum=a=>a.reduce((total,v)=>total+v,0);

function copyTotal(total){return {...total,families:total.families.map(f=>({...f,bands:f.bands.map(b=>({...b}))}))};}
function windowSummary(window){
 const validMs=sum(window.ms);
 if(validMs<=0)return null;
 return {validMs,shares:window.ms.map(ms=>ms/validMs),strengths:window.ms.map((ms,i)=>ms>0?window.strength[i]/ms:0),
  meanStrength:sum(window.strength)/validMs,missing:window.missing};
}
function mergeWindow(total,window,previous){
 const current=windowSummary(window);
 if(!current)return null;
 total.windows++;
 const comparable=Boolean(previous&&!previous.missing&&!current.missing);
 // Variation is an artistic bounded distance, not a probability or a
 // physiological measurement: family share change + facial-strength change.
 const variation=comparable?AFFECT_FAMILIES.map((_,i)=>.65*Math.abs(current.shares[i]-previous.shares[i])+.35*Math.abs(current.strengths[i]-previous.strengths[i])):null;
 if(comparable){
  const weight=Math.min(previous.validMs,current.validMs);
  const distance=.65*.5*sum(current.shares.map((p,i)=>Math.abs(p-previous.shares[i])))+.35*Math.abs(current.meanStrength-previous.meanStrength);
  total.variation+=distance*weight;total.variationWeight+=weight;
 }
 for(let i=0;i<AFFECT_FAMILIES.length;i++){
  const ms=window.ms[i];
  const family=total.families[i],strength=current.strengths[i];
  const band=family.bands[Math.min(2,Math.floor(strength*3))];
  for(const target of [family,band]){
   target.ms+=ms;target.strength+=window.strength[i];
  }
  if(comparable){
   const pairedMs=Math.min(previous.validMs,current.validMs);
   // Both arrival and departure contribute to the family's variation. Assign
   // each half to that adjacent window's strength band, preserving its area.
   for(const sample of [previous,current]){
    const weight=sample.shares[i]*pairedMs*.5;if(weight<=0)continue;
    const targetBand=family.bands[Math.min(2,Math.floor(sample.strengths[i]*3))];
    for(const target of [family,targetBand]){target.variation+=variation[i]*weight;target.variationWeight+=weight;}
   }
  }
 }
 return current;
}
const momentData=moment=>roundMs(moment.ms)>0?[roundMs(moment.ms),roundUnit(moment.strength/moment.ms),moment.variationWeight>0?roundUnit(moment.variation/moment.variationWeight):0]:[0,0,0];
function output(total){
 const families=total.families.map((f,i)=>{const [durationMs,meanStrength,variation]=momentData(f);return {family:AFFECT_FAMILIES[i],durationMs,meanStrength,variation,bands:f.bands.map(momentData)};});
 const validMs=roundMs(sum(families.map(f=>f.durationMs)));
 return {metric:EXPRESSION_ART_METRIC,windowMs:ART_WINDOW_MS,validMs,windows:validMs>0?total.windows:0,
  families,variation:validMs>0&&total.variationWeight>0?roundUnit(total.variation/total.variationWeight):0};
}

/** O(5 × 3) streaming state. No raw facial history or unlimited window list.
 * Intervals use session-relative monotonic time. Reads include the current
 * partial window on a copy, so frequent UI/network reads cannot double-count. */
export function createSessionArtAccumulator(){
 let total=emptyTotal(),window=emptyWindow(0),previous=null,through=0;
 function close(){previous=mergeWindow(total,window,previous);window=emptyWindow(window.start+ART_WINDOW_MS);}
 function consume(start,end,signal){
  const index=familyIndex.get(signal?.family);
  const valid=index!==undefined&&Number.isFinite(signal?.intensity)&&signal.intensity>=0&&signal.intensity<=1;
  let cursor=start;
  while(cursor<end){
   // A long missing interval needs no per-window loop or retained history.
   if(!valid&&cursor===window.start&&end-cursor>=ART_WINDOW_MS){
    const count=Math.floor((end-cursor)/ART_WINDOW_MS);
    cursor+=count*ART_WINDOW_MS;window=emptyWindow(cursor);previous=null;continue;
   }
   const boundary=window.start+ART_WINDOW_MS,stop=Math.min(end,boundary),ms=stop-cursor;
   if(valid){window.ms[index]+=ms;window.strength[index]+=ms*signal.intensity;}
   else window.missing=true;
   cursor=stop;
   if(cursor>=boundary)close();
  }
 }
 return {
  interval(start,end,signal){
   if(!Number.isFinite(start)||!Number.isFinite(end)||start<through||start<0||end<start||end>MAX_MS)return false;
   if(start>through)consume(through,start,null);
   consume(start,end,signal);through=end;return true;
  },
  snapshot(){const result=copyTotal(total);mergeWindow(result,window,previous);return output(result);},
 };
}

/** Optional cumulative art data stays bounded and compatible with old peers. */
export function normalizeSessionArt(input,durationMs,observedValidMs=durationMs){
 if(!input||typeof input!=='object'||Array.isArray(input)||input.metric!==EXPRESSION_ART_METRIC||input.windowMs!==ART_WINDOW_MS||
  !Number.isFinite(input.validMs)||input.validMs<0||input.validMs>observedValidMs+.01||
  !Number.isSafeInteger(input.windows)||input.windows<0||input.windows>Math.ceil(durationMs/ART_WINDOW_MS)||
  !Array.isArray(input.families)||input.families.length!==AFFECT_FAMILIES.length)return null;
 const unit=v=>Number.isFinite(v)&&v>=0&&v<=1&&Math.abs(v*10000-Math.round(v*10000))<1e-6;
 const duration=v=>Number.isFinite(v)&&v>=0&&v<=durationMs+.01&&Math.abs(v-roundMs(v))<1e-7;
 if(!duration(input.validMs)||!unit(input.variation)||(input.validMs===0)!==(input.windows===0))return null;
 const byFamily=new Map();let ms=0;
 for(const item of input.families){
  if(!item||!familyIndex.has(item.family)||byFamily.has(item.family)||!duration(item.durationMs)||!unit(item.meanStrength)||!unit(item.variation)||
   !Array.isArray(item.bands)||item.bands.length!==3)return null;
  const bands=[];let bandMs=0,bandStrength=0;
  for(const [index,band] of item.bands.entries()){
   if(!Array.isArray(band)||band.length!==3||!duration(band[0])||!unit(band[1])||!unit(band[2]))return null;
   if(band[0]===0&&(band[1]!==0||band[2]!==0))return null;
   // Rounding can move a strength by at most 0.00005 across a band edge.
   if(band[0]>0&&(band[1]<index/3-.000051||band[1]>(index+1)/3+.000051))return null;
   bandMs+=band[0];bandStrength+=band[0]*band[1];bands.push([...band]);
  }
  if(Math.abs(bandMs-item.durationMs)>.01||(item.durationMs===0&&(item.meanStrength!==0||item.variation!==0))||
   (item.durationMs>0&&Math.abs(bandStrength/item.durationMs-item.meanStrength)>.0003+.003/item.durationMs))return null;
  ms+=item.durationMs;byFamily.set(item.family,{family:item.family,durationMs:item.durationMs,meanStrength:item.meanStrength,variation:item.variation,bands});
 }
 if(Math.abs(ms-input.validMs)>.01||(input.validMs===0&&input.variation!==0))return null;
 return {metric:EXPRESSION_ART_METRIC,windowMs:ART_WINDOW_MS,validMs:input.validMs,windows:input.windows,
  families:AFFECT_FAMILIES.map(family=>byFamily.get(family)),variation:input.variation};
}
