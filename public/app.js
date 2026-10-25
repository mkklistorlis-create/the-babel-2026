import {DuetCanvas,getDemoPeople} from './duet-canvas.js';
import {createTracker} from './tracking.js';
import {EXPRESSION_LIBRARY,createExpressionTracker,expressionForDemo} from './expressions.js';
import {mountRoomUI} from './room-ui.js';
import {createSessionController} from './session-controller.js';
import {mountSessionResults} from './session-results.js';
import {mountSpeechUI} from './speech/speech-ui.js';

const $=id=>document.getElementById(id);
const paused=false;
const occupancyNames={single:'单人已确认',multiple:'检测到多人',empty:'未检测到人',uncertain:'正在确认单人'};
const expressions=createExpressionTracker();
let renderer,roomUI,speechUI,sessionController,sessionResults,sessionTimer,mode='idle',generation=0,frame=0,cameraReady=false;
let people=[],occupancy='empty',ownershipEpoch=0,observedPeopleCount=0;
let lastTracking=0,lastObserved=0,latency=0,faceCount=0,poseCount=0,trackingHealthy=false;
let backgroundReady=false,backgroundWarning='',trackingWarnings=[],sourceStatuses={};
let selected=EXPRESSION_LIBRARY[0].id,expression={visible:false,emoji:'',label:'等待面部'};
let notification='',notificationKind='general',statusTimer,controlsTimer,lastMetric=0;

for(const item of EXPRESSION_LIBRARY)$('demo-expression').add(new Option(`${item.emoji} ${item.label}`,item.id));
$('demo-expression').value=selected;
$('emoji-library').textContent=EXPRESSION_LIBRARY.map(item=>item.emoji).join(' ');
try{renderer=new DuetCanvas($('stage'));}
catch(error){$('boot-error').textContent=`图形初始化失败：${error.message}。请使用支持 WebGL2 的浏览器。`;$('start').disabled=true;}

