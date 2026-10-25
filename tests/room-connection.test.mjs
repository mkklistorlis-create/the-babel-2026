import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RoomConnection} from '../public/room-connection.js';
import {normalizeSnapshot,randomRoomId,readMessage} from '../public/room-protocol.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const source=()=>{const video={readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended';}};return {getVideoTracks:()=>[video],getTracks:()=>[video]};};
class FakeData extends EventEmitter{
 constructor(peer){super();this.peer=peer;this.open=false;this.closed=false;this.dataChannel={bufferedAmount:0};this.sent=[];}
 send(value){if(!this.open)throw new Error('closed');this.sent.push(value);queueMicrotask(()=>{if(!this.other.closed)this.other.emit('data',structuredClone(value));});}
 close(){if(this.closed)return;this.closed=true;this.open=false;this.emit('close');if(this.other&&!this.other.closed)this.other.close();}
}
class FakeMedia extends EventEmitter{
 constructor(peer,stream){super();this.peer=peer;this.localStream=stream;this.closed=false;}
 answer(stream){this.localStream=stream;queueMicrotask(()=>{if(!this.closed){this.emit('stream',this.other.localStream);this.other.emit('stream',stream);}});}
 close(){if(this.closed)return;this.closed=true;this.emit('close');if(this.other&&!this.other.closed)this.other.close();}
}
function peerClass({autoOpen=true,deliverCalls=true}={}){
 return class FakePeer extends EventEmitter{
  static registry=new Map();static calls=[];static instances=[];
  constructor(id,options){super();this.id=id;this.options=options;this.destroyed=false;this.disconnected=false;this.links=[];this.constructor.instances.push(this);this.constructor.registry.set(id,this);if(autoOpen)queueMicrotask(()=>{if(!this.destroyed)this.emit('open',id);});}
  connect(id){
   const target=this.constructor.registry.get(id),local=new FakeData(id),remote=new FakeData(this.id);local.other=remote;remote.other=local;this.links.push(local);
   queueMicrotask(()=>{
    if(!target){this.emit('error',{type:'peer-unavailable'});return;}
    target.links.push(remote);target.emit('connection',remote);local.open=true;remote.open=true;remote.emit('open');local.emit('open');
   });return local;
  }
  call(id,stream){
   const target=this.constructor.registry.get(id),local=new FakeMedia(id,stream),remote=new FakeMedia(this.id,null);local.other=remote;remote.other=local;this.links.push(local);this.constructor.calls.push([this.id,id]);
   if(deliverCalls)queueMicrotask(()=>{if(target&&!target.destroyed){target.links.push(remote);target.emit('call',remote);}});return local;
  }
  reconnect(){this.disconnected=false;queueMicrotask(()=>this.emit('open',this.id));}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.constructor.registry.delete(this.id);for(const link of this.links)link.close();this.emit('close');}
 };
}
async function paired(extra={}){
 const PeerClass=peerClass(),aStream=source(),bStream=source();let now=100;
 const receivedA=[],receivedB=[],streamsA=[],streamsB=[],meaningsA=[],meaningsB=[];
 const a=new RoomConnection({PeerClass,onData:d=>receivedA.push(d),onStream:s=>streamsA.push(s),onMeaning:m=>meaningsA.push(m),config:{now:()=>now,...extra}});
 const b=new RoomConnection({PeerClass,onData:d=>receivedB.push(d),onStream:s=>streamsB.push(s),onMeaning:m=>meaningsB.push(m),config:{now:()=>now,...extra}});
 const roomId=await a.host(aStream);await b.join(roomId,bStream);await flush();
 return {a,b,aStream,bStream,roomId,PeerClass,receivedA,receivedB,streamsA,streamsB,meaningsA,meaningsB,advance:t=>now=t,cleanup:()=>{a.leave();b.leave();}};
}
const snapshot=(extra={})=>({mode:'live',present:true,hands:[{id:'left',tip:{x:.2,y:.7},palm:{x:.2,y:.8}}],expression:{id:'smile',score:.8,actions:{smile:.8}},aspect:16/9,...extra});

