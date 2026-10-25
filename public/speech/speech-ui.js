import {createSemanticPlugin} from './semantic-plugin.js';
import {TurnView} from './ui-state.js';

const languageNames={auto:'自动',zh:'中文',en:'English',ja:'日本語',es:'Español',mixed:'混合语言',und:'未确定语言'};
const intents={statement:'陈述',question:'提问',request:'请求',evaluate:'评价',agree:'赞同',disagree:'分歧',greeting:'问候',other:'其他'};
export const CAPTION_FINAL_HOLD_MS=1300;

/** Entry starts speech; the existing toolbar only offers stop/retry. */
export function mountSpeechUI({getDiagnostics,sendMeaning=()=>false,plugin=createSemanticPlugin(),platform=globalThis}={}){
 const $=id=>platform.document.getElementById('speech-'+id);
 const turns=new TurnView(),remoteTurns=new TurnView();
 const turnOrders=new Map();let nextTurnOrder=0,remoteOrder=-1;
 const supported=['zh','en','ja','es'];
 let language='zh';
 try{const saved=platform.localStorage?.getItem('babel-language');if(supported.includes(saved))language=saved;}catch{}
 $('language').value=language;
 const target=()=>supported.includes(connection.remoteLanguage)?connection.remoteLanguage:language;
 const updateTarget=()=>{if(plugin.setTargetLanguage)plugin.setTargetLanguage(target());else plugin.targetLanguage=target();};
 $('language').onchange=()=>{if(active||connecting)return;$('language').value=language=supported.includes($('language').value)?$('language').value:'zh';try{platform.localStorage?.setItem('babel-language',language);}catch{}clearRemote();updateTarget();controls();};
 let config=null,active=false,connecting=false,destroyed=false,operation=0,latest=null,remote=null;
 let resetTimer=null;
 let localCaptionTimer=null,remoteCaptionTimer=null,expiredLocalTurn=null;
 let sourceMode=null,connection={status:'idle',role:null,roomId:null};
 const listeners=[];
 const on=(name,fn)=>{plugin.addEventListener(name,fn);listeners.push([name,fn]);};
 const emit=(name,detail)=>platform.dispatchEvent?.(new CustomEvent(name,{detail}));
 const cancelLocalCaption=()=>{if(localCaptionTimer!==null)platform.clearTimeout(localCaptionTimer);localCaptionTimer=null;};
 const cancelRemoteCaption=()=>{if(remoteCaptionTimer!==null)platform.clearTimeout(remoteCaptionTimer);remoteCaptionTimer=null;};
 const clearLocal=()=>{cancelLocalCaption();expiredLocalTurn=null;turns.reset();turnOrders.clear();latest=null;$('source').textContent='';$('meaning').textContent='';$('meta').textContent='';};
 const clearRemoteText=()=>{$('remote-source').textContent='';$('remote-meaning').textContent='';$('remote-meta').textContent='';};
 const clearRemote=()=>{cancelRemoteCaption();remoteTurns.reset();remoteOrder=-1;remote=null;clearRemoteText();};
 const readySource=()=>{const d=getDiagnostics?.()||{};return d.mode==='live';};
 function controls(){
  $('start').disabled=config?.enabled===false||active||connecting||!readySource();
  $('stop').disabled=!active&&!connecting;$('language').disabled=active||connecting;$('start').hidden=active||connecting;$('stop').hidden=!active&&!connecting;
  $('remote').hidden=connection.status!=='connected';
  const d=getDiagnostics?.()||{};
  $('captions').hidden=d.mode==='idle'||d.mode==='demo';
  if(active)$('caption-state').textContent=connecting?'正在连接麦克风…':($('source').textContent?'':'请说话 · '+languageNames[language]);
  $('captions').lang=language;$('remote').lang=language;
  $('local-label').textContent=connection.role?`${connection.role} · 我说的话`:'我说的话';
 }
 function cancelReset(){if(resetTimer!==null){platform.clearTimeout(resetTimer);resetTimer=null;}}
 function shareReset(token){
  const identity=`${connection.roomId}|${connection.role}`;let attempts=0;
  const attempt=()=>{
   resetTimer=null;
   if(destroyed||token!==operation||active||connection.status!=='connected'||identity!==`${connection.roomId}|${connection.role}`)return;
   if(sendMeaning({type:'reset'}))return;
   if(++attempts>=8){$('caption-state').textContent='麦克风已停止；暂未能清除对方的旧字幕。';return;}
   resetTimer=platform.setTimeout(attempt,250);
  };
  attempt();
 }
 function currentSource(){
  if(!active||destroyed)return false;
  const d=getDiagnostics?.()||{};
  if(d.mode!==sourceMode){stopped('麦克风已停止。');return false;}
  return true;
 }
 function stopped(message='麦克风已停止。',{notify=true,clearPeer=false}={}){
  const wasActive=active||connecting;operation++;cancelReset();active=false;connecting=false;sourceMode=null;
  plugin.stop();clearLocal();if(clearPeer)clearRemote();
  if(wasActive&&notify&&connection.status==='connected')shareReset(operation);
  if(wasActive)emit('between-us:meaning-reset',{reason:'session-stopped'});
  if(message)$('caption-state').textContent=message;controls();
 }
 async function start(){
  if(destroyed||config?.enabled===false||active||connecting)return;
  if(!readySource()){$('caption-state').textContent='请先进入画面。';return;}
  cancelReset();const token=++operation,d=getDiagnostics();clearLocal();active=true;connecting=true;sourceMode=d.mode;
  plugin.language=language;updateTarget();plugin.accessCode='';
  $('caption-state').textContent='正在连接语音服务…';controls();
  try{
   // Call directly within the user gesture so AudioContext can resume immediately.
   await plugin.start();
   if(token!==operation||destroyed||!active)return;
   connecting=false;$('caption-state').textContent='正在聆听 · 字幕与译文会随原话修正';controls();
  }catch(error){if(token===operation&&!destroyed)stopped(error.name==='NotAllowedError'?'麦克风未获授权 · 允许权限后点「开启麦克风」重试':error.message||'语音服务无法启动。');}
 }
 $('start').onclick=start;$('stop').onclick=()=>stopped();
 on('transcript',({detail})=>{
  if(!currentSource())return;
  if(!turnOrders.has(detail.utteranceId)){turnOrders.set(detail.utteranceId,++nextTurnOrder);if(turnOrders.size>128)turnOrders.delete(turnOrders.keys().next().value);}
  const state=turns.observe(detail.utteranceId);if(!state.current)return;
  if(expiredLocalTurn===detail.utteranceId)return;
  cancelLocalCaption();
  if(state.changed){latest=null;$('meaning').textContent='';$('meta').textContent='';}
  $('source').textContent=detail.text;controls();$('source').scrollTop=$('source').scrollHeight;
  if(detail.final){
   const token=operation;
   const timer=platform.setTimeout(()=>{
    if(localCaptionTimer!==timer)return;
    localCaptionTimer=null;
    if(destroyed||token!==operation||!turns.isCurrent(detail.utteranceId))return;
    expiredLocalTurn=detail.utteranceId;$('source').textContent='';controls();
   },CAPTION_FINAL_HOLD_MS);
   localCaptionTimer=timer;
  }
 });
 on('meaning:reset',({detail})=>{
  if(!currentSource()||!turns.isCurrent(detail.utteranceId))return;
  cancelLocalCaption();latest=null;$('source').textContent='';$('meaning').textContent='';$('meta').textContent='';emit('between-us:meaning-reset',detail);
 });
 for(const name of ['meaning:update','meaning:final'])on(name,({detail})=>{
  if(!currentSource())return;
  const value={...detail,speakerId:connection.role||'local-microphone'};
  if(connection.status==='connected'&&supported.includes(connection.remoteLanguage)&&detail.targetLanguage===connection.remoteLanguage){
   const turnOrder=turnOrders.get(detail.utteranceId);
   if(turnOrder!==undefined&&!sendMeaning({...detail,turnOrder})&&detail.stage==='final')$('caption-state').textContent='本句已识别；向对方发送失败，请检查联机状态。';
  }
  if(!turns.isCurrent(detail.utteranceId))return;
  latest=value;$('meaning').textContent=(detail.stage==='final'?'':'[暂定] ')+detail.meaning;
  $('meta').textContent=`${languageNames[detail.language]||'未确定语言'} · ${intents[detail.intent]||'表达'}${detail.uncertain?' · 含义有歧义':''}`;
  emit('between-us:meaning',value);
 });
 on('error',({detail})=>{
  if(destroyed||!active)return;
  const message=detail.code==='NotAllowedError'?'麦克风未获授权 · 允许权限后点「开启麦克风」重试':detail.code==='NotFoundError'?'未找到麦克风 · 连接设备后重试':detail.message;
  if(detail.fatal)stopped(message||'语音连接已结束。');else $('caption-state').textContent=message||'本句暂时无法理解。';
 });
 on('status',({detail})=>{if(!destroyed&&detail.state==='stopped'&&(active||connecting))stopped();});
 function receiveMeaning(data){
  if(destroyed||connection.status!=='connected'||!['A','B'].includes(data?.speakerId)||data.speakerId===connection.role)return;
  if(data.type==='reset'){clearRemote();return;}
  if(!['partial','final'].includes(data.stage)||typeof data.text!=='string'||typeof data.translation!=='string'||data.targetLanguage!==language)return;
  if(data.turnOrder!==undefined){if(data.turnOrder<remoteOrder)return;remoteOrder=data.turnOrder;}
  if(!remoteTurns.observe(data.utteranceId).current)return;
  if(remote?.utteranceId===data.utteranceId&&(data.revision<remote.revision||(data.revision===remote.revision&&(remote.stage==='final'||data.stage!=='final'))))return;
  cancelRemoteCaption();
  remote=data;$('remote-source').textContent=data.text;$('remote-meaning').textContent=data.translation;
  $('remote-meaning').scrollTop=$('remote-meaning').scrollHeight;$('remote-source').scrollTop=$('remote-source').scrollHeight;
  $('remote-meta').textContent=`${data.speakerId} · ${languageNames[data.language]||'未确定语言'} → ${languageNames[language]}${data.stage==='partial'?' · 暂定':' · 完整句'}`;
  emit('between-us:remote-meaning',data);
  if(data.stage==='final'){
   const timer=platform.setTimeout(()=>{
    if(remoteCaptionTimer!==timer)return;
    remoteCaptionTimer=null;
    if(!destroyed&&remote===data)clearRemoteText();
   },CAPTION_FINAL_HOLD_MS);
   remoteCaptionTimer=timer;
  }
 }
 function setConnection(next){
  if(destroyed)return;
  const before=[connection.status==='connected',connection.roomId,connection.role].join('|');
  const after=[next.status==='connected',next.roomId,next.role].join('|');
  if(before!==after){cancelReset();clearLocal();clearRemote();}
  connection={status:next.status,roomId:next.roomId||null,role:next.role||null,remoteLanguage:next.remoteLanguage};updateTarget();controls();
 }
 const timer=platform.setInterval(()=>{
  if(destroyed)return;
  if(active)currentSource();
  controls();
 },250);
 const abort=new AbortController();
 platform.fetch('/api/semantic-config',{cache:'no-store',signal:abort.signal}).then(async response=>{
  if(!response.ok)throw new Error('配置不可用');const value=await response.json();if(destroyed)return;
  config=value;
  $('caption-state').textContent=!config.speechConfigured||!config.semanticConfigured?'语音服务尚未配置。':'进入画面后即可说话。';controls();
 }).catch(()=>{if(!destroyed){$('caption-state').textContent='语音服务暂时不可用，摄像头与艺术画面可正常使用。';controls();}});
 controls();
 return {
  get language(){return language;},start,receiveMeaning,setConnection,stop:stopped,checkSource(){if(active)currentSource();controls();},
  get diagnostics(){return {active,connecting,configured:Boolean(config?.enabled),language:plugin.language,latest,remote};},
  destroy(){if(destroyed)return;stopped('',{clearPeer:true});destroyed=true;operation++;cancelReset();abort.abort();platform.clearInterval(timer);for(const [name,fn] of listeners)plugin.removeEventListener(name,fn);plugin.destroy();plugin.accessCode='';$('start').onclick=null;$('stop').onclick=null;$('language').onchange=null;}
 };
}
