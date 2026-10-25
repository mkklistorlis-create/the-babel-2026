import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPRESSION_LIBRARY} from '../public/expressions.js';
import {sessionOverviewHTML,sessionChartData,createArtworkLayout,sessionExportData,sessionCSV,formatSessionDuration,formatSessionPercent,recordedExpressionCount,sessionRecordingPresentation,sessionTimelineData,timelineSegments,sessionTimelineSVG,sessionTimelineCSV,participantSummaries} from '../public/session-results.js';

const id='abcdef0123456789abcdef0123456789';
function summary(role,values,options={}){
 const counts=EXPRESSION_LIBRARY.map(item=>({id:item.id,durationMs:values[item.id]?.[0]||0,episodes:values[item.id]?.[1]||0}));
 const validMs=counts.reduce((sum,item)=>sum+item.durationMs,0);
 return {sessionId:id,role,mode:'live',revision:2,durationMs:validMs+2000,validMs,missingMs:2000,counts,...options};
}
function state(a,b){return {sessionId:id,phase:'complete',local:a,remote:b,complete:true};}

test('chart uses each person’s valid time, keeps 18 categories and distinguishes missing remote',()=>{
 const data=sessionChartData(state(summary('A',{smile:[6000,1],neutral:[4000,1]}),summary('B',{smile:[1000,1],neutral:[4000,2]})));
 assert.equal(data.length,18);
 assert.equal(data.find(row=>row.id==='smile').A,.6);
 assert.equal(data.find(row=>row.id==='smile').B,.2);
 assert.equal(data[0].id,'neutral');
 const missing=sessionChartData(state(summary('A',{smile:[6000,1]}),null));
 assert.equal(missing[0].A,1);assert.equal(missing[0].B,null);
 const empty=sessionChartData(state(summary('A',{}),null));
 assert.ok(empty.every(row=>row.A===null&&row.B===null));
});

test('count mode counts segments rather than seconds and changes ordering',()=>{
 const s=state(summary('A',{smile:[10000,1],wink:[1000,4]}),null);
 assert.equal(sessionChartData(s)[0].id,'smile');
 assert.equal(sessionChartData(s,'count')[0].id,'wink');
 assert.equal(sessionChartData(s,'count')[0].A,4);
});

test('zero-duration boundary events remain visible in count bars and count artwork',()=>{
 const s=state(summary('A',{wink:[0,1],'gaze-up':[0,2]}),null);
 const rows=sessionChartData(s,'count');
 assert.equal(rows[0].id,'gaze-up');assert.equal(rows[0].A,2);
 assert.equal(rows.find(row=>row.id==='wink').A,1);
 assert.equal(rows.find(row=>row.id==='neutral').A,0);
 assert.ok(rows.every(row=>row.B===null));
 const circles=createArtworkLayout(s,'count');
 assert.equal(circles.length,2);
 assert.ok(Math.abs(circles[0].r**2/circles[1].r**2-2)<1e-10);
 assert.ok(sessionChartData(s,'duration').every(row=>row.A===null));
 assert.deepEqual(createArtworkLayout(s,'duration'),[]);
 assert.equal(s.local.validMs,0,'display never invents time for a boundary event');
});

test('small positive duration and shares are never labeled zero',()=>{
 assert.equal(formatSessionDuration(1),'<0.1 秒');
 assert.equal(formatSessionDuration(99),'<0.1 秒');
 assert.equal(formatSessionDuration(100),'0.1 秒');
 assert.equal(formatSessionDuration(0),'0.0 秒');
 assert.equal(formatSessionPercent(.00001),'<0.1%');
 assert.equal(formatSessionPercent(.001),'0.1%');
 assert.equal(formatSessionPercent(.004),'0.4%');
 assert.equal(formatSessionPercent(0),'0.0%');
 const s=state(summary('A',{smile:[99999,1],wink:[1,1]}),null);
 assert.equal(sessionChartData(s,'duration').find(row=>row.id==='wink').A,.00001,'bar ratio remains the real value');
});