function renderNotice(){
 const text=mode==='live'&&occupancy==='multiple'
  ?'检测到多人。请保持镜头内只有一人；单人确认后继续表情和双手追踪。'
  :notification;
 $('status').textContent=text;$('status').hidden=!text;
}
function notice(text,persist=false,kind='general'){
 notification=text;notificationKind=kind;clearTimeout(statusTimer);renderNotice();
 if(!persist)statusTimer=setTimeout(()=>{notification='';renderNotice();},4500);
}
function status(event){
 if(!event)return;
 const previous=sourceStatuses[event.kind];sourceStatuses[event.kind]=event;
 $('tracker-status').textContent=event.message||event.state;
 if(['error','recovering','off','loading'].includes(event.state)){
  trackingHealthy=false;expressions.reset();expression={visible:false,emoji:'',label:'等待面部'};
  if(event.state==='error'||event.state==='recovering')occupancy='uncertain';
  observeSession();
 }
 if(event.state==='error'){speechUI?.stop('摄像头已停止，请重新开启语音。');cameraReady=false;sessionController?.setSource?.({active:false,mode});roomUI?.leave();}
 if(event.state==='error'||event.state==='recovering')notice(event.message,true,'tracking');
 else if(event.state==='warning'){
  const actionable=Array.isArray(event.diagnostics)?event.diagnostics.filter(w=>w.stage!=='occupancy'):null;
  if(!actionable||actionable.length)notice(actionable?actionable.map(w=>w.message).join('；'):event.message,false,'tracking');
 }else if(event.state==='ready'&&notificationKind==='tracking')notice(previous?.state==='recovering'?event.message:'',false,'tracking');
}
function eligible(now=performance.now()){
 return mode==='live'&&trackingHealthy&&occupancy==='single'&&people.length===1&&!people[0].stale&&lastTracking>0&&now-lastTracking<800&&now-lastObserved<900;
}
// The six/seven sequence spans several CPU observations. Its bounded evidence
// budget must survive the shorter face/ink display budget between arrivals.
function gestureEligible(now=performance.now()){
 return mode==='live'&&trackingHealthy&&occupancy==='single'&&people.length===1&&!people[0].stale&&lastTracking>0&&now-lastTracking<1400&&now-lastObserved<2200;
}
function gestureOwner(){return `${generation}:${people[0]?.id??'none'}`;}
const tracker=createTracker({video:$('camera'),onStatus:status,onFrame(data){
 if(mode!=='live'){data.matchedFrame?.close();return;}
 people=data.people||[];occupancy=data.occupancy||'uncertain';
 ownershipEpoch=data.ownershipEpoch??ownershipEpoch;
 speechUI?.checkSource?.();
 trackingHealthy=data.countGuardHealthy===true;
 observedPeopleCount=data.observedPeopleCount||0;faceCount=data.faceCount||0;poseCount=data.poseCount||0;
 backgroundReady=Boolean(data.foregroundMask?.complete);backgroundWarning=data.foregroundWarning||'';
 trackingWarnings=data.trackingWarnings||[];latency=data.latencyMs||0;lastTracking=performance.now();
 lastObserved=Number.isFinite(data.frameTimestamp)?Math.min(lastTracking,data.frameTimestamp):lastTracking;
 expression=expressions.update(people[0],lastTracking,{eligible:eligible(lastTracking),owner:`${generation}:${ownershipEpoch}`});
 observeSession();
 renderer?.setState({matchedFrame:data.matchedFrame||null,foregroundMask:data.foregroundMask||null,
  people,count:people.length,occupancy,ownershipEpoch:`${generation}:${ownershipEpoch}`,interactionsEnabled:eligible(lastTracking),
  gestureEnabled:gestureEligible(lastTracking),gestureOwner:gestureOwner(),expression});
 renderNotice();
}});
function showControls(){document.body.classList.add('controls-visible');clearTimeout(controlsTimer);controlsTimer=setTimeout(()=>document.body.classList.remove('controls-visible'),2200);}
function enter(next){
 generation++;mode=next;cameraReady=false;people=[];occupancy='empty';trackingHealthy=false;
 lastTracking=0;lastObserved=0;latency=0;faceCount=0;poseCount=0;observedPeopleCount=0;
 backgroundReady=false;backgroundWarning='';trackingWarnings=[];sourceStatuses={};expressions.reset();
 expression={visible:false,emoji:'',label:'等待面部'};
 renderer?.setState({mode:next,matchedFrame:null,foregroundMask:null,people:[],count:0,expression,interactionsEnabled:false,gestureEnabled:false,gestureOwner:gestureOwner(),ownershipEpoch:`${generation}:0`});
 $('intro').hidden=true;$('transport').hidden=false;$('mode-tag').hidden=next!=='demo';
 $('demo-settings').hidden=next!=='demo';$('stage').focus();showControls();return generation;
}
async function start(){
 if(!renderer||mode!=='idle')return mode==='live'&&cameraReady;
 const token=enter('live');void speechUI?.start?.();notice('正在启动摄像头与视觉追踪…',true);
 try{await tracker.start();if(token!==generation)return false;cameraReady=true;sessionController?.setSource?.({active:true,mode:'live'});notice('把双手伸入画面试着划线，再试试微笑、张嘴或转头。');return true;}
 catch(error){if(token!==generation)return false;cameraReady=false;speechUI?.stop('摄像头未启动，麦克风已关闭。');notice(`摄像头无法启动：${error.message||'请检查授权或模型加载'}。Esc 返回后重试。`,true);$('debug').hidden=false;return false;}
}
function stop(){
 speechUI?.stop();
 sessionController?.setSource?.({active:false,mode});
 roomUI?.leave();roomUI?.closePanel();
 generation++;mode='idle';cameraReady=false;trackingHealthy=false;occupancy='empty';
 tracker.stop();expressions.reset();people=[];expression={visible:false,emoji:'',label:'等待面部'};
 renderer?.setState({mode:'idle',matchedFrame:null,foregroundMask:null,people:[],count:0,expression,interactionsEnabled:false,gestureEnabled:false,gestureOwner:gestureOwner(),ownershipEpoch:`${generation}:0`});
 $('intro').hidden=false;$('transport').hidden=true;$('debug').hidden=true;$('mode-tag').hidden=true;notice('');$('start').focus();
}
$('start').onclick=start;
function startDemo(){if(!renderer||mode!=='idle')return mode==='demo';enter('demo');expression=expressionForDemo(selected);sessionController?.setSource?.({active:true,mode:'demo'});notice('动态演示：双手划线、粒子和头部贴饰均为模拟。点击画面切换表情。');return true;}
$('exit').onclick=stop;
$('debug-close').onclick=()=>$('debug').hidden=true;
function selectDemoExpression(id){
 selected=id;
 if(mode==='demo'){expression=expressionForDemo(selected);observeSession();}
}
$('demo-expression').onchange=e=>selectDemoExpression(e.target.value);
function pointerPosition(e){const b=$('stage').getBoundingClientRect?.()||{left:0,top:0,width:innerWidth,height:innerHeight};return [(e.clientX-b.left)/b.width,(e.clientY-b.top)/b.height];}
$('stage').onpointermove=e=>{renderer?.setPointer(...pointerPosition(e),e.buttons>0);showControls();};
$('stage').onpointerdown=e=>{
 if(mode==='demo'){
  selectDemoExpression(EXPRESSION_LIBRARY[(EXPRESSION_LIBRARY.findIndex(item=>item.id===selected)+1)%EXPRESSION_LIBRARY.length].id);
  $('demo-expression').value=selected;
 }
 renderer?.setPointer(...pointerPosition(e),true);
};
$('stage').onpointerup=e=>renderer?.setPointer(...pointerPosition(e),false);
window.addEventListener('keydown',e=>{
 if(e.defaultPrevented)return;
 if(sessionResults?.panelOpen){if(e.key==='Escape'){e.preventDefault();sessionResults.close();}return;}
 if(e.key==='Escape'){if(roomUI?.panelOpen)roomUI.closePanel();else if(!$('debug').hidden)$('debug').hidden=true;else if(mode!=='idle')stop();return;}
 if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||mode==='idle')return;
 if(e.key.toLowerCase()==='d')$('debug').hidden=!$('debug').hidden;
});
window.addEventListener('pagehide',()=>{speechUI?.destroy();roomUI?.destroy();sessionController?.destroy();sessionResults?.destroy();clearInterval(sessionTimer);tracker.stop();renderer?.destroy();cancelAnimationFrame(frame);clearTimeout(statusTimer);clearTimeout(controlsTimer);});
function animate(now){
 if(renderer){
  const demo=mode==='demo',livePeople=demo?getDemoPeople(now/1000).slice(0,1):mode==='live'?people:[];
  const interactionsEnabled=demo||eligible(now);
  const previousExpression=expression;
  if(demo)expression=expressionForDemo(selected);
  else if(!interactionsEnabled)expression=expressions.update(null,now,{eligible:false,owner:`${generation}:${ownershipEpoch}`});
  if(previousExpression.id!==expression.id||previousExpression.visible!==expression.visible)observeSession();
  renderer.setState({mode,people:livePeople,count:livePeople.length,occupancy:demo?'single':occupancy,
   ownershipEpoch:demo?`demo:${generation}`:`${generation}:${ownershipEpoch}`,video:$('camera'),expression,interactionsEnabled,
   gestureEnabled:demo||gestureEligible(now),gestureOwner:demo?`demo:${generation}`:gestureOwner(),paused});
  if(now-lastMetric>300){
   lastMetric=now;
   const person=livePeople[0],hands=demo||gestureEligible(now)||interactionsEnabled?(person?.hands||[]):[];
   $('metrics').textContent=`${demo?'模拟演示':'摄像头'} · R12.2 · ${demo?'单人模拟':occupancyNames[occupancy]}\n人脸 ${faceCount} / 姿态 ${poseCount} / 双手 ${hands.length} · 推理 ${Math.round(latency)} ms\n${renderer.rendererType||'Three.js / WebGL'} · ${Math.round(renderer.fps||0)} FPS\n背景 ${demo?'演示背景':backgroundReady?'同帧实景':'等待完整遮罩'}${backgroundWarning?' / '+backgroundWarning:''}${mode==='live'&&lastTracking&&now-lastTracking>=800?' · 等待新的追踪帧':''}`;
   $('expression-output').textContent=expression.visible?`${expression.emoji} ${expression.label}`:'等待清晰面部';
   $('hand-status').textContent=renderer.sixSeven?.stats.active?'6 / 7 手势 · 数字跟随双手':hands.length?`已追踪 ${hands.length} 只手 · 移动手指即可划线`:'双手进入镜头后开始划线';
   const gesture=renderer.sixSeven?.stats||{},count=gesture.trackedHands??0;
   const reason=occupancy==='multiple'?'检测到多人，已暂停':!demo&&!gestureEligible(now)?'等待清晰的单人追踪'
    :gesture.status==='stopped-fists'?'双手握拳，已结束':gesture.status==='stopped-missing'?'双手离开，已结束'
    :gesture.status==='confirming-fists'?'正在确认双手握拳':gesture.status==='waiting-open'?'松开双拳后可重新开始'
    :gesture.latched?count===2?'已开启，数字持续跟手':count===1?'一只手暂时离开，另一只继续跟随':'双手暂时未识别，等待确认离开'
    :gesture.status==='stale'?'等待新的手部数据':count<2?'请让两只手都进入镜头':'双手上下位置交换一次即可';
   $('gesture-status').textContent=`6 / 7 · 双手 ${count}/2 · 上下交换 ${gesture.crossings??0}/1 · 握拳 ${gesture.fistHands??0}/2\n${reason}${gesture.sampleIntervalMs>0?` · 采样 ${(1000/gesture.sampleIntervalMs).toFixed(1)} 次/秒`:''}`;
   $('face-actions').textContent=expression.actions?Object.entries(expression.actions).filter(([,v])=>typeof v==='number'&&v>.15).map(([key,value])=>`${key} ${value.toFixed(2)}`).join(' · '):'';
  }
 }
 frame=requestAnimationFrame(animate);
}
frame=requestAnimationFrame(animate);
function getInteractionSnapshot(){
  const demo=mode==='demo',present=demo||eligible(),person=demo?getDemoPeople(performance.now()/1000)[0]:people[0];
  const hands=present?(person?.hands||[]).slice(0,2).map(hand=>({id:String(hand.id),tip:hand.tip,palm:hand.palm})):[];
  return {mode,present,hands,language:speechUI?.language||'zh',expression:expression.visible?{id:expression.id,score:expression.score,actions:expression.actions}:null,
   aspect:renderer?.width/renderer?.height||1};
}
sessionResults=mountSessionResults({onStart:()=>sessionController?.start(),onFinish:()=>sessionController?.finish()});
function getStatisticsSnapshot(){
 return {mode,present:mode==='demo'||eligible(),paused:paused||document.hidden===true,
  expression:expression.visible?{id:expression.id,actions:expression.actions,score:expression.score,demo:expression.demo===true}:null};
}
// Record every recognized transition at its source. The periodic tick is for
// freshness, UI updates and synchronization; it must not be the only observer.
function observeSession(){sessionController?.observe(getStatisticsSnapshot());}
sessionController=createSessionController({autoStart:true,send:message=>roomUI?.sendSession(message)||false,
 getSnapshot:getStatisticsSnapshot,
 onChange:state=>sessionResults.update(state)});