test('rooms use 128 random bits and validate hand/expression data without carrying frames',()=>{
 const id=randomRoomId();assert.match(id,/^babel-[a-f0-9]{32}$/);assert.notEqual(id,randomRoomId());
 const normalized=normalizeSnapshot(snapshot({frame:'secret-image',hands:[{id:'a',tip:{x:-1,y:2},landmarks:Array(478).fill({x:1,y:1})}],expression:{id:'smile',score:4,actions:{smile:4,secret:'no',eyeBlinkLeft:NaN}}}));
 assert.deepEqual(normalized.hands,[{id:'a',tip:{x:0,y:1}}]);assert.deepEqual(normalized.expression.actions,{smile:1});assert.equal(normalized.expression.score,1);assert.equal(normalized.frame,undefined);
 assert.equal(normalizeSnapshot({mode:'idle',present:true}),null);
 assert.deepEqual(normalizeSnapshot(snapshot({present:false})).hands,[]);
 assert.equal(normalizeSnapshot(snapshot({present:false})).expression,null);
 assert.equal(readMessage({v:1,type:'state',seq:1,at:0,body:{...snapshot(),junk:'x'.repeat(9000)}}),null);
 assert.equal(readMessage({v:2,type:'hello',roomId:id}),null);
 assert.equal(readMessage({v:1,type:'state',seq:-1,at:0,body:snapshot()}),null);
});

test('host opens a waiting room; admitted guest receives and sends its own stream',async()=>{
 const p=await paired();try{
  assert.equal(p.a.diagnostics.status,'connected');assert.equal(p.b.diagnostics.status,'connected');
  assert.equal(p.a.diagnostics.role,'A');assert.equal(p.b.diagnostics.role,'B');
  assert.equal(p.a.diagnostics.roomId,p.roomId);assert.equal(p.b.diagnostics.roomId,p.roomId);
  assert.equal(p.a.remoteStream,p.bStream);assert.equal(p.b.remoteStream,p.aStream);
  assert.equal(p.PeerClass.calls.length,1);assert.equal(p.a.diagnostics.mediaConnected,true);
 }finally{p.cleanup();}
 assert.equal(p.aStream.getVideoTracks()[0].stops,0);assert.equal(p.bStream.getVideoTracks()[0].stops,0);
});

test('a third participant is rejected before media starts and existing room is preserved',async()=>{
 const p=await paired(),third=new RoomConnection({PeerClass:p.PeerClass});try{
  await assert.rejects(third.join(p.roomId,source()),{code:'room-full'});
  assert.equal(third.diagnostics.status,'error');assert.equal(third.diagnostics.errorCode,'room-full');
  assert.equal(p.PeerClass.calls.length,1);assert.equal(p.a.diagnostics.status,'connected');assert.equal(p.b.diagnostics.status,'connected');
 }finally{third.leave();p.cleanup();}
});

test('unauthorized media never gets the host stream',async()=>{
 const PeerClass=peerClass(),a=new RoomConnection({PeerClass}),own=source();
 try{
  const roomId=await a.host(own),stranger=new PeerClass(randomRoomId());await flush();
  const call=stranger.call(roomId,source());await flush();assert.equal(call.closed,true);assert.equal(call.other.localStream,null);
  assert.equal(a.diagnostics.status,'waiting');stranger.destroy();
 }finally{a.leave();}
});

test('guest departure clears remote state and host can accept a replacement',async()=>{
 const p=await paired();let c;try{
  assert.equal(p.b.sendState(snapshot()),true);await flush();assert.equal(p.a.remoteState.expression.id,'smile');
  p.b.leave();await flush();assert.equal(p.a.diagnostics.status,'waiting');assert.equal(p.a.diagnostics.mediaConnected,false);assert.equal(p.a.remoteState,null);assert.equal(p.streamsA.at(-1),null);
  c=new RoomConnection({PeerClass:p.PeerClass});await c.join(p.roomId,source());await flush();assert.equal(p.a.diagnostics.status,'connected');assert.equal(c.diagnostics.role,'B');
 }finally{c?.leave();p.cleanup();}
});