test('recorded expression count includes brief events and deduplicates A/B categories',()=>{
 const s=state(summary('A',{smile:[1000,1],wink:[0,1]}),summary('B',{smile:[100,1],'gaze-up':[0,1]}));
 assert.equal(recordedExpressionCount(s),3);
 assert.equal(recordedExpressionCount(state(null,null)),0);
});

test('recording labels distinguish waiting, active elapsed time and stopped results',()=>{
 const s=state(summary('A',{smile:[2900,1]},{durationMs:25000,missingMs:22100}),null);
 const idle=sessionRecordingPresentation({...s,phase:'idle',local:null});
 assert.equal(idle.label,'尚未开始');assert.equal(idle.elapsed,'');
 const waiting=sessionRecordingPresentation({...s,phase:'starting'});
 assert.equal(waiting.label,'等待双方开始确认');assert.equal(waiting.elapsed,'');
 const recording=sessionRecordingPresentation({...s,phase:'recording'});
 assert.equal(recording.label,'REC · 正在记录');assert.equal(recording.elapsed,'0:25','elapsed uses total time, including missing recognition');
 assert.match(recording.status,/未识别时计时继续/);assert.equal(recording.returnLabel,'返回画面（继续记录）');
 const stopped=sessionRecordingPresentation(s);
 assert.equal(stopped.label,'已停止 · 本轮');assert.equal(stopped.elapsed,'0:25');
 assert.equal(stopped.returnLabel,'返回画面（未记录）');assert.match(stopped.status,/开始新一轮后继续记录/);
 const syncing=sessionRecordingPresentation({...s,phase:'finishing'});
 assert.equal(syncing.label,'已停止 · 本轮');assert.match(syncing.status,/计时已停止/);
 const disconnected=sessionRecordingPresentation({...s,complete:false,reason:'disconnected',statusText:'连接已中断，保留已收到的部分统计'});
 assert.match(disconnected.status,/连接已中断/);assert.match(disconnected.status,/部分统计/);
 const timeout=sessionRecordingPresentation({...s,complete:false,reason:'start-timeout'});
 assert.match(timeout.status,/开始确认超时/);
});

test('artwork has proportional areas, equal A/B budgets and deterministic layout',()=>{
 const s=state(summary('A',{smile:[8000,4],wink:[2000,1]}),summary('B',{neutral:[5000,1]}));
 const circles=createArtworkLayout(s);
 assert.deepEqual(circles,createArtworkLayout(s));
 const a=circles.filter(item=>item.role==='A'),b=circles.filter(item=>item.role==='B');
 assert.ok(Math.abs(a[0].r/a[1].r-2)<1e-10,'four times the duration doubles radius');
 const area=items=>items.reduce((sum,item)=>sum+Math.PI*item.r**2,0);
 assert.ok(Math.abs(area(a)-area(b))<1e-8,'each person gets equal total area despite different valid times');
});

test('all expression circles fit inside the canvas without overlap',()=>{
 const values=Object.fromEntries(EXPRESSION_LIBRARY.map((item,index)=>[item.id,[(index+1)*1000,index+1]]));
 const circles=createArtworkLayout(state(summary('A',values),summary('B',values)));
 assert.equal(circles.length,36);
 for(const circle of circles){
  assert.ok(circle.x-circle.r>=0&&circle.x+circle.r<=1600);
  assert.ok(circle.y-circle.r>=0&&circle.y+circle.r<=1000);
 }
 for(let i=0;i<circles.length;i++)for(let j=i+1;j<circles.length;j++){
  const a=circles[i],b=circles[j];assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>a.r+b.r,'circles do not overlap');
 }
 assert.deepEqual(createArtworkLayout(state(summary('A',{}),null)),[]);
});

