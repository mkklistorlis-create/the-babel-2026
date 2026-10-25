import {createExpressionRecorder} from './session-stats.js';
import {normalizeSessionMessage,SESSION_ID} from './session-protocol.js';

const noop=()=>{};
const randomSessionId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const copy=value=>value?JSON.parse(JSON.stringify(value)):null;
const ACTIVE=new Set(['starting','recording','finishing']);
const RETRY_MS=700,START_TIMEOUT_MS=10000,FINISH_TIMEOUT_MS=8000,SUMMARY_MS=1000;

/** Per-device monotonic durations; no cross-computer clock subtraction or frame counting. */
export function createSessionController({send,getSnapshot,onChange=noop,now=()=>performance.now(),randomId=randomSessionId,autoStart=false}={}){
 let connected=false,connectionRole=null,connectionRoom=null,phase='idle',sessionId=null,role=null;
 let kind='solo',sourceKnown=false,sourceActive=false,sourceMode=null,previousResult=null;
 let recorder=null,local=null,remote=null,remoteFinal=false,localAcknowledged=false,complete=false,reason=null;
 let acceptMessages=false,phaseSince=0,lastControl=-Infinity,lastSummary=-Infinity,hostBeganAt=null,destroyed=false;
 let automaticAttempted=false,timing={requestedAt:null,startedAt:null,endedAt:null,startedBy:null,endedBy:null};
 const retired=new Set(),completedReceipts=new Map();
 function snapshot(){try{return getSnapshot?.()||{};}catch{return {};}}
 function state(){
  const canStart=(connected?connectionRole==='A':sourceActive)&&!ACTIVE.has(phase)&&!destroyed;
  const texts={idle:connected?(connectionRole==='A'?'点击开始，记录这一轮的表情':'等待房主开始本轮'):sourceActive?'点击开始，记录这一轮的表情':'启动摄像头或演示后记录表情',
   starting:'正在与对方确认开始…',recording:kind==='solo'?'正在记录你的表情 · 本机统计':'正在记录表情 · 双方各自在本机统计',finishing:'正在交换并确认最终统计…',
   complete:complete?(kind==='solo'?'本轮单人统计已完成，可以继续下一轮':'本轮统计已同步，可以继续下一轮'):reason==='start-timeout'?'开始确认超时，请确认双方已刷新到新版后重试':reason==='disconnected'?'连接已中断，保留已收到的部分统计':'最终同步未完成，已保留现有统计'};
  return {phase,sessionId,role,kind,sourceActive,sourceMode,canStart,canFinish:(kind==='solo'?sourceActive:connected)&&phase==='recording',local:copy(local),remote:copy(remote),
   complete,reason,statusText:texts[phase],remoteFinal,localAcknowledged,connected,timing:{...timing},previousResult:copy(previousResult)};
 }
 function emit(){onChange(state());}
 function write(action,extra={}){
  if(kind!=='duet'||!connected||!sessionId||!role)return false;
  const payload=normalizeSessionMessage({action,sessionId,role,...extra});
  if(!payload)return false;
  try{return send?.(payload)===true;}catch{return false;}
 }
 function retire(id){if(!id)return;retired.add(id);if(retired.size>128)retired.delete(retired.values().next().value);}
 function resetRound(id,startedBy,nextKind='duet'){
  retire(sessionId);sessionId=id;kind=nextKind;role=kind==='solo'?'A':connectionRole;recorder=null;local=null;remote=null;
  remoteFinal=false;localAcknowledged=false;complete=false;reason=null;acceptMessages=kind==='duet';
  phase='starting';phaseSince=now();lastControl=-Infinity;lastSummary=-Infinity;hostBeganAt=null;
  timing={requestedAt:phaseSince,startedAt:null,endedAt:null,startedBy,endedBy:null};
 }
 function sample(at,input=snapshot()){
  if(!recorder||phase!=='recording')return;
  recorder.sample({expressionId:input?.expression?.id,actions:input?.expression?.actions,score:input?.expression?.score,
   valid:(!sourceKnown||sourceActive)&&input?.present===true&&!input.paused&&input.mode===local?.mode&&Boolean(input.expression)},at);
  local=recorder.snapshot(at);
 }
 // Capture every displayed state transition, including flashes between timer
 // ticks. Rendering and network summaries remain on the slower tick cadence.
 function observe(input=snapshot(),at=now()){
  if(destroyed||phase!=='recording')return false;
  sample(at,input);return true;
 }
 function beginRecording(){
  if(phase!=='starting')return;
  const input=snapshot(),at=now();
  // Anchor construction and the first sample to the same clock reading. A live
  // performance.now() advances between calls and would reject that first sample.
  recorder=createExpressionRecorder({sessionId,role,mode:input.mode==='demo'?'demo':'live',now:()=>at});
  local=recorder.snapshot(at);phase='recording';phaseSince=at;timing.startedAt=at;sample(at);
  if(kind==='duet'&&role==='A')hostBeganAt=at;
  lastSummary=at;write('summary',{summary:local});
 }
 function closeRecorder(endedBy){
  const at=now();
  if(timing.endedAt===null){timing.endedAt=at;timing.endedBy=endedBy||null;}
  if(phase==='recording')sample(at);
  if(recorder)local=recorder.finish(at);
  else{
   const input=snapshot();
   recorder=createExpressionRecorder({sessionId,role,mode:input.mode==='demo'?'demo':'live',now:()=>at});
   local=recorder.finish(at);
  }
 }
 function tryComplete(){
  if(phase==='finishing'&&remoteFinal&&localAcknowledged){
   phase='complete';complete=true;reason=null;completedReceipts.set(sessionId,remote.revision);
   if(completedReceipts.size>16)completedReceipts.delete(completedReceipts.keys().next().value);
   emit();
  }
 }
 function startFinishing(endedBy){
  if(phase==='finishing'||phase==='complete')return;
  closeRecorder(endedBy);phase='finishing';phaseSince=now();lastControl=-Infinity;hostBeganAt=null;
 }
 function sendFinal(){lastControl=now();write('final',{summary:local});}
 function partial(why){
  if(!ACTIVE.has(phase))return;
  closeRecorder(why);phase='complete';complete=false;reason=why;hostBeganAt=null;emit();
 }
 function expireStarting(at=now()){
  if(phase!=='starting'||at-phaseSince<START_TIMEOUT_MS)return false;
  acceptMessages=false;partial('start-timeout');return true;
 }
 function finishSolo(endedBy='local',notify=true){
  if(kind!=='solo'||!ACTIVE.has(phase))return false;
  closeRecorder(endedBy);phase='complete';complete=true;reason=null;hostBeganAt=null;acceptMessages=false;
  if(notify)emit();return true;
 }
 function archiveResult(){
  if(!local)return;
  previousResult={kind,phase,sessionId,role,local:copy(local),remote:copy(remote),complete,reason,timing:{...timing},remoteFinal,localAcknowledged};
 }
 function enterDuet(){
  if(kind==='duet')return;
  // A camera may have started just before joining a room. Keep its solo result
  // separately, without briefly opening a completion panel during the join.
  finishSolo('joined-room',false);archiveResult();retire(sessionId);
  kind='duet';phase='idle';sessionId=null;role=connectionRole;recorder=null;local=null;remote=null;
  remoteFinal=false;localAcknowledged=false;complete=false;reason=null;acceptMessages=false;
  hostBeganAt=null;timing={requestedAt:null,startedAt:null,endedAt:null,startedBy:null,endedBy:null};
 }
 function setSource(value={}){
  if(destroyed)return false;
  const active=value.active===true,mode=['live','demo'].includes(value.mode)?value.mode:sourceMode;
  if(active&&!['live','demo'].includes(mode))return false;
  if(sourceKnown&&active===sourceActive&&mode===sourceMode)return false;
  const activation=active&&(!sourceActive||mode!==sourceMode),stopping=sourceActive&&(!active||mode!==sourceMode);
  // Finish before replacing source identity so the last interval belongs to the
  // source that actually produced it. A new source can then start a fresh round.
  if(stopping&&kind==='solo')finishSolo('source-off',false);
  sourceKnown=true;sourceActive=active;sourceMode=mode;
  if(!active&&kind==='duet'&&phase==='recording')sample(now(),{mode:local?.mode,present:false,paused:true,expression:null});
  if(activation&&!connected&&autoStart){if(startRound('automatic'))return true;}
  emit();return true;
 }
 function setConnection(value={}){
  if(destroyed)return;
  const nextConnected=value.status==='connected',nextRole=['A','B'].includes(value.role)?value.role:null,nextRoom=value.roomId||null;
  if(nextConnected===connected&&nextRole===connectionRole&&nextRoom===connectionRoom)return;
  const replaced=connected&&(nextRoom!==connectionRoom||nextRole!==connectionRole);
  if((connected&&!nextConnected)||replaced){partial('disconnected');acceptMessages=false;completedReceipts.clear();automaticAttempted=false;}
  connected=nextConnected;connectionRole=nextRole;connectionRoom=nextRoom;
  if(connected)enterDuet();
  if(autoStart&&connected&&connectionRole==='A'&&!automaticAttempted){
   // Mark before startRound emits or sends, so reentrant room updates cannot
   // start a second round or replace a completed one on the same connection.
   automaticAttempted=true;
   if(startRound('automatic'))return;
  }
  emit();
 }
 function startRound(startedBy){
  if(!state().canStart)return false;
  const id=randomId();if(typeof id!=='string'||!SESSION_ID.test(id)||retired.has(id)||id===sessionId)return false;
  const nextKind=connected?'duet':'solo';if(local&&nextKind!==kind)archiveResult();
  resetRound(id,startedBy,nextKind);lastControl=now();
  if(kind==='solo')beginRecording();else write('start');
  emit();return true;
 }
 function start(){return startRound('manual');}
 function finish(){
  if(destroyed||phase!=='recording')return false;
  if(kind==='solo')return finishSolo();
  if(!connected)return false;
  startFinishing('local');write('stop');sendFinal();emit();return true;
 }
 function receive(raw){
  if(destroyed||!connected||kind!=='duet')return false;
  const message=normalizeSessionMessage(raw);
  if(!message||message.role===connectionRole)return false;
  // A final acknowledgement may be lost just as the host starts another round.
  // Answer the previous final without mixing its data into the current result.
  if(message.action==='final'&&completedReceipts.get(message.sessionId)===message.summary.revision){
   try{send?.({action:'ack',sessionId:message.sessionId,role:connectionRole,revision:message.summary.revision});}catch{}
   return true;
  }
  if(message.action==='start'){
   if(connectionRole!=='B'||retired.has(message.sessionId))return false;
   if(message.sessionId!==sessionId){
    if(ACTIVE.has(phase))return false;
    resetRound(message.sessionId,'peer');
   }else if(!acceptMessages||phase==='complete'||phase==='finishing')return false;
   else if(expireStarting())return false;
   lastControl=now();write('ready');emit();return true;
  }
  if(!acceptMessages||message.sessionId!==sessionId||role!==connectionRole)return false;
  if(['ready','begin','stop','final'].includes(message.action)&&expireStarting())return false;
  if(message.action==='ready'){
   if(role!=='A'||!['starting','recording'].includes(phase))return false;
   // Queue begin before the first summary so the guest starts its own clock first.
   lastControl=now();write('begin');beginRecording();emit();return true;
  }
  if(message.action==='begin'){
   if(role!=='B'||!['starting','recording'].includes(phase))return false;
   beginRecording();write('summary',{summary:local});emit();return true;
  }
  if(message.action==='summary'||message.action==='final'){
   if(!['recording','finishing','complete'].includes(phase)&&!(message.action==='final'&&phase==='starting'))return false;
   const incoming=message.summary;
   if(remote&&(incoming.mode!==remote.mode||incoming.revision<remote.revision))return false;
   if(remoteFinal&&(message.action!=='final'||incoming.revision!==remote.revision))return false;
   if(!remoteFinal)remote=copy(incoming);
   if(message.action==='summary'){hostBeganAt=null;emit();return true;}
   remoteFinal=true;hostBeganAt=null;
   write('ack',{revision:remote.revision});
   if(phase==='recording'||phase==='starting')startFinishing('peer');
   if(phase==='finishing'){sendFinal();tryComplete();}
   emit();return true;
  }
  if(message.action==='stop'){
   if(!['starting','recording','finishing'].includes(phase))return false;
   startFinishing('peer');sendFinal();emit();return true;
  }
  if(message.action==='ack'){
   if(!['finishing','complete'].includes(phase)||!local||message.revision!==local.revision)return false;
   localAcknowledged=true;tryComplete();emit();return true;
  }
  return false;
 }
 function tick(){
  if(destroyed)return;
  const at=now();
  if(phase==='starting'){
   if(expireStarting(at))return;
   if(at-lastControl>=RETRY_MS){lastControl=at;write(role==='A'?'start':'ready');}
  }else if(phase==='recording'){
   sample(at);
   if(hostBeganAt!==null){
    if(at-hostBeganAt>=START_TIMEOUT_MS){partial('start-timeout');acceptMessages=false;return;}
    if(at-lastControl>=RETRY_MS){lastControl=at;write('begin');}
   }
   if(kind==='duet'&&at-lastSummary>=SUMMARY_MS){lastSummary=at;write('summary',{summary:local});}
  }else if(phase==='finishing'){
   if(at-phaseSince>=FINISH_TIMEOUT_MS){partial('sync-timeout');return;}
   if(at-lastControl>=RETRY_MS)sendFinal();
  }
  if(ACTIVE.has(phase))emit();
 }
 function destroy(){if(destroyed)return;if(kind==='solo')finishSolo('source-off');else partial('disconnected');destroyed=true;connected=false;sourceActive=false;acceptMessages=false;}
 return {setSource,setConnection,start,finish,receive,observe,tick,destroy,get state(){return state();}};
}