test('host exit disconnects guest and never stops either caller-owned source',async()=>{
 const p=await paired();try{
  p.a.leave();await flush();assert.equal(p.b.diagnostics.status,'disconnected');assert.equal(p.b.diagnostics.remotePresent,false);assert.equal(p.b.remoteStream,null);
  assert.equal(p.aStream.getVideoTracks()[0].stops,0);assert.equal(p.bStream.getVideoTracks()[0].stops,0);
 }finally{p.cleanup();}
});

test('state packets are capped at 10Hz, avoid backlog and reject reordered snapshots',async()=>{
 const p=await paired();try{
  assert.equal(p.a.sendState(snapshot()),true);assert.equal(p.a.sendState(snapshot()),false);await flush();
  assert.equal(p.b.remoteState.expression.id,'smile');const first=p.b.remoteState;
  p.advance(200);p.a.connection.dataChannel.bufferedAmount=20000;assert.equal(p.a.sendState(snapshot()),false);
  p.a.connection.dataChannel.bufferedAmount=0;assert.equal(p.a.sendState(snapshot({expression:{id:'pucker',score:.7}})),true);await flush();
  p.b.connection.emit('data',{v:1,type:'state',seq:0,at:1,body:snapshot()});assert.equal(p.b.remoteState.expression.id,'pucker');assert.equal(p.b.remoteState.sequence,1);
  assert.equal(first.sourceAt,100);assert.equal(first.receivedAt,100);
 }finally{p.cleanup();}
});

test('remote freshness uses local receive time even when sender clocks differ',async()=>{
 const p=await paired();try{
  p.b.connection.emit('data',{v:1,type:'state',seq:42,at:9_000_000,body:snapshot()});
  assert.equal(p.b.remoteState.sourceAt,9_000_000);assert.equal(p.b.remoteState.receivedAt,100);
  p.advance(1700);p.b.lastHeard=1700;p.b._heartbeat(p.b.epoch);
  assert.equal(p.b.remoteState,null);assert.equal(p.b.diagnostics.mediaConnected,true);assert.equal(p.receivedB.at(-1),null);
 }finally{p.cleanup();}
});

test('stale callbacks from a left room cannot join or overwrite a new room',async()=>{
 const PeerClass=peerClass({autoOpen:false}),a=new RoomConnection({PeerClass});
 const pending=a.host(source()),rejection=assert.rejects(pending,{code:'cancelled'}),oldPeer=a.peer;a.leave();await rejection;
 const next=a.host(source()),newPeer=a.peer;oldPeer.emit('open',oldPeer.id);assert.equal(a.diagnostics.status,'connecting');
 newPeer.emit('open',newPeer.id);const id=await next;assert.equal(a.diagnostics.roomId,id);assert.equal(a.diagnostics.status,'waiting');a.leave();
});

test('invalid IDs and missing video source fail before opening signaling',async()=>{
 const PeerClass=peerClass(),a=new RoomConnection({PeerClass});
 await assert.rejects(a.join('bad-room',source()),{code:'invalid-room'});
 await assert.rejects(a.host({getVideoTracks:()=>[]}),{code:'no-source'});
 assert.equal(PeerClass.instances.length,0);assert.equal(a.diagnostics.status,'idle');a.leave();
});

test('unreachable rooms reject cleanly rather than remaining in joining state',async()=>{
 const PeerClass=peerClass(),a=new RoomConnection({PeerClass});
 await assert.rejects(a.join(randomRoomId(),source()),{code:'peer-unavailable'});
 assert.equal(a.diagnostics.status,'error');assert.equal(a.peer,null);assert.equal(a.pending.size,0);assert.equal(a.timers.size,0);a.leave();
});

test('dead peer heartbeat clears media without waiting for an explicit close',async()=>{
 const p=await paired();try{
  p.advance(13000);p.a._heartbeat(p.a.epoch);
  assert.equal(p.a.diagnostics.status,'waiting');assert.equal(p.a.diagnostics.errorCode,'peer-timeout');assert.equal(p.a.diagnostics.remotePresent,false);
 }finally{p.cleanup();}
});

