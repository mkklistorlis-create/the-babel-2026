import {EXPRESSION_LIBRARY} from './expressions.js';
import {FACIAL_ACTIVITY_METRIC,FACIAL_ACTIVITY_DESCRIPTION} from './expression-activity.js';

const COLORS={A:'#d5ff00',B:'#8754ff'};
const INK='#11110f',PAPER='#f3f3eb';
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

function timingDescription(state){
 const parts=[solo(state)?'本轮从开始记录到你结束时计时。识别不到表情不会暂停计时，缺失时间会单独统计。':'本轮从双方确认开始后计时，到任一方结束时停止。识别不到表情不会暂停计时，缺失时间会单独统计。'];
 const timing=state.timing;
 if(timing){
  const localRole=['A','B'].includes(state.role)?state.role:null,peerRole=localRole?(localRole==='A'?'B':'A'):null;
  const startText={automatic:solo(state)?'画面开启后自动开始本轮。':'连接后自动开始本轮。',manual:'本轮由本机发起。',peer:'本轮由对方发起。',A:'由 A 发起本轮。',B:'由 B 发起本轮。'}[timing.startedBy];
  if(startText)parts.push(startText);
  if(Number.isFinite(timing.requestedAt)&&Number.isFinite(timing.startedAt)&&timing.startedAt>=timing.requestedAt)parts.push(`开始前等待 ${seconds(timing.startedAt-timing.requestedAt)}，未计入本轮。`);
  const endText={local:solo(state)?'由你结束本轮。':`由${localRole?' '+localRole+'（你）':'你'}结束本轮。`,peer:`由${peerRole?' '+peerRole+'（对方）':'对方'}结束本轮。`,A:'由 A 结束本轮。',B:'由 B 结束本轮。',disconnected:'连接中断后，本轮已停止。','source-off':'画面已关闭，本轮记录已停止。','start-timeout':'双方开始确认超时，本轮未开始。','sync-timeout':'最终同步超时，保留现有统计。'}[timing.endedBy];
  if(endText)parts.push(endText);
 }
 return parts.join(' ');
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
 const parts=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${solo(state)?'你的':'A、B 的'}表情波动折线图，纵轴 0 至 100，缺失记录处断开"><text x="${left}" y="18" fill="#696960" font-size="11">表情波动指数 · 0–100</text>`];
 for(let tick=0;tick<=4;tick++){
  const value=tick*25,py=y(value);
  parts.push(`<line x1="${left}" y1="${py}" x2="${right}" y2="${py}" stroke="${tick?'#11110f18':INK}"/><text x="48" y="${py+4}" text-anchor="end" fill="#696960" font-size="11">${value}</text>`);
 }
 for(let tick=0;tick<=4;tick++){
  const at=data.durationMs*tick/4,px=x(at),label=(at/1000).toFixed(data.durationMs<20000?1:0);
  if(data.durationMs===0&&tick>0)continue;
  parts.push(`<line x1="${n(px)}" y1="${bottom}" x2="${n(px)}" y2="${bottom+5}" stroke="${INK}"/><text x="${n(px)}" y="${bottom+23}" text-anchor="middle" fill="#696960" font-size="11">${label}</text>`);
 }
 for(const series of data.series){
  for(const segment of timelineSegments(series.points)){
   if(segment.length===1){
    const point=segment[0];parts.push(`<circle data-series="${series.role}" cx="${n(x(point[0]))}" cy="${n(y(point[1]))}" r="2.5" fill="${series.color}" stroke="${INK}" stroke-width=".6"><title>${series.label} · ${(point[0]/1000).toFixed(2)} 秒 · 指数 ${point[1]}</title></circle>`);
   }else{
    const path=segment.map((point,index)=>`${index?'L':'M'}${n(x(point[0]))},${n(y(point[1]))}`).join(' '),dash=series.dash?` stroke-dasharray="${series.dash}"`:'';
    parts.push(`<path d="${path}" fill="none" stroke="${INK}" stroke-opacity=".24" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"${dash}/><path data-series="${series.role}" d="${path}" fill="none" stroke="${series.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"${dash}><title>${series.label} · 已记录的表情波动</title></path>`);
   }
  }
 }
 parts.push(`<text x="${right}" y="344" text-anchor="end" fill="#696960" font-size="11">本轮时间（秒）</text></svg>`);
 return parts.join('');
}