test('CSV and JSON distinguish simulated/partial data and contain only whitelisted statistics',()=>{
 const s={...state(summary('A',{smile:[1000,1]},{mode:'demo',roomId:'not-for-export',secret:'not-for-export'}),null),complete:false,reason:'disconnected',roomId:'not-for-export',token:'not-for-export'};
 const csv=sessionCSV(s),data=sessionExportData(s);
 assert.ok(csv.startsWith('\ufeff'));assert.equal(csv.split('\r\n').length,19);
 assert.match(csv,/,"demo","false",/);assert.match(csv,/嘴角上扬/);
 assert.equal(data.participants.A.mode,'demo');assert.equal(data.participants.B,null);
 assert.equal(data.complete,false);assert.equal(data.reason,'disconnected');
 assert.doesNotMatch(JSON.stringify(data),/not-for-export/);
 assert.doesNotMatch(csv,/not-for-export/);
 assert.equal(data.participants.A.counts.length,18);
 assert.equal(data.localTiming,null);
});

test('JSON exports local timing provenance without converting it to a cross-device clock',()=>{
 const timing={requestedAt:1000,startedAt:1700,endedAt:26700,startedBy:'automatic',endedBy:'peer',secret:'not-for-export'};
 const s={...state(summary('A',{smile:[2900,1]},{durationMs:25000,missingMs:22100}),null),role:'A',timing};
 const data=sessionExportData(s);
 assert.deepEqual(data.localTiming,{participant:'A',requestedAt:1000,startedAt:1700,endedAt:26700,startedBy:'automatic',endedBy:'peer'});
 assert.match(data.description,/local monotonic milliseconds/);assert.match(data.description,/do not compare timestamps across devices/);
 assert.doesNotMatch(JSON.stringify(data),/not-for-export/);
 assert.doesNotMatch(sessionCSV(s),/requestedAt|startedBy/,'CSV schema stays unchanged');
});

const timeline=(points,stepMs=250)=>({metric:'facial-activity-v1',stepMs,points});

test('solo results omit the other participant and center the artwork',()=>{
 const s={...state(summary('A',{smile:[1000,1]}),summary('B',{wink:[3000,2]})),kind:'solo'};
 assert.equal(participantSummaries(s).B,null,'a stale remote summary is excluded from solo results');
 assert.ok(sessionChartData(s,'count').every(row=>row.B===null));
 assert.equal(recordedExpressionCount(s),1);
 const circles=createArtworkLayout(s,'count');
 assert.equal(circles.length,1);assert.equal(circles[0].x,800);assert.equal(circles[0].y,500);
 assert.equal(sessionExportData(s).kind,'solo');assert.deepEqual(Object.keys(sessionExportData(s).participants),['A']);
 assert.doesNotMatch(sessionRecordingPresentation({...s,phase:'idle',local:null}).status,/双方|房主|对方/);
 assert.doesNotMatch(sessionRecordingPresentation({...s,phase:'starting'}).label,/双方/);
});

test('timeline paths break on missing values and retain genuine zero activity',()=>{
 const points=[[0,0],[250,25],[500,null],[750,0],[1000,50],[1250,null],[1500,20]];
 assert.deepEqual(timelineSegments(points),[[[0,0],[250,25]],[[750,0],[1000,50]],[[1500,20]]]);
 const s={...state(summary('A',{}, {durationMs:1500,timeline:timeline(points)}),null),kind:'solo'};
 const data=sessionTimelineData(s);
 assert.equal(data.series.length,1);assert.equal(data.series[0].label,'你');assert.equal(data.hasValues,true);
 assert.deepEqual(data.yDomain,[0,100]);assert.deepEqual(data.series[0].points,points);
 const svg=sessionTimelineSVG(s);
 assert.equal([...svg.matchAll(/<path data-series="A"/g)].length,2);
 assert.equal([...svg.matchAll(/<circle data-series="A"/g)].length,1);
 assert.doesNotMatch(svg,/data-series="B"|NaN|Infinity/);
});

