import {ROOM_ID,ROOM_PROTOCOL,randomRoomId,normalizeSnapshot,readMessage} from './room-protocol.js';
import {normalizeSessionMessage} from './session-protocol.js';
import {normalizeMeaningMessage,meaningMessageFits} from './meaning-protocol.js';

const noop=()=>{};
const problem=(code,message)=>Object.assign(new Error(message),{code});
const close=connection=>{try{connection?.close();}catch{}};
const errors={
 'peer-unavailable':'找不到这个房间。请确认房主仍在页面中。',
 'unavailable-id':'房间编号暂时不可用，请重新创建房间。',
 'browser-incompatible':'浏览器不支持当前的实时连接，请使用新版 Chrome。',
 'network':'连接服务暂时不可用，请重试。',
 'server-error':'房间连接服务暂时不可用，请重试。',
 'socket-error':'房间连接中断，请重试。',
 'socket-closed':'房间连接中断，请重试。',
 'webrtc':'画面连接失败。当前网络可能需要 TURN 中转。',
};

/**
 * A single local source, one remote participant. All vision stays local.
 * Source streams belong to the caller: leave() never stops their tracks.
 * PeerServer Cloud only brokers connections; TURN must be configured separately.
 */
export class RoomConnection{
 constructor({PeerClass=globalThis.Peer,onState=noop,onStream=noop,onData=noop,onSession=noop,onMeaning=noop,config={}}={}){
  this.PeerClass=PeerClass;this.onState=onState;this.onStream=onStream;this.onData=onData;this.onSession=onSession;this.onMeaning=onMeaning;
  this.config={openTimeoutMs:15000,joinTimeoutMs:20000,admissionTimeoutMs:8000,heartbeatIntervalMs:2000,peerTimeoutMs:12000,stateStaleMs:1500,...config};
  this.now=config.now||(()=>performance.now());this.epoch=0;this.timers=new Set();this.pending=new Map();
  this.state={status:'idle',role:null,roomId:null,remotePresent:false,mediaConnected:false,signalingConnected:false,error:null,errorCode:null};
  this.sequence=0;this.remoteSequence=-1;this.remoteState=null;this.remoteAt=0;this.lastSent=-Infinity;this.lastHeard=0;this.rttMs=null;
  this.peer=null;this.connection=null;this.media=null;this.stream=null;this.accepted=false;this.remoteStream=null;this.operation=null;
  this._resetMeaningTransport();
 }
 get diagnostics(){return {...this.state,remoteState:this.remoteState,rttMs:this.rttMs,sentSequence:this.sequence,receivedSequence:this.remoteSequence,sentMeaningSequence:this.meaningSequence,receivedMeaningSequence:this.remoteMeaningSequence,turnConfigured:Boolean(this.config.iceServers?.some(s=>[].concat(s.urls||[]).some(u=>/^turns?:/.test(u))))};}
 _resetMeaningTransport(){
  this.meaningSequence=0;this.remoteMeaningSequence=-1;this.meaningSentAt=[];this.meaningReceivedAt=[];
  this.sentMeaningRevisions=new Map();this.remoteMeaningRevisions=new Map();
 }
 _meaningRateAvailable(direction,now){
  const key=direction==='send'?'meaningSentAt':'meaningReceivedAt';
  this[key]=this[key].filter(at=>now-at<1000&&now>=at);
  return this[key].length<10;
 }
 _staleMeaning(map,body){
  if(body.type!=='meaning')return false;
  const old=map.get(body.utteranceId);
  return Boolean(old&&((old.final&&body.stage!=='final')||body.revision<old.revision||(body.revision===old.revision&&(old.final||body.stage!=='final'))));
 }
 _rememberMeaning(map,body){
  if(body.type!=='meaning')return;
  map.delete(body.utteranceId);map.set(body.utteranceId,{revision:body.revision,final:body.stage==='final'});
  if(map.size>128)map.delete(map.keys().next().value);
 }
 _emit(values={}){Object.assign(this.state,values);this.onState(this.diagnostics);}
 _later(callback,delay){const id=setTimeout(()=>{this.timers.delete(id);callback();},delay);id.unref?.();this.timers.add(id);return id;}
 _cancel(id){if(id){clearTimeout(id);this.timers.delete(id);}}
 _operation(){return new Promise((resolve,reject)=>{this.operation={resolve,reject};});}
 _resolve(value){const operation=this.operation;this.operation=null;operation?.resolve(value);}
 _reject(error){const operation=this.operation;this.operation=null;operation?.reject(error);}
 _options(){
  return {debug:0,secure:true,...this.config.peerOptions,config:{...this.config.peerOptions?.config,iceServers:this.config.iceServers||[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}]}};
 }
 _valid(epoch){return epoch===this.epoch&&!!this.peer;}
 _write(connection,message){
  if(!connection?.open)return false;
  try{connection.send({v:ROOM_PROTOCOL,...message});return true;}catch{return false;}
 }
 _begin(role,roomId,stream){
  this.leave();
  if(!this.PeerClass)throw problem('unsupported','联机模块未加载，请刷新页面。');
  if(!stream?.getVideoTracks?.().some(track=>track.readyState!=='ended'))throw problem('no-source','请先启动摄像头或演示画面。');
  this.stream=stream;this.sequence=0;this.lastSent=-Infinity;
  this._emit({status:role==='A'?'connecting':'joining',role,roomId,error:null,errorCode:null});
  const result=this._operation(),epoch=this.epoch;
  try{this.peer=new this.PeerClass(role==='A'?roomId:randomRoomId(),this._options());}
  catch(error){this._fatal(problem('peer-create',error.message));return result;}
  const peer=this.peer;
  this.openTimer=this._later(()=>{if(this._valid(epoch))this._fatal(problem('signal-timeout','连接房间服务超时，请检查网络后重试。'));},this.config.openTimeoutMs);
  peer.on('open',()=>{
   if(!this._valid(epoch))return;
   this._cancel(this.openTimer);this._cancel(this.reconnectTimer);this.reconnectTimer=null;this.reconnectAttempts=0;
   this._emit({signalingConnected:true});
   if(this.initialized)return;this.initialized=true;
   if(role==='A'){this._emit({status:'waiting'});this._resolve(roomId);}
   else{
    this.joinTimer=this._later(()=>{if(this._valid(epoch))this._fatal(problem('join-timeout','未能连接对方画面。请重试，或换一个网络；受限网络可能需要 TURN 中转。'));},this.config.joinTimeoutMs);
    try{this._bindConnection(peer.connect(roomId,{label:'babel-room-v1',serialization:'json',reliable:true,metadata:{v:1}}),false,epoch);}
    catch(error){this._fatal(problem('connect-failed',error.message));}
   }
   this._heartbeat(epoch);
  });
  peer.on('connection',connection=>{
   if(!this._valid(epoch)||role!=='A'){close(connection);return;}
   this._bindConnection(connection,true,epoch);
  });
  peer.on('call',call=>{
   if(!this._valid(epoch)||role!=='A'||!this.accepted||call.peer!==this.connection?.peer||this.media){close(call);return;}
   this._bindMedia(call,epoch);
   try{call.answer(this.stream);}catch(error){this._dropRemote(problem('webrtc',error.message));}
  });
  peer.on('disconnected',()=>{
   if(!this._valid(epoch))return;
   this._emit({signalingConnected:false});this._reconnectSignal(epoch);
  });
  peer.on('close',()=>{if(this._valid(epoch))this._fatal(problem('signal-closed','房间连接已关闭，请重新进入。'));});
  peer.on('error',error=>{
   if(!this._valid(epoch))return;
   const code=error.type||'connection-error',message=errors[code]||'联机连接失败，请重试。';
   if(this.state.mediaConnected&&['network','socket-error','socket-closed'].includes(code)){
    this._emit({signalingConnected:false,error:message,errorCode:code});this._reconnectSignal(epoch);
   }else this._fatal(problem(code,message));
  });
  return result;
 }
 async host(stream){return this._begin('A',randomRoomId(),stream);}
 async join(roomId,stream){
  if(typeof roomId!=='string'||!ROOM_ID.test(roomId))throw problem('invalid-room','请输入完整的房间链接或编号。');
  return this._begin('B',roomId,stream);
 }
 _reconnectSignal(epoch){
  if(this.reconnectTimer||!this._valid(epoch))return;
  this.reconnectAttempts=(this.reconnectAttempts||0)+1;
  if(this.reconnectAttempts>3){
   if(!this.state.mediaConnected)this._fatal(problem('signal-reconnect','房间服务连接中断，请重新进入。'));
   return;
  }
  this.reconnectTimer=this._later(()=>{
   this.reconnectTimer=null;if(!this._valid(epoch))return;
   try{if(this.peer.disconnected&&!this.peer.destroyed)this.peer.reconnect();}catch{}
   if(!this.state.signalingConnected)this._reconnectSignal(epoch);
  },1500*this.reconnectAttempts);
 }
 _bindConnection(connection,incoming,epoch){
  if(!connection)return this._fatal(problem('connection-error','无法创建实时连接。'));
  if(incoming&&this.pending.size>=4){close(connection);return;}
  if(!incoming)this.connection=connection;
  const timeout=this._later(()=>{
   this.pending.delete(connection);
   if(connection===this.connection&&!this.accepted)this._dropRemote(problem('admission-timeout','房间响应超时，请重新加入。'));
   else if(connection!==this.connection)close(connection);
  },this.config.admissionTimeoutMs);
  this.pending.set(connection,timeout);
  connection.on('open',()=>{
   if(!this._valid(epoch)){close(connection);return;}
   if(!incoming)this._write(connection,{type:'hello',roomId:this.state.roomId});
  });
  connection.on('data',raw=>{
   if(!this._valid(epoch))return;
   const message=readMessage(raw);
   if(!message)return;
   if(incoming&&message.type==='hello'){
    if(message.roomId!==this.state.roomId)return this._decline(connection,'invalid-room');
    if(this.connection&&this.connection!==connection)return this._decline(connection,'room-full');
    if(this.accepted&&this.connection===connection)return;
    this._cancel(this.pending.get(connection));this.pending.delete(connection);
    this.connection=connection;this.accepted=true;this.lastHeard=this.now();
    this._emit({status:'joining',error:null,errorCode:null});
    this._write(connection,{type:'welcome',roomId:this.state.roomId,role:'B'});
    this.mediaTimer=this._later(()=>{if(this._valid(epoch)&&this.connection===connection&&!this.state.mediaConnected)this._dropRemote(problem('media-timeout','对方的画面没有连通，请重新加入。'));},this.config.joinTimeoutMs);
    return;
   }
   if(connection!==this.connection)return;
   if(message.type==='reject'&&!incoming){
    this._fatal(problem(message.reason,message.reason==='room-full'?'房间已有两人，请等待一人退出后再加入。':'房间信息不匹配，请重新打开邀请链接。'));return;
   }
   if(!incoming&&message.type==='welcome'&&!this.accepted){
    if(message.roomId!==this.state.roomId)return;
    this._cancel(this.pending.get(connection));this.pending.delete(connection);
    this.accepted=true;this.lastHeard=this.now();
    try{this._bindMedia(this.peer.call(connection.peer,this.stream,{metadata:{v:1,roomId:this.state.roomId}}),epoch);}
    catch(error){this._fatal(problem('webrtc',error.message));return;}
    this._resolve(this.state.roomId);return;
   }
   if(!this.accepted)return;
   this.lastHeard=this.now();
   if(message.type==='leave'){this._dropRemote();return;}
   if(message.type==='ping'){this._write(connection,{type:'pong',at:message.at});return;}
   if(message.type==='pong'){const elapsed=this.now()-message.at;if(elapsed>=0&&elapsed<60000)this.rttMs=Math.round(elapsed);return;}
   if(message.type==='session'&&this.state.mediaConnected){this.onSession(message.body);return;}
   if(message.type==='meaning'&&this.state.mediaConnected){
    if(message.seq<=this.remoteMeaningSequence)return;
    this.remoteMeaningSequence=message.seq;
    const now=this.now(),body=message.body;
    if(!this._meaningRateAvailable('receive',now))return;
    this.meaningReceivedAt.push(now);
    if(this._staleMeaning(this.remoteMeaningRevisions,body))return;
    this._rememberMeaning(this.remoteMeaningRevisions,body);
    // A/B identity is established by admission, never accepted from remote JSON.
    this.onMeaning({...body,speakerId:this.state.role==='A'?'B':'A'});return;
   }
   if(message.type==='state'&&message.seq>this.remoteSequence){
    this.remoteSequence=message.seq;this.remoteAt=this.now();
    this.remoteState={...message.body,sequence:message.seq,sourceAt:message.at,receivedAt:this.remoteAt};this.onData(this.remoteState);
   }
  });
  connection.on('close',()=>{
   this._cancel(this.pending.get(connection));this.pending.delete(connection);
   if(this._valid(epoch)&&this.connection===connection)this._dropRemote();
  });
  connection.on('error',()=>{
   this._cancel(this.pending.get(connection));this.pending.delete(connection);
   if(this._valid(epoch)&&this.connection===connection)this._dropRemote(problem('data-error','互动连接中断，请重新加入。'));
   else close(connection);
  });
 }
 _decline(connection,reason){
  this._cancel(this.pending.get(connection));this.pending.delete(connection);
  this._write(connection,{type:'reject',reason});this._later(()=>close(connection),150);
 }
 _bindMedia(call,epoch){
  if(!call)throw problem('webrtc','无法创建画面连接。');
  this.media=call;
  call.on('stream',stream=>{
   if(!this._valid(epoch)||this.media!==call)return;
   if(!stream?.getVideoTracks?.().length){this._dropRemote(problem('no-video','对方没有发送有效画面。'));return;}
   this._cancel(this.joinTimer);this._cancel(this.mediaTimer);this.lastHeard=this.now();
   this.remoteStream=stream;this._emit({status:'connected',remotePresent:true,mediaConnected:true,error:null,errorCode:null});this.onStream(stream);
   for(const track of stream.getVideoTracks())track.addEventListener?.('ended',()=>{if(this._valid(epoch)&&this.media===call)this._dropRemote(problem('video-ended','对方画面已结束。'));},{once:true});
  });
  call.on('close',()=>{if(this._valid(epoch)&&this.media===call)this._dropRemote();});
  call.on('error',()=>{if(this._valid(epoch)&&this.media===call)this._dropRemote(problem('webrtc',errors.webrtc));});
 }
 _heartbeat(epoch){
  if(!this._valid(epoch))return;
  const now=this.now();
  if(this.accepted&&this.connection){
   if(now-this.lastHeard>this.config.peerTimeoutMs){this._dropRemote(problem('peer-timeout','对方连接已中断。'));}
   else this._write(this.connection,{type:'ping',at:now});
  }
  if(this.remoteState&&now-this.remoteAt>this.config.stateStaleMs){this.remoteState=null;this.onData(null);}
  this.heartbeatTimer=this._later(()=>this._heartbeat(epoch),this.config.heartbeatIntervalMs);
 }
 sendState(payload){
  if(!this.accepted||!this.connection?.open||!this.state.mediaConnected)return false;
  const now=this.now();if(now-this.lastSent<100)return false;
  const buffered=this.connection.dataChannel?.bufferedAmount||0;
  if(buffered>16384||(this.connection.bufferSize||0)>0)return false;
  const body=normalizeSnapshot(payload);if(!body)return false;
  if(!this._write(this.connection,{type:'state',seq:this.sequence++,at:now,body}))return false;
  this.lastSent=now;return true;
 }
 sendSession(payload){
  if(!this.accepted||!this.connection?.open||!this.state.mediaConnected)return false;
  const body=normalizeSessionMessage(payload);if(!body)return false;
  // Controls use the reliable data channel, independent of droppable 10Hz state.
  // Bounded retries in the session controller prevent congestion from piling up.
  if((this.connection.dataChannel?.bufferedAmount||0)>65536||(this.connection.bufferSize||0)>8)return false;
  return this._write(this.connection,{type:'session',body});
 }
 sendMeaning(payload){
  if(!this.accepted||!this.connection?.open||!this.state.mediaConnected)return false;
  const body=normalizeMeaningMessage(payload);if(!body)return false;
  if(this._staleMeaning(this.sentMeaningRevisions,body))return false;
  const now=this.now();if(!this._meaningRateAvailable('send',now))return false;
  if((this.connection.dataChannel?.bufferedAmount||0)>65536||(this.connection.bufferSize||0)>8)return false;
  const message={v:ROOM_PROTOCOL,type:'meaning',seq:this.meaningSequence,body};
  if(!meaningMessageFits(message)||!this._write(this.connection,message))return false;
  this.meaningSequence++;this.meaningSentAt.push(now);this._rememberMeaning(this.sentMeaningRevisions,body);return true;
 }
 _clearRemote(){
  this._cancel(this.joinTimer);this._cancel(this.mediaTimer);
  const connection=this.connection,media=this.media,hadRemote=Boolean(connection||this.accepted);
  this.connection=null;this.media=null;this.accepted=false;
  this.remoteSequence=-1;this.remoteState=null;this.remoteStream=null;this.remoteAt=0;this.lastHeard=0;this.rttMs=null;
  this._resetMeaningTransport();
  close(media);close(connection);this.onStream(null);this.onData(null);
  if(hadRemote&&['A','B'].includes(this.state.role))this.onMeaning({type:'reset',speakerId:this.state.role==='A'?'B':'A'});
 }
 _dropRemote(error){
  this._clearRemote();
  this._reject(error||problem('peer-left','对方已离开房间。'));
  this._emit({status:this.state.role==='A'?'waiting':'disconnected',remotePresent:false,mediaConnected:false,error:error?.message||null,errorCode:error?.code||null});
 }
 _fatal(error){
  this._reject(error);this._dispose();
  this._emit({status:'error',remotePresent:false,mediaConnected:false,signalingConnected:false,error:error.message,errorCode:error.code});
 }
 _dispose(){
  ++this.epoch;
  for(const id of this.timers)clearTimeout(id);this.timers.clear();
  this._clearRemote();
  for(const connection of this.pending.keys())close(connection);this.pending.clear();
  const peer=this.peer;this.peer=null;try{peer?.destroy();}catch{}
  this.stream=null;this.initialized=false;this.reconnectTimer=null;this.reconnectAttempts=0;
 }
 leave(){
  this._write(this.connection,{type:'leave'});
  this._reject(problem('cancelled','已离开房间。'));this._dispose();
  this._emit({status:'idle',role:null,roomId:null,remotePresent:false,mediaConnected:false,signalingConnected:false,error:null,errorCode:null});
 }
}