function timelineNote(state){
 const data=sessionTimelineData(state),resolution=data.series.filter(item=>item.available).map(item=>`${solo(state)?'采样间隔':item.role+' 采样间隔'} ${(item.stepMs/1000).toFixed(item.stepMs%1000?2:0)} 秒`).join('；');
 const coarse=data.series.some(item=>item.stepMs>250)?'较长记录已合并采样，保留区间峰值；含缺失的区间留空。':'';
 return `依据眉眼嘴的运动幅度与变化速度，未采集语音。缺失段断开，0 表示有效的低活动状态。${solo(state)?'':'两条曲线分别从各自本轮开始计时，不代表毫秒级同步。'}${resolution?resolution+'。':''}${coarse}`;
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

export function drawSessionArtwork(canvas,state,metric='duration'){
 const context=canvas.getContext('2d');
 if(!context)return [];
 canvas.width=1600;canvas.height=1000;
 context.fillStyle=PAPER;context.fillRect(0,0,1600,1000);
 const circles=createArtworkLayout(state,metric);
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
  context.fillStyle=PAPER;context.beginPath();context.arc(item.x,item.y,item.r,0,Math.PI*2);context.fill();
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
 return {role:summary.role,mode:summary.mode,revision:summary.revision,durationMs:summary.durationMs,validMs:summary.validMs,missingMs:summary.missingMs,
  counts:EXPRESSION_LIBRARY.map(item=>{const count=summary.counts.find(entry=>entry.id===item.id);return {id:item.id,emoji:item.emoji,label:item.label,durationMs:nonnegative(count?.durationMs),episodes:nonnegative(count?.episodes)};}),timeline:safeTimeline(summary)};
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
 const width=1510,height=385,left=55,top=30,bottom=285,step=79;
 const parts=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${solo(state)?'你的':'A、B 的'}表情${metricName(metric)}柱状图；完整数据见下方表格">`];
 for(let index=0;index<=4;index++){
  const value=maximum*index/4,y=bottom-(bottom-top)*index/4;
  parts.push(`<line x1="${left}" y1="${y}" x2="1490" y2="${y}" stroke="${index?'#11110f18':INK}"/><text x="45" y="${y+4}" text-anchor="end" fill="#696960" font-size="11">${isCount?Number(value.toFixed(1)):Math.round(value*100)+'%'}</text>`);
 }
 rows.forEach((row,index)=>{
  const x=left+index*step+step/2;
  participantRoles(state).forEach((role,offset)=>{
   const value=row[role],h=value===null?0:value/maximum*(bottom-top),bx=solo(state)?x-10.5:x+(offset?-0: -23);
   if(value!==null)parts.push(`<rect x="${bx}" y="${bottom-h}" width="21" height="${h}" fill="${COLORS[role]}" stroke="${INK}" stroke-width=".6"><title>${solo(state)?'你':role} · ${escapeHTML(row.label)}：${isCount?value+' 次':escapeHTML(percent(value))}</title></rect>`);
   parts.push(`<text x="${bx+10.5}" y="${bottom-h-7}" text-anchor="middle" fill="#696960" font-size="9">${value===null?'—':isCount?value:escapeHTML(percent(value))}</text>`);
  });
  parts.push(`<text x="${x}" y="320" text-anchor="middle" font-size="27">${row.emoji}</text><text x="${x}" y="344" text-anchor="middle" fill="${INK}" font-size="10">${escapeHTML(row.label)}</text>`);
 });
 parts.push('</svg>');return parts.join('');
}

function summaryCard(role,summary,state){
 if(!summary)return `<article class="session-person" data-role="${role}"><h3><i></i>Participant ${role}</h3><p class="session-big">待同步</p><p>尚未收到对方的本轮统计。</p></article>`;
 const coverage=summary.durationMs>0?summary.validMs/summary.durationMs:0;
 return `<article class="session-person" data-role="${role}"><h3><i></i>${participantName(state,role)}<span class="session-source">${summary.mode==='demo'?'模拟画面':'摄像头'}</span></h3><p class="session-big">${escapeHTML(percent(coverage))}<small>有效识别覆盖率</small></p><dl><div><dt>本轮计时时长</dt><dd>${escapeHTML(seconds(summary.durationMs))}</dd></div><div><dt>有效表情时长</dt><dd>${escapeHTML(seconds(summary.validMs))}</dd></div><div><dt>未识别 / 暂停</dt><dd>${escapeHTML(seconds(summary.missingMs))}</dd></div></dl></article>`;
}

function detailTable(state){
 const participants=participantSummaries(state);
 return '<table><caption>各表情的完整统计</caption><thead><tr><th scope="col">表情</th>'+participantRoles(state).map(role=>`<th scope="col">${solo(state)?'你':role}的时长 / 占比 / 次数</th>`).join('')+'</tr></thead><tbody>'+EXPRESSION_LIBRARY.map(item=>`<tr><th scope="row">${item.emoji} ${item.label}</th>`+participantRoles(state).map(role=>{
  const summary=participants[role],count=summary?.counts.find(entry=>entry.id===item.id);
  return `<td>${!summary?'待同步':`${escapeHTML(seconds(count?.durationMs))} / ${summary.validMs>0?escapeHTML(percent(nonnegative(count?.durationMs)/summary.validMs)):'无有效识别'} / ${nonnegative(count?.episodes)} 次`}</td>`;
 }).join('')+'</tr>').join('')+'</tbody></table>';
}

function saveBlob(blob,name){
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function participantLegend(state,line=false){
 return participantRoles(state).map(role=>`<span><i data-role="${role}"${line?' class="session-line-key"':''}></i>${participantName(state,role)}${line&&!solo(state)?role==='A'?' · 实线':' · 虚线':''}</span>`).join('');
}

export function mountSessionResults({onStart=()=>{},onFinish=()=>{}}={}){
 const dock=document.createElement('section');dock.id='session-controls';dock.hidden=true;
 dock.setAttribute('aria-label','本轮交流统计');
 dock.innerHTML='<div><strong id="session-live-label">尚未开始</strong><span id="session-live-clock"></span></div><p id="session-live-status" role="status"></p><div class="session-control-actions"><button id="session-start">开始本轮统计</button><button id="session-finish" hidden>结束并生成 ↗</button><button id="session-open" hidden>查看统计</button></div>';
 const panel=document.createElement('section');panel.id='session-results';panel.hidden=true;
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','session-results-title');
 panel.innerHTML=`<div class="session-sheet"><header class="session-header"><div><p class="eyebrow">THE BABEL / SESSION PORTRAIT · R08</p><h2 id="session-results-title">这一次，我们留下了什么。</h2></div><button id="session-close" aria-label="关闭统计，返回联机">×</button></header>
  <p id="session-result-status" role="status"></p><div id="session-summaries"></div><p id="session-timing-note" class="session-note"></p>
  <section class="session-chart-section"><div class="session-section-heading"><div><p class="eyebrow">01 / EXPRESSION DISTRIBUTION</p><h3>表情分布</h3></div><label>统计口径 <select id="session-metric"><option value="count">按独立出现次数</option><option value="duration">按时长占比</option></select></label></div>
  <div id="session-bar-legend" class="session-legend"></div><p id="session-chart-description" class="session-note"></p><div id="session-chart" tabindex="0" aria-label="可横向滚动的表情柱状图"></div>
  <details class="session-details"><summary>查看全部统计数据</summary><div id="session-table"></div></details></section>
  <section class="session-timeline-section"><div class="session-section-heading"><div><p class="eyebrow">02 / FACIAL ACTIVITY</p><h3>表情波动</h3></div><button id="session-download-timeline-csv">导出曲线 CSV</button></div><div id="session-timeline-legend" class="session-legend"></div><p id="session-timeline-description" class="session-note"></p><div id="session-timeline" tabindex="0" aria-label="表情波动折线图"></div><p id="session-timeline-empty" class="session-note" hidden></p></section>
  <section class="session-art-section"><div class="session-section-heading"><div><p class="eyebrow">03 / AN EXPRESSION TRACE</p><h3>本轮的表情拼贴</h3></div><button id="session-download-png">保存纯艺术 PNG ↗</button></div><p id="session-art-description" class="session-note"></p><div class="session-art-wrap"><canvas id="session-art" width="1600" height="1000" aria-label="由本轮表情分布生成的 emoji 拼贴"></canvas><p id="session-art-empty" hidden>有了有效表情记录，作品就会在这里生成。</p></div></section>
  <footer class="session-footer"><p class="session-note">记录可见的面部动作。缺失时间单独统计；模拟画面会明确标记。<br>统计和导出在浏览器内完成，刷新页面后本轮记录会清除。</p><div><button id="session-download-csv">导出 CSV</button><button id="session-download-json">导出 JSON</button><button id="session-new-round">开始新一轮</button><button id="session-return">返回画面（未记录）</button></div></footer><p id="session-export-status" role="status"></p></div>`;
 document.body.append(dock,panel);
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
  const source=summaries.some(item=>item.mode==='demo')?(summaries.every(item=>item.mode==='demo')?'模拟演示数据。':'含模拟画面数据；A、B 来源见下方。'):'';
  const status=state.phase==='recording'?'REC · 正在记录，可继续。':state.phase==='finishing'?(solo(state)?'已停止记录，正在生成本轮统计…':'已停止记录，正在交换最终统计…'):state.complete?(solo(state)?'已停止记录，本轮统计已完成。':'已停止记录，双方最终统计已同步。'):'已停止记录，当前结果包含未完整同步的数据。';
  $('session-result-status').textContent=`${status} ${source} ${state.statusText||''}`;
  $('session-result-status').dataset.complete=String(Boolean(state.complete));
  panel.dataset.kind=solo(state)?'solo':'duet';
  $('session-results-title').textContent=solo(state)?'这一次，你留下了什么。':'这一次，我们留下了什么。';
  $('session-summaries').innerHTML=participantRoles(state).map(role=>summaryCard(role,participants[role],state)).join('');
  $('session-timing-note').textContent=timingDescription(state);
  $('session-bar-legend').innerHTML=participantLegend(state);
  $('session-chart-description').textContent=metric==='duration'?(solo(state)?'以你的有效表情时长为 100%，按占比排序。横向滚动可查看全部 18 类。':'各自有效识别时长为 100%。按双方占比之和排序；零点和纵轴尺度一致。横向滚动可查看全部 18 类。'):`屏幕 emoji 每次切换立即记 1 次，短暂出现也计入；持续同一表情不按帧重复计数。${solo(state)?'按出现次数排序。':'按双方次数之和排序，A、B 使用同一纵轴。'}横向滚动可查看全部 18 类。`;
  $('session-chart').innerHTML=chartSVG(state,metric);
  $('session-table').innerHTML=detailTable(state);
  const timeline=sessionTimelineData(state);
  $('session-timeline-legend').innerHTML=participantLegend(state,true);
  $('session-timeline-description').textContent=timelineNote(state);
  $('session-timeline').innerHTML=sessionTimelineSVG(state);
  const unavailable=timeline.series.filter(item=>!item.available).map(item=>item.label);
  $('session-timeline-empty').hidden=timeline.hasValues&&!unavailable.length;
  $('session-timeline-empty').textContent=!timeline.hasTimeline?'本轮没有曲线记录。开始新一轮后即可记录表情波动。':!timeline.hasValues?'本轮曲线尚无有效面部动作信号；缺失时间保留为空白。':unavailable.length?`${unavailable.join('、')} 的曲线尚未收到；其余已记录曲线显示如下。`:'';
  $('session-download-timeline-csv').disabled=!timeline.hasTimeline;
  $('session-art-description').textContent=`${solo(state)?'由你的本轮记录生成。':'左侧 A · 右侧 B，两人各分配相同总面积。'}单个 emoji 的面积与${metric==='duration'?'时长占比':'各表情出现次数的占比'}成正比。PNG 仅包含艺术画面。`;
  const circles=drawSessionArtwork($('session-art'),state,metric);
  $('session-art-empty').hidden=Boolean(circles.length);$('session-download-png').disabled=!circles.length;
  $('session-download-csv').disabled=!hasData();$('session-download-json').disabled=!hasData();
 }
 function close(){
  if(panel.hidden)return;
  panel.hidden=true;clearTimeout(drawTimer);previousFocus?.focus?.();
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
  $('session-live-label').textContent=presentation.label;
  $('session-live-clock').textContent=presentation.elapsed;
  $('session-live-status').textContent=presentation.status;
  $('session-return').textContent=presentation.returnLabel;
  $('session-close').setAttribute('aria-label',`关闭统计，${presentation.returnLabel}`);
  $('session-new-round').hidden=active;$('session-new-round').disabled=!state.canStart;
  $('session-new-round').title=state.canStart?'开始新的本轮记录':solo(state)?'开启画面后可开始新一轮':'由房主 A 发起新一轮';
  $('session-start').hidden=active;$('session-start').disabled=!state.canStart;
  $('session-start').textContent=state.phase==='complete'?'开始新一轮':'开始本轮统计';
  $('session-finish').hidden=!active;$('session-finish').disabled=!state.canFinish;
  $('session-finish').textContent=state.phase==='finishing'?(solo(state)?'正在生成…':'正在同步…'):state.phase==='starting'?'正在开始…':'结束并生成 ↗';
  $('session-open').hidden=!hasData();
  if(state.phase==='complete'&&(previousPhase!=='complete'||shownSession!==state.sessionId)){shownSession=state.sessionId;open();}
  else renderResults();
 }
 const escape=e=>{
  if(panel.hidden)return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}
  if(e.key==='Tab'){
   const nodes=[...panel.querySelectorAll('button:not([disabled]),select,summary,[tabindex="0"]')].filter(node=>!node.hidden);
   const first=nodes[0],last=nodes[nodes.length-1];
   if(e.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){e.preventDefault();last?.focus();}
   else if(!e.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){e.preventDefault();first?.focus();}
  }
 };
 document.addEventListener('keydown',escape,true);
 // Avoid the application's Space/D shortcuts while reading or operating results.
 panel.addEventListener('keydown',event=>event.stopPropagation());
 $('session-start').onclick=()=>{close();onStart();};$('session-finish').onclick=()=>onFinish();
 $('session-new-round').onclick=()=>{if(!state.canStart)return;close();onStart();};
 $('session-open').onclick=open;$('session-close').onclick=close;$('session-return').onclick=close;
 $('session-metric').onchange=e=>{metric=e.target.value==='count'?'count':'duration';renderResults(true);};
 $('session-download-json').onclick=()=>saveBlob(new Blob([JSON.stringify(sessionExportData(state,metric),null,2)],{type:'application/json'}),name('json'));
 $('session-download-csv').onclick=()=>saveBlob(new Blob([sessionCSV(state,metric)],{type:'text/csv;charset=utf-8'}),name('csv'));
 $('session-download-timeline-csv').onclick=()=>saveBlob(new Blob([sessionTimelineCSV(state)],{type:'text/csv;charset=utf-8'}),name('csv').replace(/\.csv$/,'-facial-activity.csv'));
 $('session-download-png').onclick=()=>{
  renderResults(true);
  const filename=name('png');
  try{$('session-art').toBlob(blob=>{if(blob){saveBlob(blob,filename);$('session-export-status').textContent='PNG 已生成，包含纯艺术画面。';}else $('session-export-status').textContent='导出暂未成功，请重试。';},'image/png');}
  catch{$('session-export-status').textContent='浏览器暂时无法导出 PNG，请重试。';}
 };
 return {update,open,close,get panelOpen(){return !panel.hidden;},destroy(){destroyed=true;clearTimeout(drawTimer);document.removeEventListener('keydown',escape,true);dock.remove();panel.remove();}};
}