test('a valid zero-only timeline remains visible even at a zero-duration boundary',()=>{
 const s={...state(summary('A',{}, {durationMs:0,validMs:0,missingMs:0,timeline:timeline([[0,0]])}),null),kind:'solo'};
 const data=sessionTimelineData(s);
 assert.equal(data.hasTimeline,true);assert.equal(data.hasValues,true);
 assert.match(sessionTimelineSVG(s),/<circle data-series="A"/);
 const missing={...s,local:{...s.local,timeline:timeline([[0,null]])}};
 assert.equal(sessionTimelineData(missing).hasValues,false);
 assert.doesNotMatch(sessionTimelineSVG(missing),/data-series=/);
});

test('duet timelines share the longest duration axis and distinguish B by dashes',()=>{
 const a=summary('A',{smile:[1000,1]},{durationMs:1000,timeline:timeline([[0,0],[1000,100]])});
 const b=summary('B',{neutral:[2000,1]},{durationMs:2000,timeline:timeline([[0,25],[2000,50]],500)});
 const s=state(a,b),data=sessionTimelineData(s),svg=sessionTimelineSVG(s);
 assert.equal(data.durationMs,2000);assert.equal(data.series.length,2);
 assert.equal(data.series[0].dash,null);assert.equal(data.series[1].dash,'8 5');
 assert.equal(data.series[1].stepMs,500);
 assert.match(svg,/data-series="A" d="M62,290 L536,40"/);
 assert.match(svg,/data-series="B" d="M62,227.5 L1010,165"/);
 assert.match(svg,/stroke-dasharray="8 5"/);
 assert.equal(sessionTimelineData(state({...a,timeline:undefined},null)).hasTimeline,false,'legacy summaries stay explicitly unavailable');
 const invalid={...a,timeline:timeline([[0,0],[3000,20]])};
 assert.equal(sessionTimelineData(state(invalid,null)).hasTimeline,false,'out-of-session data is never drawn');
});

test('timeline export preserves gaps, sampled zeros, resolution and solo source metadata',()=>{
 const points=[[0,0],[250,null],[500,30]];
 const s={...state(summary('A',{smile:[500,1]},{durationMs:500,mode:'demo',timeline:{...timeline(points),secret:'not-for-export'}}),null),kind:'solo'};
 const data=sessionExportData(s),csv=sessionTimelineCSV(s);
 assert.deepEqual(data.participants.A.timeline,timeline(points));
 assert.equal(data.timelineDefinition.metric,'facial-activity-v1');assert.deepEqual(data.timelineDefinition.range,[0,100]);
 assert.equal(data.timelineDefinition.missing,null);
 assert.match(data.timelineDefinition.timeAxis,/own session start/);
 assert.doesNotMatch(JSON.stringify(data),/not-for-export/);
 assert.ok(csv.startsWith('\ufeff'));assert.equal(csv.split('\r\n').length,4);
 assert.match(csv,/,"solo","A","demo","true","facial-activity-v1","250","0","0.000","0","true"/);
 assert.match(csv,/,"250","0.250","","false"/);
 assert.doesNotMatch(sessionCSV(s),/facial_activity_index/,'existing expression CSV schema is preserved');
 data.participants.A.timeline.points[0][1]=99;
 assert.equal(s.local.timeline.points[0][1],0,'export does not mutate live timeline');
});

test('compact overview keeps A/B attribution for guest and missing partner states',()=>{
 const a=summary('A',{smile:[8000,3]});const b=summary('B',{neutral:[2000,1]});
 const duet={kind:'duet',role:'B',local:b,remote:a};
 const html=sessionOverviewHTML(duet);assert.match(html,/A · Partner/);assert.match(html,/B · You/);
 assert.ok(html.indexOf('80.0%')<html.indexOf('50.0%'),'A and B coverage stays separate and role-ordered');
 const partial=sessionOverviewHTML({...duet,remote:null});assert.match(partial,/Not received/);assert.match(partial,/—/);
 const solo=sessionOverviewHTML({kind:'solo',role:'A',local:a,remote:b});
 assert.doesNotMatch(solo,/data-role="B"|50.0%/);assert.match(solo,/80.0%/);
});