test('session controls require admitted media and remain independent from throttled visual snapshots',async()=>{
 const p=await paired(),received=[];p.b.onSession=message=>received.push(message);
 const body={action:'start',sessionId:'a'.repeat(32),role:'A'};
 try{
  assert.equal(p.a.sendState(snapshot()),true);
  assert.equal(p.a.sendState(snapshot()),false);
  assert.equal(p.a.sendSession(body),true);await flush();assert.deepEqual(received,[body]);
  assert.equal(p.a.sendSession({...body,role:'B'}),false);
  p.a.connection.dataChannel.bufferedAmount=70000;assert.equal(p.a.sendSession(body),false);
  p.a.connection.dataChannel.bufferedAmount=0;p.b.state.mediaConnected=false;
  assert.equal(p.a.sendSession(body),true);await flush();assert.equal(received.length,1);
  p.b.state.mediaConnected=true;p.a.leave();assert.equal(p.a.sendSession(body),false);
 }finally{p.cleanup();}
});

const meaning=(extra={})=>({type:'meaning',stage:'final',utteranceId:'turn-1',revision:2,language:'en',text:'I like this design.',
 meaning:'说话者喜欢这个设计。',intent:'evaluate',target:'this design',attributes:['喜欢'],degree:'moderate',
 polarity:'positive',uncertain:false,evidence:['like this design'],latencyMs:400,...extra});

test('translated partial and same-revision final cross the admitted channel in order',async()=>{
 const p=await paired();try{
  const value=meaning({stage:'partial',targetLanguage:'ja',translation:'このデザインが好きです。'});
  assert.equal(p.a.sendMeaning(value),true);assert.equal(p.a.sendMeaning(value),false);
  assert.equal(p.a.sendMeaning({...value,stage:'final'}),true);await flush();
  assert.deepEqual(p.meaningsB.map(x=>[x.stage,x.targetLanguage]),[['partial','ja'],['final','ja']]);
  assert.equal(p.a.sendMeaning({...value,revision:3}),false);
 }finally{p.cleanup();}
});

test('final meanings cross the admitted peer channel with receiver-assigned speaker identity',async()=>{
 const p=await paired();try{
  assert.equal(p.a.sendMeaning(meaning({speakerId:'B',role:'B'})),true);
  assert.equal(p.b.sendMeaning(meaning({speakerId:'A',role:'A'})),true);await flush();
  assert.deepEqual(p.meaningsB,[{...meaning(),speakerId:'A'}]);assert.deepEqual(p.meaningsA,[{...meaning(),speakerId:'B'}]);
  assert.equal(p.a.sendMeaning(meaning({stage:'partial'})),false);
  assert.equal(p.a.sendMeaning(meaning({utteranceId:'bad-evidence',evidence:['not said']})),false);
  assert.equal(p.a.sendMeaning({type:'reset'}),true);await flush();assert.deepEqual(p.meaningsB.at(-1),{type:'reset',speakerId:'A'});
  assert.equal(p.a.diagnostics.sentMeaningSequence,2);assert.equal(p.b.diagnostics.receivedMeaningSequence,1);
 }finally{p.cleanup();}
});

test('semantic sequence and per-turn revisions reject duplicate, reordered and reset-era replay',async()=>{
 const p=await paired();try{
  p.a.sendMeaning(meaning());await flush();assert.equal(p.meaningsB.length,1);
  assert.equal(p.a.sendMeaning(meaning()),false);
  const packet=p.a.connection.sent.find(message=>message.type==='meaning');
  p.b.connection.emit('data',packet);assert.equal(p.meaningsB.length,1);
  p.b.connection.emit('data',{...packet,seq:1});assert.equal(p.meaningsB.length,1);
  p.b.connection.emit('data',{...packet,seq:2,body:{type:'reset'}});assert.equal(p.meaningsB.length,2);
  p.b.connection.emit('data',{...packet,seq:3});assert.equal(p.meaningsB.length,2);
  p.b.connection.emit('data',{...packet,seq:4,body:meaning({revision:3})});assert.equal(p.meaningsB.length,3);
  p.b.connection.emit('data',{...packet,seq:3,body:meaning({revision:4})});assert.equal(p.meaningsB.length,3);
 }finally{p.cleanup();}
});

