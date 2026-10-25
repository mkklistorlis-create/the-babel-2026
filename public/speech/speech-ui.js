import {createSemanticPlugin} from './semantic-plugin.js';
import {TurnView} from './ui-state.js';

const languageNames={auto:'自动',zh:'中文',en:'English',ja:'日本語',es:'Español',mixed:'混合语言',und:'未确定语言'};
const intents={statement:'陈述',question:'提问',request:'请求',evaluate:'评价',agree:'赞同',disagree:'分歧',greeting:'问候',other:'其他'};

/** Optional speech UI. Camera/artwork start never starts this microphone. */
export function mountSpeechUI({getDiagnostics,sendMeaning=()=>false,plugin=createSemanticPlugin(),platform=globalThis}={}){
 const $=id=>platform.document.getElementById('speech-'+id);
 const turns=new TurnView();
 let config=null,active=false,connecting=false,destroyed=false,operation=0,latest=null,remote=null;
 let resetTimer=null;
 let owner=null,sourceMode=null,connection={status:'idle',role:null,roomId:null};
 const listeners=[];
 const on=(name,fn)=>{plugin.addEventListener(name,fn);listeners.push([name,fn]);};
 const emit=(name,detail)=>platform.dispatchEvent?.(new CustomEvent(name,{detail}));
 const clearLocal=()=>{turns.reset();latest=null;$('source').textContent='';$('meaning').textContent='';$('meta').textContent='';};
 const clearRemote=()=>{remote=null;$('remote-source').textContent='';$('remote-meaning').textContent='';$('remote-meta').textContent='';};
 const readySource=()=>{const d=getDiagnostics?.()||{};return d.mode==='live'&&d.occupancy==='single';};
 function controls(){
  $('start').disabled=!config?.enabled||active||connecting||!readySource();
  $('stop').disabled=!active&&!connecting;$('language').disabled=active||connecting;$('code').disabled=active||connecting;
  $('remote').hidden=connection.status!=='connected';
  $('local-label').textContent=connection.role?`${connection.role} · 我说的话`:'我说的话';
 }
 function cancelReset(){if(resetTimer!==null){platform.clearTimeout(resetTimer);resetTimer=null;}}
 function shareReset(token){
  const identity=`${connection.roomId}|${connection.role}`;let attempts=0;
  const attempt=()=>{
   resetTimer=null;
   if(destroyed||token!==operation||active||connection.status!=='connected'||identity!==`${connection.roomId}|${connection.role}`)return;
   if(sendMeaning({type:'reset'}))return;
   if(++attempts>=8){$('status').textContent='麦克风已停止；暂未能清除对方的旧字幕。';return;}
   resetTimer=platform.setTimeout(attempt,250);
  };
  attempt();
 }
 function currentSource(){
  if(!active||destroyed)return false;
  const d=getDiagnostics?.()||{};
  if(d.occupancy==='multiple'||d.ownershipEpoch!==owner||d.mode!==sourceMode){stopped('本机画面参与者已变化，请重新开启语音。');return false;}
  return true;
 }
 function stopped(message='麦克风已停止。',{notify=true,clearPeer=false}={}){
  const wasActive=active||connecting;operation++;cancelReset();active=false;connecting=false;owner=null;sourceMode=null;
  plugin.stop();clearLocal();if(clearPeer)clearRemote();
  if(wasActive&&notify&&connection.status==='connected')shareReset(operation);
  if(wasActive)emit('between-us:meaning-reset',{reason:'session-stopped'});
  if(message)$('status').textContent=message;controls();
 }
 async function start(){
  if(destroyed||!config?.enabled||active||connecting)return;
  if(!readySource()){$('status').textContent='请先开启摄像头，并保持镜头内只有一人。';return;}
  if(config.accessRequired&&!$('code').value.trim()){$('status').textContent='请填写演示者提供的语音访问码。';$('code').focus();return;}
  cancelReset();const token=++operation,d=getDiagnostics();clearLocal();active=true;connecting=true;owner=d.ownershipEpoch;sourceMode=d.mode;
  plugin.language=$('language').value;plugin.accessCode=$('code').value;
  $('status').textContent='正在连接语音服务…';controls();
  try{
   // Call directly within the user gesture so AudioContext can resume immediately.
   await plugin.start();
   if(token!==operation||destroyed||!active)return;
   connecting=false;$('status').textContent='正在聆听 · 暂定含义会随原话修正';controls();
  }catch(error){if(token===operation&&!destroyed)stopped(error.message||'语音服务无法启动。');}
 }
 $('start').onclick=start;$('stop').onclick=()=>stopped();
 $('panel').onkeydown=event=>{
  // Native buttons/summary need Space and Enter; keep artwork shortcuts outside this panel.
  if(event.key==='Escape'){event.preventDefault();$('panel').open=false;}
  event.stopPropagation();
 };
 on('transcript',({detail})=>{
  if(!currentSource())return;
  const state=turns.observe(detail.utteranceId);if(!state.current)return;
  if(state.changed){latest=null;$('meaning').textContent='';$('meta').textContent='';}
  $('source').textContent=detail.text;
 });
 on('meaning:reset',({detail})=>{
  if(!currentSource()||!turns.isCurrent(detail.utteranceId))return;
  latest=null;$('source').textContent='';$('meaning').textContent='';$('meta').textContent='';emit('between-us:meaning-reset',detail);
 });
 for(const name of ['meaning:update','meaning:final'])on(name,({detail})=>{
  if(!currentSource())return;
  const value={...detail,speakerId:connection.role||'local-microphone'};
  if(detail.stage==='final'&&connection.status==='connected'){
   if(!sendMeaning(detail))$('status').textContent='本句已识别；向对方发送失败，请检查联机状态。';
  }
  if(!turns.isCurrent(detail.utteranceId))return;
  latest=value;$('meaning').textContent=(detail.stage==='final'?'':'[暂定] ')+detail.meaning;
  $('meta').textContent=`${languageNames[detail.language]||'未确定语言'} · ${intents[detail.intent]||'表达'}${detail.uncertain?' · 含义有歧义':''}`;
  emit('between-us:meaning',value);
 });
 on('error',({detail})=>{
  if(destroyed||!active)return;
  if(detail.fatal)stopped(detail.message||'语音连接已结束。');else $('status').textContent=detail.message||'本句暂时无法理解。';
 });
 on('status',({detail})=>{if(!destroyed&&detail.state==='stopped'&&(active||connecting))stopped();});
 function receiveMeaning(data){
  if(destroyed||connection.status!=='connected'||!['A','B'].includes(data?.speakerId)||data.speakerId===connection.role)return;
  if(data.type==='reset'){clearRemote();return;}
  if(data.stage!=='final'||typeof data.text!=='string'||typeof data.meaning!=='string')return;
  remote=data;$('remote-source').textContent=data.text;$('remote-meaning').textContent=data.meaning;
  $('remote-meta').textContent=`${data.speakerId} · ${languageNames[data.language]||'未确定语言'}${data.uncertain?' · 含义有歧义':''}`;
  emit('between-us:remote-meaning',data);
 }
 function setConnection(next){
  if(destroyed)return;
  const before=[connection.status==='connected',connection.roomId,connection.role].join('|');
  const after=[next.status==='connected',next.roomId,next.role].join('|');
  if(before!==after){stopped('房间状态已变化，请重新开启语音。');clearRemote();}
  connection={status:next.status,roomId:next.roomId||null,role:next.role||null};controls();
 }
 const timer=platform.setInterval(()=>{
  if(destroyed)return;
  if(active)currentSource();
  controls();
 },250);
 const abort=new AbortController();
 platform.fetch('/api/semantic-config',{cache:'no-store',signal:abort.signal}).then(async response=>{
  if(!response.ok)throw new Error('配置不可用');const value=await response.json();if(destroyed)return;
  config=value;$('code-row').hidden=!config.accessRequired;
  $('status').textContent=!config.speechConfigured||!config.semanticConfigured?'语音服务尚未配置，摄像头与艺术画面可正常使用。':config.accessRequired&&!config.accessConfigured?'站点尚未配置语音访问码，请联系演示者。':'语音已就绪。进入单人摄像头画面后，可手动开启。';controls();
 }).catch(()=>{if(!destroyed){$('status').textContent='语音服务暂时不可用，摄像头与艺术画面可正常使用。';controls();}});
 controls();
 return {
  receiveMeaning,setConnection,stop:stopped,checkSource(){if(active)currentSource();controls();},
  get diagnostics(){return {active,connecting,configured:Boolean(config?.enabled),language:plugin.language,latest,remote};},
  destroy(){if(destroyed)return;stopped('',{clearPeer:true});destroyed=true;operation++;cancelReset();abort.abort();platform.clearInterval(timer);for(const [name,fn] of listeners)plugin.removeEventListener(name,fn);plugin.destroy();plugin.accessCode='';$('code').value='';$('start').onclick=null;$('stop').onclick=null;$('panel').onkeydown=null;}
 };
}
