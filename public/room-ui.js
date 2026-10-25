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
const statusNames={idle:'Not connected',connecting:'Connecting to the room…',waiting:'Room ready · waiting for your partner',joining:'Connecting to your partner…',connected:'Connected · two participants',disconnected:'Partner disconnected · you can reconnect',error:'Connection failed'};

/** Room controls are opt-in; constructing this object never opens media or a network connection. */
export function mountRoomUI({canvas,getMode,prepareSource,getSnapshot,onConnectionState=()=>{},onSession=()=>{},onMeaning=()=>{}}){
 const $=id=>document.getElementById(id);
 let connection=null,capture=null,snapshotTimer=null,metricTimer=null,attempt=0,busy=false,remoteData=null,remoteReady=false;
 let state={status:'idle',role:null,roomId:null},lastAction=null,config=null,layoutRole=null;
 function setLayout(role){
  layoutRole=role||null;
  if(role)document.body.dataset.roomRole=role;else delete document.body.dataset.roomRole;
  $('remote-pane').hidden=!role;$('participant-local').hidden=!role;
  $('participant-local').textContent=role?`${role} · You${getMode()==='demo'?' · Simulated':''}`:'';
  $('participant-remote').textContent=role?`${role==='A'?'B':'A'} · Partner`:'';
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
  const text=state.error?(/[\u3400-\u9fff]/.test(state.error)?'Connection interrupted. Try again or check Connection help.':state.error):(statusNames[state.status]||state.status);
  $('room-status').textContent=text;$('room-panel').dataset.status=state.status;
  $('room-badge').textContent=layoutRole?'Connection ↗':'';
  $('room-badge').hidden=!layoutRole;
  $('room-create').disabled=busy||active;
  $('room-join').disabled=busy||active;
  $('room-input').disabled=busy||active;
  $('room-source').disabled=busy||getMode()!=='idle';
  $('room-source-row').hidden=getMode()!=='idle';
  $('room-leave').hidden=!(busy||layoutRole||active);
  $('room-retry').hidden=busy||!lastAction||!['error','disconnected'].includes(state.status);
  $('room-invite-section').hidden=!state.roomId||state.role!=='A';
  $('room-copy').disabled=!state.roomId||busy;
  if(state.roomId&&state.role==='A'){
   const url=new URL(location.href);url.hash=new URLSearchParams({room:state.roomId}).toString();
   $('room-invite').value=url.href;
  }
  $('remote-placeholder').textContent=state.status==='waiting'?'Waiting for your partner':state.status==='connected'&&!remoteReady?'Waiting for partner video…':text;
  const remote=remoteData?.mode==='demo'?' · Simulated':'';
  if(layoutRole)$('participant-remote').textContent=`${layoutRole==='A'?'B':'A'} · Partner${remote}`;
  $('room-network-note').textContent=config?.turnConfigured
   ?'Network relay is available. If connection fails, try reconnecting.'
   :'This connection uses a direct network route. Some campus or company networks may block it; try a personal hotspot if needed.';
  onConnectionState({...state,remoteLanguage:remoteData?.language});
 }
 function updateMetrics(){
  const d=connection?.diagnostics||state;
  $('room-metrics').textContent=`联机 ${statusNames[state.status]||state.status}\n画面 ${remoteReady?'已接收':'未接收'} · 互动数据 ${remoteData?'已接收':'等待'}${Number.isFinite(d.rttMs)?` · 往返 ${Math.round(d.rttMs)} ms`:''}\n发送 ${capture?`${capture.diagnostics.width} × ${capture.diagnostics.height} / ${capture.diagnostics.fps} FPS`:'未开启'}`;
 }
 function open(){
  $('room-panel').hidden=false;
  $('room-source-row').hidden=getMode()!=='idle';
  render();$('room-close').focus();
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
  if(!response.ok)throw new Error('Could not load connection settings. Refresh and try again.');
  const result=await response.json();
  if(!Array.isArray(result.iceServers))throw new Error('Connection settings are invalid.');
  return result;
 }
 async function begin(action){
  if(busy)return;
  const roomId=action==='join'?parseRoomInvitation($('room-input').value):null;
  if(action==='join'&&!roomId){state={...state,status:'error',error:'Paste a complete invite link or room ID.'};render();return;}
  leave();const token=++attempt;busy=true;lastAction=action;
  state={status:'connecting',role:action==='host'?'A':'B',roomId};render();
  try{
   if(typeof globalThis.Peer!=='function')throw new Error('Connection component did not load. Refresh this page.');
   config=await loadConfig();if(token!==attempt)return;
   const ready=await prepareSource(getMode()==='idle'?$('room-source').value:getMode());
   if(token!==attempt)return;
   if(!ready)throw new Error('Your camera is not ready. Close this panel, check camera permissions, and try again.');
   setLayout(state.role);
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   if(token!==attempt)return;
   capture=createArtworkCapture(canvas,{onError:message=>{
    if(token!==attempt)return;
    leave();state={status:'error',role:null,roomId:null,error:message};render();
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
   leave();state={...failed,status:'error',error:error.message||'Could not connect. Please try again.'};busy=false;render();
  }
 }
 $('room-open-intro').onclick=open;$('room-badge').onclick=open;
 function closePanel(){$('room-panel').hidden=true;const target=getMode()==='idle'?$('room-open-intro'):$('exit');target?.focus();}
 $('room-close').onclick=closePanel;
 $('room-help').onclick=()=>{const note=$('room-network-note');note.hidden=!note.hidden;$('room-help').setAttribute('aria-expanded',String(!note.hidden));};
 const panelKey=event=>{if($('room-panel').hidden)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closePanel();}else if(event.key==='Tab'){const nodes=[...$('room-panel').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter(node=>!node.closest('[hidden]'));const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
 document.addEventListener('keydown',panelKey,true);
 $('room-create').onclick=()=>begin('host');$('room-join').onclick=()=>begin('join');
 $('room-leave').onclick=leave;$('room-retry').onclick=()=>begin(lastAction);
 $('room-copy').onclick=async()=>{
  try{await navigator.clipboard.writeText($('room-invite').value);$('room-copy').textContent='Copied';setTimeout(()=>$('room-copy').textContent='Copy link ↗',1800);}
  catch{$('room-invite').focus();$('room-invite').select();$('room-status').textContent='Copy the selected invite link.';}
 };
 $('remote-video').onplaying=()=>{if(!$('remote-video').srcObject)return;remoteReady=true;$('remote-placeholder').hidden=true;$('remote-resume').hidden=true;updateMetrics();};
 $('remote-video').onwaiting=()=>{if(!remoteReady)$('remote-placeholder').hidden=false;};
 $('remote-resume').onclick=()=>$('remote-video').play().catch(()=>{$('room-status').textContent='Partner video could not play. Please rejoin.';});
 $('room-input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void begin('join');}};
 function readInvitation(){
  if(busy||!['idle','error','disconnected'].includes(state.status))return;
  const invitation=new URLSearchParams(location.hash.slice(1)).get('room');
  if(roomPattern.test(invitation||'')){$('room-input').value=invitation;open();}
 }
 window.addEventListener('hashchange',readInvitation);readInvitation();
 metricTimer=setInterval(updateMetrics,1000);
 render();updateMetrics();
 return {leave,open,sendSession:message=>connection?.sendSession(message)||false,sendMeaning:message=>connection?.sendMeaning(message)||false,closePanel,get panelOpen(){return !$('room-panel').hidden;},
  destroy(){leave();document.removeEventListener('keydown',panelKey,true);clearInterval(metricTimer);window.removeEventListener('hashchange',readInvitation);},
  get diagnostics(){return {...(connection?.diagnostics||state),capture:capture?.diagnostics||null,remoteReady,remoteState:remoteData,layoutRole};}
 };
}
