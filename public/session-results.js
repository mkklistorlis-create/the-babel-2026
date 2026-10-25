import {EXPRESSION_LIBRARY} from './expressions.js';
import {FACIAL_ACTIVITY_METRIC,FACIAL_ACTIVITY_DESCRIPTION} from './expression-activity.js';
import {AFFECT_FAMILIES} from './affect-visual-state.js';
import {EXPRESSION_ART_METRIC,EXPRESSION_ART_DESCRIPTION,ART_WINDOW_MS,normalizeSessionArt} from './session-art-stats.js';
import {createArtBackground,paintArtBackground} from './session-art-background.js';

const COLORS={A:'#d5ff00',B:'#8754ff'};
const INK='#11110f';
const metricName=metric=>metric==='count'?'独立出现次数':'有效识别时间占比';
const nonnegative=value=>Number.isFinite(value)?Math.max(0,value):0;
export function formatSessionDuration(ms){const value=nonnegative(ms);return value>0&&value<100?'<0.1 秒':`${(value/1000).toFixed(1)} 秒`;}
export function formatSessionPercent(value){const p=nonnegative(value);return p>0&&p<.001?'<0.1%':`${(100*p).toFixed(1)}%`;}
const seconds=formatSessionDuration,percent=formatSessionPercent;
const clock=ms=>{const s=Math.floor(nonnegative(ms)/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const solo=state=>state?.kind==='solo';
const participantRoles=state=>solo(state)?['A']:['A','B'];
const participantName=(state,role)=>solo(state)?'你':`Participant ${role}`;

const EN_EXPRESSIONS={neutral:'Neutral',smile:'Smile','open-mouth':'Open mouth',wink:'Wink','eyes-closed':'Eyes closed',pucker:'Pout','brow-furrow':'Frown','squint-smile':'Squint smile','open-smile':'Open smile','closed-laugh':'Laugh','one-brow':'Brow raise','mouth-frown':'Mouth down','raised-eyes':'Wide eyes','closed-pucker':'Closed kiss','eyes-narrow':'Narrow eyes','one-eye-squint':'One-eye squint','gaze-side':'Side glance','gaze-up':'Look up'};
const englishSeconds=value=>formatSessionDuration(value).replace(' 秒',' s');
const displayName=(state,role)=>solo(state)?'You':`${role}${state.role===role?' · You':' · Partner'}`;
export function sessionOverviewHTML(state){
 const participants=participantSummaries(state),duration=Math.max(state.local?.durationMs||0,state.remote?.durationMs||0);
 const metric=(label,value)=>`<div class="summary-metric"><dt>${label}</dt><dd>${escapeHTML(value)}</dd></div>`;
 return `<dl class="summary-shared">${metric('SESSION LENGTH',clock(duration).padStart(5,'0'))}${metric('EXPRESSION TYPES',recordedExpressionCount(state))}</dl>`+participantRoles(state).map(role=>{
  const item=participants[role];
  return `<div class="summary-participant" data-role="${role}">${solo(state)?'':`<strong class="summary-role">${displayName(state,role)}</strong>`}<dl>${metric('TRACKING COVERAGE',item?percent(item.durationMs>0?item.validMs/item.durationMs:0):'—')}${metric('TRACKED TIME',item?englishSeconds(item.validMs):'—')}${metric('UNTRACKED TIME',item?englishSeconds(item.missingMs):'—')}</dl>${!item?'<span class="summary-pending">Not received</span>':''}</div>`;
 }).join('');
}

export function participantSummaries(state={}){
 const result={A:null,B:null};
 for(const summary of solo(state)?[state.local]:[state.local,state.remote])if(summary&&['A','B'].includes(summary.role))result[summary.role]=summary;
 return result;
}

export function recordedExpressionCount(state){
 return new Set(Object.values(participantSummaries(state)).filter(Boolean).flatMap(summary=>summary.counts.filter(item=>item.episodes>0||item.durationMs>0).map(item=>item.id))).size;
}

export function sessionRecordingPresentation(state={}){
 const elapsed=clock(Math.max(state.local?.durationMs||0,state.remote?.durationMs||0)),count=recordedExpressionCount(state);
 if(state.phase==='recording')return {label:'REC · 正在记录',elapsed,status:`已记录 ${count} 种表情；未识别时计时继续。`,returnLabel:'返回画面（继续记录）'};
 if(state.phase==='starting')return {label:solo(state)?'正在开始本轮':'等待双方开始确认',elapsed:'',status:solo(state)?'即将开始计时。':'确认完成后开始计时。',returnLabel:'返回画面（等待开始）'};
 if(state.phase==='finishing'||state.phase==='complete'){
  const reasonText={'disconnected':'连接已中断，保留已收到的部分统计。','start-timeout':'双方开始确认超时，本轮未开始。','sync-timeout':'最终同步超时，保留现有统计。'}[state.reason];
  const failure=state.phase==='complete'&&(state.reason||state.complete===false)?state.statusText||reasonText||'本轮统计未完整同步。':'';
  return {label:'已停止 · 本轮',elapsed,status:state.phase==='finishing'?(solo(state)?'正在生成本轮统计，计时已停止。':'正在同步本轮统计，计时已停止。'):`已记录 ${count} 种表情。${failure?failure+' ':''}开始新一轮后继续记录。`,returnLabel:'返回画面（未记录）'};
 }
 return {label:'尚未开始',elapsed:'',status:solo(state)?'开始本轮，记录你的表情变化。':state.connected?'等待双方开始本轮记录。':'双方连接后开始本轮记录。',returnLabel:'返回画面（未记录）'};
}

/** All 18 categories remain in the chart; unknown time never becomes neutral. */
export function sessionChartData(state,metric='duration'){
 const participants=participantSummaries(state);
 return EXPRESSION_LIBRARY.map((item,index)=>{
  const row={...item,index};
  for(const role of ['A','B']){
   const summary=participants[role],count=summary?.counts?.find(value=>value.id===item.id);
   const observed=summary&&(summary.validMs>0||metric==='count'&&summary.counts.some(item=>item.episodes>0));
   row[role]=!observed?null:metric==='count'?nonnegative(count?.episodes):nonnegative(count?.durationMs)/summary.validMs;
  }
  return row;
 }).sort((a,b)=>(b.A||0)+(b.B||0)-(a.A||0)-(a.B||0)||a.index-b.index);
}

function weightsFor(summary,metric){
 if(!summary||(metric!=='count'&&summary.validMs<=0))return [];
 const entries=EXPRESSION_LIBRARY.map(item=>{
  const value=summary.counts.find(count=>count.id===item.id);
  return {...item,weight:nonnegative(metric==='count'?value?.episodes:value?.durationMs)};
 }).filter(item=>item.weight>0);
 const total=entries.reduce((sum,item)=>sum+item.weight,0);
 return entries.map(item=>({...item,p:item.weight/total})).sort((a,b)=>b.p-a.p||a.id.localeCompare(b.id));
}

function safeTimeline(summary){
 const timeline=summary?.timeline;
 if(!timeline||timeline.metric!==FACIAL_ACTIVITY_METRIC||!Number.isFinite(timeline.stepMs)||timeline.stepMs<=0||!Array.isArray(timeline.points)||timeline.points.length>240)return null;
 let previous=-1;
 const points=[];
 for(const point of timeline.points){
  if(!Array.isArray(point)||point.length!==2)return null;
  const [at,value]=point;
  if(!Number.isFinite(at)||at<0||at>summary.durationMs||at<=previous||!(value===null||Number.isFinite(value)&&value>=0&&value<=100))return null;
  previous=at;points.push([at,value]);
 }
 return {metric:FACIAL_ACTIVITY_METRIC,stepMs:timeline.stepMs,points};
}

/** Missing points terminate a path; a measured zero remains a valid point. */
export function timelineSegments(points){
 const segments=[];let segment=[];
 for(const point of points){
  if(point[1]===null){if(segment.length)segments.push(segment);segment=[];}
  else segment.push([...point]);
 }
 if(segment.length)segments.push(segment);
 return segments;
}

export function sessionTimelineData(state){
 const participants=participantSummaries(state);
 const series=participantRoles(state).map(role=>{
  const summary=participants[role],timeline=safeTimeline(summary);
  return {role,label:participantName(state,role),color:COLORS[role],dash:role==='B'?'8 5':null,
   durationMs:nonnegative(summary?.durationMs),stepMs:timeline?.stepMs??null,available:Boolean(timeline),points:timeline?.points||[]};
 });
 return {metric:FACIAL_ACTIVITY_METRIC,definition:FACIAL_ACTIVITY_DESCRIPTION,durationMs:Math.max(0,...series.map(item=>item.durationMs)),yDomain:[0,100],series,
  hasTimeline:series.some(item=>item.available),hasValues:series.some(item=>item.points.some(point=>point[1]!==null))};
}

export function sessionTimelineSVG(state){
 const data=sessionTimelineData(state),width=1040,height=360,left=62,right=1010,top=40,bottom=290,maxTime=Math.max(data.durationMs,1);
 const x=value=>left+value/maxTime*(right-left),y=value=>bottom-value/100*(bottom-top),n=value=>Number(value.toFixed(3));
 const parts=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${solo(state)?'Your':'A and B'} facial activity, 0 to 100; gaps indicate missing tracking"><text x="${left}" y="18" fill="#696960" font-size="15">Facial activity · 0–100</text>`];
 for(let tick=0;tick<=4;tick++){
  const value=tick*25,py=y(value);
  parts.push(`<line x1="${left}" y1="${py}" x2="${right}" y2="${py}" stroke="${tick?'#11110f18':INK}"/><text x="48" y="${py+4}" text-anchor="end" fill="#696960" font-size="15">${value}</text>`);
 }
 for(let tick=0;tick<=4;tick++){
  const at=data.durationMs*tick/4,px=x(at),label=(at/1000).toFixed(data.durationMs<20000?1:0);
  if(data.durationMs===0&&tick>0)continue;
  parts.push(`<line x1="${n(px)}" y1="${bottom}" x2="${n(px)}" y2="${bottom+5}" stroke="${INK}"/><text x="${n(px)}" y="${bottom+23}" text-anchor="middle" fill="#696960" font-size="15">${label}</text>`);
 }
 for(const series of data.series){
  for(const segment of timelineSegments(series.points)){
   if(segment.length===1){
    const point=segment[0];parts.push(`<circle data-series="${series.role}" cx="${n(x(point[0]))}" cy="${n(y(point[1]))}" r="2.5" fill="${solo(state)?INK:series.role==='A'?'#718600':series.color}" stroke="${INK}" stroke-width=".6"><title>${series.label} · ${(point[0]/1000).toFixed(2)} 秒 · 指数 ${point[1]}</title></circle>`);
   }else{
    const path=segment.map((point,index)=>`${index?'L':'M'}${n(x(point[0]))},${n(y(point[1]))}`).join(' '),dash=series.dash?` stroke-dasharray="${series.dash}"`:'';
    parts.push(`<path d="${path}" fill="none" stroke="${INK}" stroke-opacity=".24" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"${dash}/><path data-series="${series.role}" d="${path}" fill="none" stroke="${solo(state)?INK:series.role==='A'?'#718600':series.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"${dash}><title>${series.label} · Recorded facial activity</title></path>`);
   }
  }
 }
 parts.push(`<text x="${right}" y="344" text-anchor="end" fill="#696960" font-size="15">Session time (s)</text></svg>`);
 return parts.join('');
}

export function sessionTimelineCSV(state){
 const participants=participantSummaries(state),data=sessionTimelineData(state);
 const rows=[['session_id','session_kind','participant','source','final_synchronized','metric','step_ms','elapsed_ms','elapsed_seconds','facial_activity_index','valid']];
 for(const series of data.series){
  const summary=participants[series.role];
  for(const [at,value] of series.points)rows.push([state.sessionId,solo(state)?'solo':'duet',series.role,summary.mode,Boolean(state.complete),FACIAL_ACTIVITY_METRIC,series.stepMs,at,(at/1000).toFixed(3),value===null?'':value,value!==null]);
 }
 return '\ufeff'+rows.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
}

function packCircles(entries,role,scale,isSolo=false){
 const cx=isSolo?800:role==='A'?420:1180,cy=500,halfWidth=isSolo?650:350,placed=[];
 const candidates=isSolo?[{x:cx,y:cy,d:0}]:[];
 for(let y=100;y<=900;y+=12)for(let x=cx-halfWidth+10;x<=cx+halfWidth-10;x+=12)candidates.push({x,y,d:(x-cx)**2+(y-cy)**2});
 candidates.sort((a,b)=>a.d-b.d||a.y-b.y||a.x-b.x);
 for(const item of entries){
  const r=scale*Math.sqrt(item.p);
  const point=candidates.find(candidate=>candidate.x-r>=cx-halfWidth&&candidate.x+r<=cx+halfWidth&&candidate.y-r>=70&&candidate.y+r<=930&&placed.every(other=>Math.hypot(other.x-candidate.x,other.y-candidate.y)>=other.r+r+12));
  if(!point)return null;
  placed.push({...item,role,x:point.x,y:point.y,r});
 }
 return placed;
}

/** Equal area budgets for A/B, one common scale, deterministic non-overlapping circles. */
export function createArtworkLayout(state,metric='duration'){
 const participants=participantSummaries(state),entries={A:weightsFor(participants.A,metric),B:weightsFor(participants.B,metric)};
 let scale=solo(state)?300:225;
 for(let attempt=0;attempt<16;attempt++,scale*=.85){
  const a=packCircles(entries.A,'A',scale,solo(state)),b=solo(state)?[]:packCircles(entries.B,'B',scale);
  if(a&&b)return [...a,...b];
 }
 return [];
}

/** Combine only measured art evidence, in participant order on both peers.
 * Foreground episode areas keep their existing, separate A/B budgets. */
export function sessionArtProfiles(state){
 const participants=participantSummaries(state),contributors=[],missingRoles=[];
 const accumulated=AFFECT_FAMILIES.map(family=>({family,durationMs:0,strengthSum:0,variationSum:0,bands:Array.from({length:3},()=>({durationMs:0,strengthSum:0,variationSum:0}))}));
 for(const role of participantRoles(state)){
  const summary=participants[role],art=summary?normalizeSessionArt(summary.art,summary.durationMs,summary.validMs):null;
  if(!art||art.validMs<=0){missingRoles.push(role);continue;}
  contributors.push(role);
  for(const value of art.families){
   const target=accumulated.find(item=>item.family===value.family);
   target.durationMs+=value.durationMs;
   target.strengthSum+=value.durationMs*value.meanStrength;
   target.variationSum+=value.durationMs*value.variation;
   value.bands.forEach(([ms,strength,variation],index)=>{const band=target.bands[index];band.durationMs+=ms;band.strengthSum+=ms*strength;band.variationSum+=ms*variation;});
  }
 }
 const evidenceMs=accumulated.reduce((sum,item)=>sum+item.durationMs,0);
 const profiles=accumulated.filter(item=>item.durationMs>0).map(item=>({family:item.family,share:item.durationMs/evidenceMs,
  meanStrength:item.strengthSum/item.durationMs,variation:item.variationSum/item.durationMs,
  bands:item.bands.map(band=>({share:band.durationMs/item.durationMs,meanStrength:band.durationMs?band.strengthSum/band.durationMs:0,variation:band.durationMs?band.variationSum/band.durationMs:0}))}));
 return {profiles,evidenceMs,contributors,missingRoles};
}

export function drawSessionArtwork(canvas,state,metric='duration'){
 const context=canvas.getContext('2d');
 if(!context)return [];
 canvas.width=1600;canvas.height=1000;
 const circles=createArtworkLayout(state,metric);
 const data=sessionArtProfiles(state),background=createArtBackground(data.profiles,{seed:String(state.sessionId||'session'),foreground:circles,width:1600,height:1000});
 paintArtBackground(context,background);
 if(canvas.dataset){canvas.dataset.artShapes=String(background.shapes.length);canvas.dataset.artEvidenceMs=String(data.evidenceMs);canvas.dataset.artSeed=String(state.sessionId||'session');}
 for(const role of ['A','B']){
  const group=circles.filter(item=>item.role===role);
  if(group.length>1){
   context.strokeStyle=role==='A'?'#7f990050':'#8754ff45';context.lineWidth=1;
   context.beginPath();context.moveTo(group[0].x,group[0].y);
   for(const item of group.slice(1))context.lineTo(item.x,item.y);
   context.stroke();
  }
 }
 for(const item of circles){
  context.fillStyle=background.paper;context.beginPath();context.arc(item.x,item.y,item.r,0,Math.PI*2);context.fill();
  context.strokeStyle=COLORS[item.role];context.lineWidth=3;context.stroke();
  context.strokeStyle=INK;context.lineWidth=.75;context.beginPath();context.arc(item.x,item.y,item.r*.94,0,Math.PI*2);context.stroke();
  context.font=`${item.r*1.5}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  context.textAlign='center';context.textBaseline='middle';context.fillStyle=INK;
  context.fillText(item.emoji,item.x,item.y+item.r*.045);
 }
 return circles;
}

function safeSummary(summary){
 if(!summary)return null;
 const art=normalizeSessionArt(summary.art,summary.durationMs,summary.validMs);
 return {role:summary.role,mode:summary.mode,revision:summary.revision,durationMs:summary.durationMs,validMs:summary.validMs,missingMs:summary.missingMs,
  counts:EXPRESSION_LIBRARY.map(item=>{const count=summary.counts.find(entry=>entry.id===item.id);return {id:item.id,emoji:item.emoji,label:item.label,durationMs:nonnegative(count?.durationMs),episodes:nonnegative(count?.episodes)};}),timeline:safeTimeline(summary),...(art?{art}:{})};
}

export function sessionExportData(state,metric='duration'){
 const participants=participantSummaries(state);
 const timing=state.timing;
 const timestamp=value=>Number.isFinite(value)&&value>=0?value:null;
 const timingSource=value=>typeof value==='string'?value.slice(0,64):null;
 const localTiming=timing?{participant:state.role||null,requestedAt:timestamp(timing.requestedAt),startedAt:timestamp(timing.startedAt),endedAt:timestamp(timing.endedAt),startedBy:timingSource(timing.startedBy),endedBy:timingSource(timing.endedBy)}:null;
 return {format:'the-babel-session-v1',sessionId:state.sessionId,kind:solo(state)?'solo':'duet',metric:metric==='count'?'episodes':'duration-share',complete:Boolean(state.complete),
  reason:state.reason||null,description:'Observed facial configurations; not an assessment of feelings. Missing time is excluded from expression shares. Timing timestamps are local monotonic milliseconds for the indicated participant, not wall-clock time; do not compare timestamps across devices.',localTiming,
  timelineDefinition:{metric:FACIAL_ACTIVITY_METRIC,description:FACIAL_ACTIVITY_DESCRIPTION,range:[0,100],missing:null,timeAxis:'Milliseconds elapsed since each participant’s own session start; not synchronized wall-clock time.',aggregation:'Intervals may be coarsened for long sessions; retain peak values and keep missing intervals null.'},
  artDefinition:{metric:EXPRESSION_ART_METRIC,windowMs:ART_WINDOW_MS,description:EXPRESSION_ART_DESCRIPTION,design:'Figma 158:11',generator:'figma-geometric-background-v1',seed:String(state.sessionId||'session'),...sessionArtProfiles(state)},
  participants:Object.fromEntries(participantRoles(state).map(role=>[role,safeSummary(participants[role])]))};
}

export function sessionCSV(state,metric='duration'){
 const rows=[['session_id','participant','source','final_synchronized','metric','expression_id','emoji','label','duration_seconds','duration_share','episodes','session_seconds','valid_seconds','missing_seconds','coverage']];
 for(const [role,summary] of Object.entries(participantSummaries(state))){
  if(!summary)continue;
  for(const item of EXPRESSION_LIBRARY){
   const count=summary.counts.find(entry=>entry.id===item.id);
   rows.push([state.sessionId,role,summary.mode,Boolean(state.complete),metric,item.id,item.emoji,item.label,
    (nonnegative(count?.durationMs)/1000).toFixed(3),summary.validMs>0?(nonnegative(count?.durationMs)/summary.validMs).toFixed(6):'',nonnegative(count?.episodes),
    (summary.durationMs/1000).toFixed(3),(summary.validMs/1000).toFixed(3),(summary.missingMs/1000).toFixed(3),summary.durationMs>0?(summary.validMs/summary.durationMs).toFixed(6):'']);
  }
 }
 return '\ufeff'+rows.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
}

function chartSVG(state,metric){
 const rows=sessionChartData(state,metric),isCount=metric==='count';
 const maximum=isCount?Math.max(5,Math.ceil(Math.max(...rows.flatMap(row=>[row.A||0,row.B||0]))/5)*5):1;
 const width=1250,height=250,left=45,top=20,bottom=180,step=66;
 const parts=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${solo(state)?'Your':'A and B'} expression distribution; full data in measurement details">`];
 const ticks=isCount?5:4;
 for(let index=0;index<=ticks;index++){
  const value=maximum*index/ticks,y=bottom-(bottom-top)*index/ticks;
  parts.push(`<line x1="${left}" y1="${y}" x2="1235" y2="${y}" stroke="${index?'#11110f18':INK}"/><text x="35" y="${y+4}" text-anchor="end" fill="#696960" font-size="11">${isCount?Number(value.toFixed(1)):Math.round(value*100)+'%'}</text>`);
 }
 rows.forEach((row,index)=>{
  const x=left+index*step+step/2;
  participantRoles(state).forEach((role,offset)=>{
   const value=row[role],h=value===null?0:value/maximum*(bottom-top),bx=solo(state)?x-10.5:x+(offset?-0: -23);
   if(value!==null)parts.push(`<rect x="${bx}" y="${bottom-h}" width="21" height="${h}" fill="${COLORS[role]}" stroke="${INK}" stroke-width=".6"><title>${solo(state)?'You':role} · ${EN_EXPRESSIONS[row.id]}: ${isCount?value+' occurrences':escapeHTML(percent(value))}</title></rect>`);
   parts.push(`<text x="${bx+10.5}" y="${bottom-h-7}" text-anchor="middle" fill="#696960" font-size="9">${value===null?'—':isCount?value:escapeHTML(percent(value))}</text>`);
  });
  const words=EN_EXPRESSIONS[row.id].split(' ');
  parts.push(`<text x="${x}" y="204" text-anchor="middle" fill="${INK}" font-size="11">${words[0]}${words.length>1?`<tspan x="${x}" dy="13">${words.slice(1).join(' ')}</tspan>`:''}</text>`);
 });
 parts.push('</svg>');return parts.join('');
}

function detailTable(state){
 const participants=participantSummaries(state);
 return '<table><caption>Complete expression statistics</caption><thead><tr><th scope="col">Expression</th>'+participantRoles(state).map(role=>`<th scope="col">${solo(state)?'You':role} · duration / share / count</th>`).join('')+'</tr></thead><tbody>'+EXPRESSION_LIBRARY.map(item=>`<tr><th scope="row">${item.emoji} ${EN_EXPRESSIONS[item.id]}</th>`+participantRoles(state).map(role=>{
  const summary=participants[role],count=summary?.counts.find(entry=>entry.id===item.id);
  return `<td>${!summary?'Not received':`${escapeHTML(englishSeconds(count?.durationMs))} / ${summary.validMs>0?escapeHTML(percent(nonnegative(count?.durationMs)/summary.validMs)):'No tracked time'} / ${nonnegative(count?.episodes)}`}</td>`;
 }).join('')+'</tr>').join('')+'</tbody></table>';
}

function saveBlob(blob,name){
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function participantLegend(state,line=false){
 return participantRoles(state).map(role=>`<span><i data-role="${role}"${line?' class="session-line-key"':''}></i>${displayName(state,role)}${line&&!solo(state)?role==='A'?' · solid':' · dashed':''}</span>`).join('');
}

export function mountSessionResults({onStart=()=>{},onFinish=()=>{},onHome=()=>{}}={}){
 const dock=document.createElement('section');dock.id='session-controls';dock.hidden=true;
 dock.setAttribute('aria-label','Recording status');
 dock.innerHTML='<div class="session-recording"><span class="recording-dot" aria-hidden="true"></span><strong id="session-live-label">WAIT</strong><span id="session-live-clock">00:00</span></div>';
 const actions=document.createElement('div');actions.className='session-control-actions';actions.hidden=true;
 actions.innerHTML='<button id="session-finish">Finish &amp; create ↗</button>';
 const panel=document.createElement('section');panel.id='session-results';panel.hidden=true;
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Session summary');
 panel.lang='en';
 panel.innerHTML=`<div class="session-sheet"><header class="session-header"><svg class="babel-brand compact-brand" viewBox="0 0 760 230" role="img" aria-label="The Babel">
    <title>The Babel</title>
    <g fill="currentColor"><path d="M0 0H170V92H93L46 138V92H0Z"/><path d="M62 138H139L185 92V138H232V230H62Z"/></g>
    <g class="babel-wordmark" fill="currentColor"><text x="280" y="79" font-size="100" textLength="200" lengthAdjust="spacingAndGlyphs">THE</text><text x="280" y="230" font-size="151" textLength="480" lengthAdjust="spacingAndGlyphs">BABEL</text></g>
   </svg><button id="session-close" aria-label="Back home">Back home ↗</button></header>
  <div class="session-dashboard"><div id="session-summaries"></div>
   <div class="session-main"><section class="session-art-section"><h3>01 / YOUR CONVERSATION PORTRAIT</h3><div class="session-art-wrap"><canvas id="session-art" width="1600" height="1000" aria-label="Geometric portrait generated from this session"></canvas><p id="session-art-empty" hidden>No tracked expressions yet.</p></div><p id="session-art-description" class="session-note">A visual trace of your expressions and movement.</p></section>
   <div class="session-data"><section class="session-chart-section"><div class="session-section-heading"><h3>02 / EXPRESSION DISTRIBUTION</h3><select id="session-metric" aria-label="Expression chart metric"><option value="count">By occurrences</option><option value="duration">By duration</option></select></div><div class="chart-caption"><div id="session-bar-legend" class="session-legend"></div><p id="session-chart-description" class="session-note"></p></div><div id="session-chart" tabindex="0" aria-label="Expression distribution; scroll horizontally for all categories"></div><div class="chart-scroll-controls"><button id="session-chart-prev" aria-label="Previous expressions">←</button><span>More expressions</span><button id="session-chart-next" aria-label="More expressions">→</button></div></section>
   <section class="session-timeline-section"><div class="session-section-heading"><h3>03 / FACIAL ACTIVITY</h3><div id="session-timeline-legend" class="session-legend"></div></div><div id="session-timeline" aria-label="Facial activity chart"></div><p id="session-timeline-description" class="session-note"></p><p id="session-timeline-empty" class="session-note" hidden></p></section></div></div>
   <div class="session-bottom"><p id="session-result-status" role="status"></p><div><button id="session-measurement-open" aria-expanded="false" aria-controls="session-measurement">How this is measured ↗</button><button id="session-download-csv">Export CSV ↓</button></div></div>
  </div>
  <footer class="session-footer"><strong>YOU. ME. IN BETWEEN.</strong><div><button id="session-new-round">Create again ↗</button><button id="session-download-png">Save artwork ↓</button></div></footer><p id="session-export-status" role="status"></p>
  <section id="session-measurement" hidden aria-label="How this is measured"><div class="session-section-heading"><h3>HOW THIS IS MEASURED</h3><button id="session-measurement-close">Back to summary ↗</button></div><p id="session-timing-note" class="session-note"></p><p class="session-note">Occurrences count each visible emoji change once. Duration shares use each participant’s tracked time. Missing tracking is kept separate and never counted as neutral. The facial activity index measures visible facial movement, not feelings or voice. Lines start at each participant’s session start, without millisecond synchronization. Longer sessions aggregate samples while keeping peaks and gaps. The portrait uses observed expression proportions and geometric movement patterns. Results remain in this browser until refresh.</p><div id="session-table"></div><div class="measurement-actions"><button id="session-download-timeline-csv">Export activity CSV ↓</button><button id="session-download-json">Export JSON ↓</button></div></section>
 </div>`;
 const controlDeck=document.getElementById('control-deck');
 if(controlDeck){controlDeck.prepend(dock);controlDeck.append(actions);}else{document.body.append(dock);document.body.append(actions);}
 document.body.append(panel);
 const $=id=>document.getElementById(id);
 let state={phase:'idle',role:null,local:null,remote:null},metric='count',previousFocus=null,lastSignature='',lastDraw=0,drawTimer=null,shownSession=null,destroyed=false;
 const hasData=()=>Boolean(state.local||state.remote);
 const name=extension=>{
  const summaries=Object.values(participantSummaries(state)).filter(Boolean),demo=summaries.some(item=>item.mode==='demo');
  const kind=state.complete?'':'-partial';return `the-babel-${demo?'demo-':''}${String(state.sessionId||'session').slice(0,12)}-${metric}${kind}.${extension}`;
 };
 function renderResults(force=false){
  if(panel.hidden||destroyed)return;
  const signature=JSON.stringify([state.kind,state.sessionId,state.phase,state.complete,state.reason,state.statusText,state.local?.revision,state.remote?.revision,state.timing,metric]);
  if(!force&&signature===lastSignature)return;
  const now=performance.now();
  if(!force&&now-lastDraw<500){clearTimeout(drawTimer);drawTimer=setTimeout(()=>renderResults(true),500-(now-lastDraw));return;}
  clearTimeout(drawTimer);lastDraw=now;lastSignature=signature;
  const participants=participantSummaries(state),summaries=Object.values(participants).filter(Boolean);
  const source=summaries.some(item=>item.mode==='demo')?' · Simulated inputs':'';
  const status=state.phase==='recording'?'Recording':state.phase==='finishing'?'Synchronizing':state.complete?'Session complete':'Partial session';
  const reason={'disconnected':'Partner disconnected','start-timeout':'Start confirmation timed out','sync-timeout':'Final sync timed out'}[state.reason]||'';
  $('session-result-status').textContent=`${status} · ${solo(state)?'Solo':'Duet'}${source}${reason?' · '+reason:''}`;
  $('session-result-status').dataset.complete=String(Boolean(state.complete));
  panel.dataset.kind=solo(state)?'solo':'duet';
  $('session-summaries').innerHTML=sessionOverviewHTML(state);
  $('session-timing-note').textContent=solo(state)?'Recording starts when your camera is ready and stops when you finish or leave. Missing tracking does not pause the session timer.':'Recording begins after both participants confirm and stops when either finishes or disconnects. Each person’s coverage and tracked time are calculated separately. Missing partner data appears as a dash.';
  $('session-bar-legend').innerHTML=participantLegend(state);
  const occurrences=summaries.reduce((total,item)=>total+item.counts.reduce((n,c)=>n+c.episodes,0),0);
  $('session-chart-description').textContent=`${metric==='count'?occurrences+' occurrences':'Share of tracked time'} · ${recordedExpressionCount(state)} expression types`;
  $('session-chart').innerHTML=chartSVG(state,metric);
  $('session-table').innerHTML=detailTable(state);
  const timeline=sessionTimelineData(state);
  $('session-timeline-legend').innerHTML=participantLegend(state,true);
  $('session-timeline-description').textContent='0–100 index · gaps indicate missing tracking';
  $('session-timeline').innerHTML=sessionTimelineSVG(state);
  const unavailable=timeline.series.filter(item=>!item.available).map(item=>displayName(state,item.role));
  $('session-timeline-empty').hidden=timeline.hasValues&&!unavailable.length;
  $('session-timeline-empty').textContent=!timeline.hasTimeline?'No activity record for this session.':!timeline.hasValues?'No tracked facial activity; gaps remain empty.':unavailable.length?`Activity not received: ${unavailable.join(', ')}.`:'';
  $('session-download-timeline-csv').disabled=!timeline.hasTimeline;
  $('session-art-description').textContent=solo(state)?'A visual trace of your expressions and movement.':'A on the left. B on the right. A shared visual trace.';
  const circles=drawSessionArtwork($('session-art'),state,metric);
  $('session-art-empty').hidden=Boolean(circles.length);$('session-download-png').disabled=!circles.length;
  $('session-download-csv').disabled=!hasData();$('session-download-json').disabled=!hasData();
 }
 function close(){
  if(panel.hidden)return;
  panel.hidden=true;$('session-measurement').hidden=true;$('session-measurement-open').setAttribute('aria-expanded','false');clearTimeout(drawTimer);previousFocus?.focus?.();
 }
 function open(){
  if(!hasData())return;
  if(panel.hidden)previousFocus=document.activeElement;
  panel.hidden=false;renderResults(true);$('session-close').focus();
 }
 function update(next){
  const previousPhase=state.phase,previousSession=state.sessionId;state=next||state;
  const active=['starting','recording','finishing'].includes(state.phase);
  if(['starting','recording'].includes(state.phase)&&(previousSession!==state.sessionId||previousPhase==='complete'))close();
  dock.hidden=!(state.sourceActive||state.connected||state.canStart||state.role||hasData()||active);
  const presentation=sessionRecordingPresentation(state);
  dock.dataset.phase=state.phase;actions.hidden=dock.hidden;
  $('session-live-label').textContent=state.phase==='recording'?'REC':['complete','finishing'].includes(state.phase)?'STOP':'WAIT';
  $('session-live-clock').textContent=(presentation.elapsed||'0:00').padStart(5,'0');
  $('session-new-round').hidden=active;$('session-new-round').disabled=!state.canStart;
  $('session-new-round').textContent=!solo(state)&&state.connected&&state.role==='B'?'Waiting for host':'Create again ↗';
  $('session-new-round').title=state.canStart?'Start a new session':solo(state)?'Open your camera to create again':'Waiting for the host to start a new session';
  $('session-finish').disabled=!(state.canFinish||state.phase==='complete'&&hasData());
  $('session-finish').textContent=state.phase==='finishing'?'Creating…':state.phase==='starting'?'Starting…':'Finish & create ↗';
  if(state.phase==='complete'&&(previousPhase!=='complete'||shownSession!==state.sessionId)){shownSession=state.sessionId;open();}
  else renderResults();
 }
 const escape=e=>{
  if(panel.hidden)return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(!$('session-measurement').hidden){$('session-measurement-close').onclick();}else{close();onHome();}}
  if(e.key==='Tab'){
   const nodes=[...panel.querySelectorAll('button:not([disabled]),select,summary,[tabindex="0"]')].filter(node=>!node.hidden&&!node.closest('[hidden]'));
   const first=nodes[0],last=nodes[nodes.length-1];
   if(e.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){e.preventDefault();last?.focus();}
   else if(!e.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){e.preventDefault();first?.focus();}
  }
 };
 document.addEventListener('keydown',escape,true);
 // Keep the application's D shortcut out of the results dialog.
 panel.addEventListener('keydown',event=>event.stopPropagation());
 $('session-finish').onclick=()=>{if(state.phase==='complete'&&hasData())open();else if(state.canFinish)onFinish();};
 $('session-new-round').onclick=()=>{if(!state.canStart)return;close();onStart();};
 $('session-close').onclick=()=>{close();onHome();};
 $('session-measurement-open').onclick=()=>{$('session-measurement').hidden=false;$('session-measurement-open').setAttribute('aria-expanded','true');$('session-measurement-close').focus();};
 $('session-measurement-close').onclick=()=>{$('session-measurement').hidden=true;$('session-measurement-open').setAttribute('aria-expanded','false');$('session-measurement-open').focus();};
 $('session-chart-prev').onclick=()=>$('session-chart').scrollBy({left:-300,behavior:'smooth'});
 $('session-chart-next').onclick=()=>$('session-chart').scrollBy({left:300,behavior:'smooth'});
 $('session-metric').onchange=e=>{metric=e.target.value==='count'?'count':'duration';renderResults(true);};
 $('session-download-json').onclick=()=>saveBlob(new Blob([JSON.stringify(sessionExportData(state,metric),null,2)],{type:'application/json'}),name('json'));
 $('session-download-csv').onclick=()=>saveBlob(new Blob([sessionCSV(state,metric)],{type:'text/csv;charset=utf-8'}),name('csv'));
 $('session-download-timeline-csv').onclick=()=>saveBlob(new Blob([sessionTimelineCSV(state)],{type:'text/csv;charset=utf-8'}),name('csv').replace(/\.csv$/,'-facial-activity.csv'));
 $('session-download-png').onclick=()=>{
  renderResults(true);
  const filename=name('png');
  try{$('session-art').toBlob(blob=>{if(blob){saveBlob(blob,filename);$('session-export-status').textContent='Artwork saved.';}else $('session-export-status').textContent='Export failed. Please try again.';},'image/png');}
  catch{$('session-export-status').textContent='Could not export PNG. Please try again.';}
 };
 return {update,open,close,get panelOpen(){return !panel.hidden;},destroy(){destroyed=true;clearTimeout(drawTimer);document.removeEventListener('keydown',escape,true);dock.remove();actions.remove();panel.remove();}};
}