test('meaning throttles and backpressure are independent from visual and session traffic',async()=>{
 const p=await paired();try{
  for(let i=0;i<10;i++)assert.equal(p.a.sendMeaning(meaning({utteranceId:`turn-${i}`})),true);
  assert.equal(p.a.sendMeaning(meaning({utteranceId:'limited'})),false);await flush();assert.equal(p.meaningsB.length,10);
  assert.equal(p.a.sendState(snapshot()),true);
  assert.equal(p.a.sendSession({action:'start',sessionId:'a'.repeat(32),role:'A'}),true);
  p.advance(1100);assert.equal(p.a.sendMeaning({type:'reset'}),true);await flush();assert.equal(p.meaningsB.at(-1).type,'reset');
  p.a.connection.dataChannel.bufferedAmount=70000;assert.equal(p.a.sendMeaning(meaning({utteranceId:'congested'})),false);
  p.a.connection.dataChannel.bufferedAmount=0;p.a.connection.bufferSize=9;assert.equal(p.a.sendMeaning({type:'reset'}),false);
 }finally{p.cleanup();}
});

test('receiver independently rate-limits semantic floods and ignores unadmitted or oversized data',async()=>{
 const p=await paired();try{
  p.b.state.mediaConnected=false;
  p.b.connection.emit('data',{v:1,type:'meaning',seq:0,body:meaning()});assert.equal(p.meaningsB.length,0);
  p.b.state.mediaConnected=true;
  for(let i=0;i<15;i++)p.b.connection.emit('data',{v:1,type:'meaning',seq:i,body:meaning({utteranceId:`flood-${i}`})});
  assert.equal(p.meaningsB.length,10);
  assert.equal(p.b.diagnostics.receivedMeaningSequence,14);
  p.advance(1200);p.b.connection.emit('data',{v:1,type:'meaning',seq:15,body:{type:'reset'}});assert.equal(p.meaningsB.length,11);
  p.b.connection.emit('data',{v:1,type:'meaning',seq:16,body:meaning({text:'中'.repeat(2000),meaning:'意'.repeat(600),target:'对'.repeat(200),evidence:['中'],attributes:Array(12).fill('性'.repeat(80))})});
  assert.equal(p.meaningsB.length,11);assert.equal(p.b.diagnostics.receivedMeaningSequence,15);
 }finally{p.cleanup();}
});

test('disconnect clears meaning transport and stale connections cannot affect a replacement peer',async()=>{
 const p=await paired();let c;try{
  assert.equal(p.b.sendMeaning(meaning()),true);await flush();assert.equal(p.meaningsA.length,1);
  const oldConnection=p.a.connection;p.b.leave();await flush();
  assert.deepEqual(p.meaningsA.at(-1),{type:'reset',speakerId:'B'});
  assert.equal(p.a.diagnostics.receivedMeaningSequence,-1);assert.equal(p.a.diagnostics.sentMeaningSequence,0);
  c=new RoomConnection({PeerClass:p.PeerClass});await c.join(p.roomId,source());await flush();
  const count=p.meaningsA.length;
  oldConnection.emit('data',{v:1,type:'meaning',seq:100,body:meaning({utteranceId:'stale'})});assert.equal(p.meaningsA.length,count);
  assert.equal(c.sendMeaning(meaning()),true);await flush();assert.equal(p.meaningsA.length,count+1);
  assert.equal(p.meaningsA.at(-1).speakerId,'B');assert.equal(p.a.diagnostics.receivedMeaningSequence,0);
  c.leave();assert.equal(c.sendMeaning(meaning()),false);
 }finally{c?.leave();p.cleanup();}
});


test('translation deduplication is scoped to the listener language after a language switch',async()=>{
 const p=await paired();try{
  assert.equal(p.a.sendMeaning(meaning({targetLanguage:'en',translation:'Hello'})),true);await flush();
  assert.equal(p.a.sendMeaning(meaning({targetLanguage:'ja',translation:'こんにちは'})),true);await flush();
  assert.equal(p.a.sendMeaning(meaning({targetLanguage:'ja',translation:'duplicate'})),false);
  assert.deepEqual(p.meaningsB.map(x=>x.targetLanguage),['en','ja']);
 }finally{p.cleanup();}
});