speechUI=mountSpeechUI({getDiagnostics:()=>({mode,occupancy,ownershipEpoch}),sendMeaning:message=>roomUI?.sendMeaning(message)||false});
roomUI=mountRoomUI({canvas:$('stage'),getMode:()=>mode,
 prepareSource:kind=>kind==='demo'?startDemo():start(),getSnapshot:getInteractionSnapshot,
 onConnectionState:state=>{sessionController.setConnection(state);speechUI.setConnection(state);},onSession:message=>sessionController.receive(message),onMeaning:message=>speechUI.receiveMeaning(message)});
sessionTimer=setInterval(()=>sessionController.tick(),200);
document.addEventListener?.('visibilitychange',()=>sessionController.tick());
window.betweenUs={get diagnostics(){return {revision:'12.3-speech',inputMode:speechUI?.diagnostics.active?'camera-and-speech':'camera-only',networked:roomUI?.diagnostics.status==='connected',mode,paused,
 occupancy,observedPeopleCount,ownershipEpoch,interactionsEnabled:eligible(),count:mode==='demo'?1:people.length,
 faceCount,poseCount,handCount:gestureEligible()?(people[0]?.hands?.length||0):0,expression,
 backgroundReady,backgroundWarning,trackingWarnings,statuses:sourceStatuses,renderer:renderer?.rendererType,fps:renderer?.fps,latency,
 sixSeven:renderer?.sixSeven?.stats,affectBackdrop:renderer?.affectBackdrop?.stats,gestureEnabled:mode==='demo'||gestureEligible(),room:roomUI?.diagnostics,session:sessionController.state,microphone:Boolean(speechUI?.diagnostics.active),transcription:Boolean(speechUI?.diagnostics.active),semantics:Boolean(speechUI?.diagnostics.active),speech:speechUI?.diagnostics};}};
