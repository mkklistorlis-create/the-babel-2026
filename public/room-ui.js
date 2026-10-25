import {RoomConnection} from './room-connection.js';
import {createArtworkCapture} from './room-capture.js';

const roomPattern=/^babel-[a-f0-9]{32}$/;
export function parseRoomInvitation(value){
 const text=String(value||'').trim();
 if(roomPattern.test(text))return text;
 try{
  const url=new URL(text);
  if(!['http:','https:'].includes(url.protocol))return null;
  const room=new URLSearchParams(url.hash.slice(1)).get('room');
  return roomPattern.test(room||'')?room:null;
 }catch{return null;}
}
const statusNames={idle:'尚未连接',connecting:'正在连接房间服务…',waiting:'房间已创建，等待另一位加入',joining:'正在连接对方画面…',connected:'双人画面已连接',disconnected:'对方已断开，可以重新加入',error:'连接未成功'};

/** Room controls are opt-in; constructing this object never opens media or a network connection. */
export function mountRoomUI({canvas,getMode,prepareSource,getSnapshot,onConnectionState=()=>{},onSession=()=>{},onMeaning=()=>{}}){
 const $=id=>document.getElementById(id);
 let connection=null,capture=null,snapshotTimer=null,metricTimer=null,attempt=0,busy=false,remoteData=null,remoteReady=false;
 let state={status:'idle',role:null,roomId:null},lastAction=null,config=null,layoutRole=null;
 function setLayout(role){
  layoutRole=role||null;
  if(role)document.body.dataset.roomRole=role;else delete document.body.dataset.roomRole;
  $('remote-pane').hidden=!role;$('participant-local').hidden=!role;
  $('participant-local').textContent=role?`${role} · 你${getMode()==='demo'?' · 模拟画面':''}`:'';
  $('participant-remote').textContent=role?`${role==='A'?'B':'A'} · 对方`:'';
 }
 function clearRemote(){
  remoteReady=false;remoteData=null;
  $('remote-video').pause();$('remote-video').srcObject=null;
  $('remote-video').hidden=true;$('remote-placeholder').hidden=false;
  $('remote-resume').hidden=true;
 }
 function releaseCapture(){
  clearInterval(snapshotTimer);snapshotTimer=null;
  capture?.stop();capture=null;
 }
 function render(){
  const active=Boolean(state.roomId)&&!['idle','error','disconnected'].includes(state.status);
  const text=state.error||statusNames[state.status]||state.status;
  $('room-status').textContent=text;
  $('room-badge').textContent=layoutRole?`${layoutRole} · ${text}`:'';
  $('room-badge').hidden=!layoutRole;
  $('room-create').disabled=busy||active;
  $('room-join').disabled=busy||active;
  $('room-input').disabled=busy||active;
  $('room-source').disabled=busy||getMode()!=='idle';
  $('room-leave').hidden=!(busy||layoutRole||active);
  $('room-retry').hidden=busy||!lastAction||!['error','disconnected'].includes(state.status);
  $('room-invite-section').hidden=!state.roomId||state.role!=='A';
  $('room-copy').disabled=!state.roomId||busy;
  if(state.roomId&&state.role==='A'){
   const url=new URL(location.href);url.hash=new URLSearchParams({room:state.roomId}).toString();
   $('room-invite').value=url.href;
  }
  $('remote-placeholder').textContent=state.status==='waiting'?'等待另一位加入':state.status==='connected'&&!remoteReady?'等待对方画面…':text;
  const remote=remoteData?.mode==='demo'?' · 模拟画面':'';
  if(layoutRole)$('participant-remote').textContent=`${layoutRole==='A'?'B':'A'} · 对方${remote}`;
  $('room-network-note').textContent=config?.turnConfigured
   ?'已配置网络中转；连接状态可在测试面板查看。'
   :'当前测试使用直连；部分校园或公司网络可能需要 TURN 中转。连接失败时可换个人热点再试。';
  onConnectionState({...state,remoteLanguage:remoteData?.language});
 }
 function updateMetrics(){
  const d=connection?.diagnostics||state;
  $('room-metrics').textContent=`联机 ${statusNames[state.status]||state.status}\n画面 ${remoteReady?'已接收':'未接收'} · 互动数据 ${remoteData?'已接收':'等待'}${Number.isFinite(d.rttMs)?` · 往返 ${Math.round(d.rttMs)} ms`:''}\n发送 ${capture?`${capture.diagnostics.width} × ${capture.diagnostics.height} / ${capture.diagnostics.fps} FPS`:'未开启'}`;
 }
 function open(){
  $('room-panel').hidden=false;
  $('room-source-row').hidden=getMode()!=='idle';
  render();$('room-input').focus();
 }
 function leave(){
  attempt++;busy=false;
  const old=connection,oldRole=state.role;connection=null;
  old?.leave();releaseCapture();clearRemote();
  if(['A','B'].includes(oldRole))onMeaning({type:'reset',speakerId:oldRole==='A'?'B':'A'});
  state={status:'idle',role:null,roomId:null};setLayout(null);render();updateMetrics();
 }
 async function loadConfig(){
  const response=await fetch('/api/rtc-config',{cache:'no-store'});
  if(!response.ok)throw new Error('联机配置加载失败，请刷新后重试');
  const result=await response.json();
  if(!Array.isArray(result.iceServers))throw new Error('联机配置无效');
  return result;
 }
 async function begin(action){
  if(busy)return;
  const roomId=action==='join'?parseRoomInvitation($('room-input').value):null;
  if(action==='join'&&!roomId){state={...state,status:'error',error:'请粘贴完整邀请链接或房间 ID'};render();return;}
  leave();const token=++attempt;busy=true;lastAction=action;
  state={status:'connecting',role:action==='host'?'A':'B',roomId};render();
  try{
   if(typeof globalThis.Peer!=='function')throw new Error('联机组件未加载，请刷新网页');
   config=await loadConfig();if(token!==attempt)return;
   const ready=await prepareSource(getMode()==='idle'?$('room-source').value:getMode());
   if(token!==attempt)return;
   if(!ready)throw new Error('摄像头尚未准备好。可以返回检查授权，或选择模拟画面测试连接');
   setLayout(state.role);
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   if(token!==attempt)return;
   capture=createArtworkCapture(canvas,{onError:message=>{
    if(token!==attempt)return;
    leave();state={status:'error',role:null,roomId:null,error:message};render();open();
   }});
   const client=new RoomConnection({config:{iceServers:config.iceServers},
    onState:next=>{
     if(token!==attempt)return;
     state=next;
     if(next.status==='error'||next.status==='disconnected'){
      releaseCapture();clearRemote();setLayout(null);busy=false;
     }else if(next.role)setLayout(next.role);
     if(next.status==='connected')$('room-panel').hidden=true;
     render();updateMetrics();
    },
    onStream:stream=>{
     if(token!==attempt)return;
     clearRemote();if(!stream)return;
     const video=$('remote-video');video.srcObject=stream;video.hidden=false;
     video.play().catch(()=>{$('remote-resume').hidden=false;});
    },
    onData:data=>{if(token!==attempt)return;remoteData=data;render();},
    onSession:message=>{if(token===attempt)onSession(message);},
    onMeaning:message=>{if(token===attempt)onMeaning(message);}
   });
   connection=client;
   snapshotTimer=setInterval(()=>{if(token===attempt)client.sendState(getSnapshot());},100);
   if(action==='host')await client.host(capture.stream);else await client.join(roomId,capture.stream);
   if(token!==attempt)return;
   busy=false;render();
  }catch(error){
   if(token!==attempt)return;
   const failed=state;
   leave();state={...failed,status:'error',error:error.message||'无法建立连接'};busy=false;render();open();
  }
 }
 $('room-open-intro').onclick=open;$('room-badge').onclick=open;
 $('room-close').onclick=()=>$('room-panel').hidden=true;
 $('room-create').onclick=()=>begin('host');$('room-join').onclick=()=>begin('join');
 $('room-leave').onclick=leave;$('room-retry').onclick=()=>begin(lastAction);
 $('room-copy').onclick=async()=>{
  try{await navigator.clipboard.writeText($('room-invite').value);$('room-copy').textContent='已复制';setTimeout(()=>$('room-copy').textContent='复制邀请链接',1800);}
  catch{$('room-invite').focus();$('room-invite').select();$('room-status').textContent='请复制选中的邀请链接';}
 };
 $('remote-video').onplaying=()=>{if(!$('remote-video').srcObject)return;remoteReady=true;$('remote-placeholder').hidden=true;$('remote-resume').hidden=true;updateMetrics();};
 $('remote-video').onwaiting=()=>{if(!remoteReady)$('remote-placeholder').hidden=false;};
 $('remote-resume').onclick=()=>$('remote-video').play().catch(()=>{$('room-status').textContent='对方画面暂时无法播放，请重新加入';open();});
 $('room-input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void begin('join');}};
 function readInvitation(){
  if(busy||!['idle','error','disconnected'].includes(state.status))return;
  const invitation=new URLSearchParams(location.hash.slice(1)).get('room');
  if(roomPattern.test(invitation||'')){$('room-input').value=invitation;open();}
 }
 window.addEventListener('hashchange',readInvitation);readInvitation();
 metricTimer=setInterval(updateMetrics,1000);
 render();updateMetrics();
 return {leave,open,sendSession:message=>connection?.sendSession(message)||false,sendMeaning:message=>connection?.sendMeaning(message)||false,closePanel(){$('room-panel').hidden=true;},get panelOpen(){return !$('room-panel').hidden;},
  destroy(){leave();clearInterval(metricTimer);window.removeEventListener('hashchange',readInvitation);},
  get diagnostics(){return {...(connection?.diagnostics||state),capture:capture?.diagnostics||null,remoteReady,remoteState:remoteData,layoutRole};}
 };
}
