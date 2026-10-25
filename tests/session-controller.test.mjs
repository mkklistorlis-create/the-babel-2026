import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionController} from '../public/session-controller.js';
import {normalizeSessionMessage} from '../public/session-protocol.js';

const id=n=>n.toString(16).padStart(32,'0');
function pair({clockStep=0,autoStart=false,connect=true}={}){
 let time=0,nextId=0,drop=()=>false;
 const queue=[],sends={A:0,B:0},changes={A:0,B:0},events={A:[],B:[]},sentMessages={A:[],B:[]},snapshots={A:{mode:'demo',present:true,paused:false,expression:{id:'smile'}},B:{mode:'demo',present:true,paused:false,expression:{id:'wink'}}};
 const make=role=>createSessionController({autoStart,now:()=>time+=clockStep,randomId:()=>id(++nextId),getSnapshot:()=>snapshots[role],onChange:state=>{changes[role]++;events[role].push({kind:state.kind,phase:state.phase});},send:message=>{
  sends[role]++;sentMessages[role].push(structuredClone(message));
  if(!drop(role,message))queue.push([role==='A'?'B':'A',structuredClone(message)]);return true;
 }});
 const controllers={A:make('A'),B:make('B')};
 const connection=role=>({status:'connected',role,roomId:'babel-'+id(999)});
 if(connect){controllers.A.setConnection(connection('A'));controllers.B.setConnection(connection('B'));}
 function flush(){let count=0;while(queue.length){if(++count>1000)throw new Error('Protocol feedback loop');const [role,message]=queue.shift();controllers[role].receive(message);}}
 function advance(ms){for(let remaining=ms;remaining>0;remaining-=200){time+=Math.min(200,remaining);controllers.A.tick();controllers.B.tick();flush();}}
 return {...controllers,snapshots,sends,changes,events,sentMessages,connection,queue,flush,advance,drop:fn=>drop=fn,get time(){return time;},setTime:value=>time=value};
}

test('host/guest handshake starts one round, with local durations and stable episode counts',()=>{
 const p=pair();assert.equal(p.B.start(),false);assert.equal(p.A.state.canStart,true);
 assert.equal(p.A.start(),true);assert.equal(p.A.state.phase,'starting');p.flush();
 assert.equal(p.A.state.phase,'recording');assert.equal(p.B.state.phase,'recording');
 assert.equal(p.A.state.sessionId,p.B.state.sessionId);p.advance(2000);
 assert.equal(p.A.state.local.validMs,2000);assert.equal(p.B.state.local.validMs,2000);
 assert.equal(p.A.state.local.counts.find(x=>x.id==='smile').episodes,1);
 assert.equal(p.B.state.local.counts.find(x=>x.id==='wink').episodes,1);
 assert.equal(p.A.state.remote.role,'B');assert.equal(p.B.state.remote.role,'A');
});

test('continuously advancing clocks retain the initial valid sample without a missing first interval',()=>{
 const p=pair({clockStep:.01});p.A.start();p.flush();
 for(const controller of [p.A,p.B]){
  assert.equal(controller.state.local.counts.reduce((sum,x)=>sum+x.episodes,0),1,'initial sample must be accepted');
 }
 p.advance(200);
 for(const controller of [p.A,p.B]){
  assert.ok(controller.state.local.durationMs>=200);
  assert.equal(controller.state.local.missingMs,0,'first timer interval is valid with a fresh initial sample');
 }
});

test('empty guest recorder uses one timestamp even when each clock read advances',()=>{
 const p=pair({clockStep:.01});p.drop((_,message)=>message.action==='begin');p.A.start();p.flush();
 assert.equal(p.B.state.phase,'starting');p.A.finish();p.flush();
 assert.equal(p.B.state.complete,true);assert.equal(p.B.state.local.durationMs,0);
 assert.equal(p.B.state.local.validMs,0);assert.equal(p.B.state.local.missingMs,0);
});

for(const ender of ['A','B'])test(`${ender} can finish; both final summaries are acknowledged and another round starts`,()=>{
 const p=pair();p.A.start();p.flush();p.advance(1400);const first=p.A.state.sessionId;
 assert.equal(p[ender].finish(),true);p.flush();
 for(const controller of [p.A,p.B]){
  assert.equal(controller.state.phase,'complete');assert.equal(controller.state.complete,true);
  assert.equal(controller.state.localAcknowledged,true);assert.equal(controller.state.remoteFinal,true);
  assert.equal(controller.state.local.validMs,1400);assert.equal(controller.state.remote.validMs,1400);
 }
 p.advance(2000);assert.equal(p.A.state.local.durationMs,1400,'completed result must not keep accumulating');
 assert.equal(p.A.start(),true);p.flush();assert.notEqual(p.A.state.sessionId,first);
 p.advance(400);assert.equal(p.A.state.local.validMs,400);assert.equal(p.B.state.local.validMs,400);
});

test('summary exchange replaces versions, never duplicates counts, and results are mutation-safe',()=>{
 const p=pair();p.A.start();p.flush();p.advance(1200);
 const remote=p.B.state.local,message={action:'summary',sessionId:remote.sessionId,role:'B',summary:remote};
 assert.equal(p.A.receive(message),true);assert.equal(p.A.receive(message),true);
 assert.equal(p.A.state.remote.validMs,1200);assert.equal(p.A.state.remote.counts.find(x=>x.id==='wink').episodes,1);
 const copy=p.A.state;copy.remote.counts[0].durationMs=9000;assert.notEqual(p.A.state.remote.counts[0].durationMs,9000);
 const older=structuredClone(message);older.summary.revision=0;assert.equal(p.A.receive(older),false);
});

test('wrong roles, unknown sessions, malformed summaries and retired start messages are ignored',()=>{
 const p=pair();p.A.start();p.flush();p.advance(1200);const original=p.A.state.sessionId;
 assert.equal(p.B.receive({action:'begin',sessionId:id(222),role:'A'}),false);
 assert.equal(p.A.receive({action:'stop',sessionId:original,role:'A'}),false);
 assert.equal(p.A.receive({action:'summary',sessionId:original,role:'B',summary:{}}),false);
 p.A.finish();p.flush();p.A.start();p.flush();
 assert.equal(p.B.receive({action:'start',sessionId:original,role:'A'}),false);
 assert.notEqual(p.B.state.sessionId,original);
});

test('lost start, ready and begin messages retry without resetting a running recorder',()=>{
 const p=pair();const lost=new Set();p.drop((_,message)=>{
  if(['start','ready','begin'].includes(message.action)&&!lost.has(message.action)){lost.add(message.action);return true;}return false;
 });
 p.A.start();p.flush();p.advance(3200);
 assert.equal(p.A.state.phase,'recording');assert.equal(p.B.state.phase,'recording');
 const before=p.A.state.local.validMs;
 p.A.receive({action:'ready',sessionId:p.A.state.sessionId,role:'B'});p.flush();p.advance(400);
 assert.equal(p.A.state.local.validMs,before+400,'duplicate ready cannot restart host clock');
});

test('ending before a delayed begin reaches the guest still exchanges a valid zero-duration guest result',()=>{
 const p=pair();p.drop((_,message)=>message.action==='begin');p.A.start();p.flush();
 assert.equal(p.A.state.phase,'recording');assert.equal(p.B.state.phase,'starting');
 p.A.finish();p.flush();assert.equal(p.A.state.complete,true);assert.equal(p.B.state.complete,true);
 assert.equal(p.A.state.remote.durationMs,0);
});

test('lost final and acknowledgements retry, completed peer answers repeated final',()=>{
 const p=pair();p.A.start();p.flush();p.advance(1200);const lost=new Set();
 p.drop((role,message)=>{const key=role+message.action;if(['final','ack'].includes(message.action)&&!lost.has(key)){lost.add(key);return true;}return false;});
 p.B.finish();p.flush();p.advance(3000);
 assert.equal(p.A.state.complete,true);assert.equal(p.B.state.complete,true);
 const duration=p.B.state.local.durationMs;p.advance(1000);assert.equal(p.B.state.local.durationMs,duration);
});

test('starting another round still acknowledges a delayed final from the previous one',()=>{
 const p=pair();p.A.start();p.flush();p.advance(1200);
 p.drop((role,message)=>role==='A'&&message.action==='ack');p.A.finish();p.flush();
 assert.equal(p.A.state.complete,true);assert.equal(p.B.state.phase,'finishing');
 const previous=p.A.state.sessionId;p.drop(()=>false);p.A.start();p.flush();p.advance(1800);
 assert.equal(p.A.state.phase,'recording');assert.equal(p.B.state.phase,'recording');
 assert.equal(p.A.state.sessionId,p.B.state.sessionId);assert.notEqual(p.A.state.sessionId,previous);
});

test('disconnect preserves an explicitly incomplete summary and reconnect does not resume the old round',()=>{
 const p=pair();p.A.start();p.flush();p.advance(1400);const old=p.A.state.sessionId;
 p.A.setConnection({status:'waiting',role:'A',roomId:p.connection('A').roomId});
 p.B.setConnection({status:'disconnected',role:'B',roomId:p.connection('B').roomId});
 assert.equal(p.A.state.phase,'complete');assert.equal(p.A.state.complete,false);assert.equal(p.A.state.reason,'disconnected');
 assert.equal(p.A.state.remote.validMs,1000,'only latest received summary is retained');
 p.advance(2000);assert.equal(p.A.state.local.validMs,1400);
 p.A.setConnection(p.connection('A'));p.B.setConnection(p.connection('B'));
 assert.equal(p.B.receive({action:'begin',sessionId:old,role:'A'}),false);
 assert.equal(p.A.start(),true);p.flush();assert.notEqual(p.B.state.sessionId,old);assert.equal(p.B.state.phase,'recording');
});

test('old clients and unavailable final acknowledgements time out with partial result status',()=>{
 const p=pair();p.drop(()=>true);p.A.start();p.advance(10200);
 assert.equal(p.A.state.phase,'complete');assert.equal(p.A.state.reason,'start-timeout');assert.equal(p.A.state.complete,false);
 assert.equal(p.A.state.canStart,true);
 const q=pair();q.A.start();q.flush();q.advance(1200);q.drop(()=>true);q.A.finish();q.advance(8200);
 assert.equal(q.A.state.phase,'complete');assert.equal(q.A.state.reason,'sync-timeout');assert.equal(q.A.state.complete,false);
 assert.equal(q.A.state.timing.endedAt,1200);assert.equal(q.A.state.timing.endedBy,'local','sync timeout must preserve who stopped recording');
});

test('paused, missing and mismatched source modes are excluded from valid expression duration',()=>{
 const p=pair();p.A.start();p.flush();p.advance(1000);
 p.snapshots.A.paused=true;p.A.tick();p.advance(1000);
 p.snapshots.A.paused=false;p.snapshots.A.present=false;p.A.tick();p.advance(1000);
 p.snapshots.A.present=true;p.snapshots.A.mode='live';p.A.tick();p.advance(1000);
 assert.equal(p.A.state.local.validMs,1000);assert.equal(p.A.state.local.missingMs,3000);
});

test('large clock gap is bounded and destruction blocks subsequent messages',()=>{
 const p=pair();p.A.start();p.flush();p.advance(1000);p.setTime(11000);p.A.tick();
 assert.ok(p.A.state.local.validMs<=1500);assert.ok(p.A.state.local.missingMs>=9500);
 p.A.destroy();assert.equal(p.A.state.complete,false);assert.equal(p.A.state.canStart,false);
 assert.equal(p.A.receive({action:'stop',sessionId:p.A.state.sessionId,role:'B'}),false);
});

test('session envelope only permits supported roles, bounded identifiers and valid acknowledgement revisions',()=>{
 assert.equal(normalizeSessionMessage({action:'start',sessionId:id(1),role:'B'}),null);
 assert.equal(normalizeSessionMessage({action:'ready',sessionId:id(1),role:'A'}),null);
 assert.equal(normalizeSessionMessage({action:'start',sessionId:'x'.repeat(100),role:'A'}),null);
 assert.equal(normalizeSessionMessage({action:'ack',sessionId:id(1),role:'B',revision:1.4}),null);
 assert.deepEqual(normalizeSessionMessage({action:'start',sessionId:id(1),role:'A',extra:'ignored'}),{action:'start',sessionId:id(1),role:'A'});
});

test('event observations preserve a 40ms wink between two 200ms polling ticks',()=>{
 const p=pair();p.A.start();p.flush();
 p.setTime(40);p.snapshots.A.expression={id:'wink'};assert.equal(p.A.observe(),true);
 assert.equal(p.A.state.local.counts.find(x=>x.id==='wink').episodes,1,'diagnostics immediately include the flash');
 p.setTime(80);p.snapshots.A.expression={id:'smile'};p.A.observe();
 p.setTime(200);p.A.tick();
 assert.deepEqual(p.A.state.local.counts.find(x=>x.id==='wink'),{id:'wink',episodes:1,durationMs:40});
 assert.deepEqual(p.A.state.local.counts.find(x=>x.id==='smile'),{id:'smile',episodes:2,durationMs:160});
 assert.equal(p.A.state.local.missingMs,0);
});

test('multiple short emoji transitions in one timer window each retain their own duration and count',()=>{
 const p=pair();p.A.start();p.flush();
 for(const [at,emoji] of [[15,'pucker'],[30,'open-mouth'],[55,'brow-furrow'],[85,'raised-eyes'],[105,'smile']]){
  p.setTime(at);p.snapshots.A.expression={id:emoji};p.A.observe(p.snapshots.A,at);
 }
 p.setTime(200);p.A.tick();
 for(const [emoji,durationMs] of [['pucker',15],['open-mouth',25],['brow-furrow',30],['raised-eyes',20]]){
  assert.deepEqual(p.A.state.local.counts.find(x=>x.id===emoji),{id:emoji,episodes:1,durationMs});
 }
 assert.equal(p.A.state.local.validMs,200);assert.equal(p.A.state.local.counts.find(x=>x.id==='smile').episodes,2);
});

test('high-frequency observations of the same emoji do not repeat episodes or emit UI and network updates',()=>{
 const p=pair();p.A.start();p.flush();const sends=p.sends.A,changes=p.changes.A;
 for(const at of [10,20,30,40,60,100,150]){p.setTime(at);p.A.observe();}
 assert.deepEqual(p.A.state.local.counts.find(x=>x.id==='smile'),{id:'smile',episodes:1,durationMs:150});
 assert.equal(p.sends.A,sends);assert.equal(p.changes.A,changes);
});

test('paused, hidden and absent event observations exclude short flashes immediately',()=>{
 const p=pair();p.A.start();p.flush();
 p.setTime(20);p.snapshots.A.paused=true;p.snapshots.A.expression={id:'wink'};p.A.observe();
 p.setTime(40);p.snapshots.A.expression={id:'pucker'};p.A.observe();
 // The app maps document.hidden to the same paused flag before observing.
 p.setTime(60);p.snapshots.A.expression={id:'raised-eyes'};p.A.observe({...p.snapshots.A,paused:true});
 p.setTime(80);p.snapshots.A.paused=false;p.snapshots.A.present=false;p.A.observe();
 p.setTime(100);p.snapshots.A.present=true;p.snapshots.A.expression={id:'smile'};p.A.observe();
 p.setTime(200);p.A.tick();
 for(const emoji of ['wink','pucker','raised-eyes'])assert.equal(p.A.state.local.counts.find(x=>x.id===emoji).episodes,0);
 assert.equal(p.A.state.local.validMs,120);assert.equal(p.A.state.local.missingMs,80);
});

test('event observations outside a running round or from the wrong source mode cannot add emoji counts',()=>{
 const p=pair();assert.equal(p.A.observe(),false);assert.equal(p.A.state.local,null);
 p.A.start();p.flush();p.setTime(50);p.snapshots.A.mode='live';p.snapshots.A.expression={id:'wink'};p.A.observe();
 p.setTime(100);p.A.observe();assert.equal(p.A.state.local.counts.find(x=>x.id==='wink').episodes,0);
 assert.equal(p.A.state.local.validMs,50);assert.equal(p.A.state.local.missingMs,50);
 p.A.finish();p.flush();const final=p.A.state.local;p.setTime(150);p.snapshots.A.mode='demo';
 assert.equal(p.A.observe(),false);assert.deepEqual(p.A.state.local,final);
 p.A.destroy();assert.equal(p.A.observe(),false);assert.deepEqual(p.A.state.local,final);
});

test('an emoji appearing at the final timestamp retains a zero-duration episode in both final summaries',()=>{
 const p=pair();p.A.start();p.flush();p.setTime(100);p.snapshots.A.expression={id:'wink'};
 p.A.observe();p.A.finish();p.flush();
 assert.equal(p.A.state.complete,true);assert.equal(p.B.state.complete,true);
 const row={id:'wink',durationMs:0,episodes:1};
 assert.deepEqual(p.A.state.local.counts.find(x=>x.id==='wink'),row);
 assert.deepEqual(p.B.state.remote.counts.find(x=>x.id==='wink'),row);
 assert.deepEqual(p.B.state.remote,p.A.state.local,'final acknowledgement covers the same data');
});

test('automatic start opens one round per fresh connection and preserves completed results on repeated updates',()=>{
 const p=pair({autoStart:true});assert.equal(p.A.state.phase,'starting');p.flush();
 assert.equal(p.A.state.phase,'recording');assert.equal(p.B.state.phase,'recording');
 assert.equal(p.A.state.timing.startedBy,'automatic');assert.equal(p.B.state.timing.startedBy,'peer');
 const first=p.A.state.sessionId,changes=p.changes.A;
 for(let i=0;i<20;i++)p.A.setConnection(p.connection('A'));
 assert.equal(p.A.state.sessionId,first);assert.equal(p.changes.A,changes,'unchanged connection updates do not re-emit');
 p.advance(1200);p.B.finish();p.flush();
 assert.equal(p.A.state.complete,true);assert.equal(p.A.state.timing.endedBy,'peer');assert.equal(p.B.state.timing.endedBy,'local');
 for(let i=0;i<20;i++)p.A.setConnection(p.connection('A'));
 assert.equal(p.A.state.phase,'complete');assert.equal(p.A.state.sessionId,first);
 p.A.setConnection({status:'waiting',role:'A',roomId:p.connection('A').roomId});
 p.B.setConnection({status:'disconnected',role:'B',roomId:p.connection('B').roomId});
 p.A.setConnection(p.connection('A'));p.B.setConnection(p.connection('B'));p.flush();
 assert.equal(p.A.state.phase,'recording');assert.equal(p.B.state.phase,'recording');assert.notEqual(p.A.state.sessionId,first);
 assert.equal(p.A.state.timing.startedBy,'automatic');
});

test('automatic start marks its attempt before a reentrant connection update',()=>{
 let controller,ids=0,sent=0;
 const connected={status:'connected',role:'A',roomId:'babel-'+id(123)};
 controller=createSessionController({autoStart:true,now:()=>0,randomId:()=>id(++ids),send:()=>{sent++;return true;},
  getSnapshot:()=>({mode:'demo',present:true,expression:{id:'smile'}}),onChange:()=>controller.setConnection(connected)});
 controller.setConnection(connected);
 assert.equal(ids,1);assert.equal(sent,1);assert.equal(controller.state.phase,'starting');
});

test('recording clock retains all 30 seconds even when only 2.9 seconds have fresh samples',()=>{
 const p=pair({autoStart:true});p.flush();p.advance(2400);
 p.setTime(30000);p.A.tick();p.B.tick();p.flush();p.A.finish();p.flush();
 for(const controller of [p.A,p.B]){
  assert.equal(controller.state.local.durationMs,30000);assert.equal(controller.state.local.validMs,2900);
  assert.equal(controller.state.local.missingMs,27100);assert.equal(controller.state.complete,true);
  assert.equal(controller.state.timing.startedAt,0);assert.equal(controller.state.timing.endedAt,30000);
 }
});

test('manual timing is local-only and distinguishes request, recording, and end boundaries',()=>{
 const p=pair();p.setTime(100);p.A.start();p.setTime(150);p.flush();p.advance(400);p.A.finish();p.flush();
 assert.deepEqual(p.A.state.timing,{requestedAt:100,startedAt:150,endedAt:550,startedBy:'manual',endedBy:'local'});
 assert.deepEqual(p.B.state.timing,{requestedAt:150,startedAt:150,endedAt:550,startedBy:'peer',endedBy:'peer'});
 const copied=p.A.state.timing;copied.startedAt=-100;assert.equal(p.A.state.timing.startedAt,150);
 assert.equal('timing' in p.A.state.local,false);assert.equal('timing' in p.B.state.remote,false);
});

test('a delayed ready cannot bypass the starting deadline when no timer tick has run',()=>{
 const p=pair();p.A.start();p.setTime(27100);p.flush();
 assert.equal(p.A.state.phase,'complete');assert.equal(p.A.state.reason,'start-timeout');assert.equal(p.A.state.complete,false);
 assert.equal(p.A.state.timing.startedAt,null);assert.equal(p.A.state.timing.endedBy,'start-timeout');
 assert.equal(p.A.state.local.durationMs,0);assert.equal(p.B.state.phase,'starting');
});

for(const action of ['begin','start'])test(`a delayed ${action} cannot revive an expired guest start before its timeout tick`,()=>{
 const p=pair();p.A.start();const [,startMessage]=p.queue.shift();p.B.receive(startMessage);
 assert.equal(p.B.state.phase,'starting');p.setTime(10001);
 assert.equal(p.B.receive({action,role:'A',sessionId:p.B.state.sessionId}),false);
 assert.equal(p.B.state.phase,'complete');assert.equal(p.B.state.reason,'start-timeout');assert.equal(p.B.state.timing.startedAt,null);
});

for(const action of ['stop','final'])test(`a delayed ${action} cannot successfully finalize an expired guest handshake`,()=>{
 const p=pair();p.drop((_,message)=>message.action==='begin');p.A.start();p.flush();
 assert.equal(p.B.state.phase,'starting');p.setTime(10001);
 const message={action,role:'A',sessionId:p.A.state.sessionId};
 if(action==='final')message.summary=p.A.state.local;
 assert.equal(p.B.receive(message),false);assert.equal(p.B.state.reason,'start-timeout');
 assert.equal(p.B.state.complete,false);assert.equal(p.B.state.timing.startedAt,null);
});

test('late traffic from an earlier round cannot end, restart or expire a new round',()=>{
 const p=pair();p.A.start();p.flush();p.advance(1000);const old=p.A.state.sessionId;
 p.A.finish();p.flush();p.A.start();const fresh=p.A.state.sessionId;p.setTime(12000);
 assert.equal(p.A.receive({action:'ready',role:'B',sessionId:old}),false);
 assert.equal(p.A.receive({action:'stop',role:'B',sessionId:old}),false);
 assert.equal(p.A.state.phase,'starting');assert.equal(p.A.state.sessionId,fresh);assert.equal(p.A.state.timing.endedAt,null);
});

test('a ready solo source automatically records once, finishes offline, and sends no room messages',()=>{
 const p=pair({autoStart:true,connect:false});assert.equal(p.A.state.kind,'solo');assert.equal(p.A.state.phase,'idle');
 assert.equal(p.A.state.canStart,false);p.A.setSource({active:false,mode:'demo'});assert.equal(p.A.state.local,null);
 p.A.setSource({active:true,mode:'demo'});const first=p.A.state.sessionId;
 assert.equal(p.A.state.phase,'recording');assert.equal(p.A.state.role,'A');assert.equal(p.A.state.connected,false);
 assert.equal(p.A.state.canFinish,true);assert.equal(p.A.state.timing.startedBy,'automatic');
 p.advance(500);p.A.setSource({active:true,mode:'demo'});assert.equal(p.A.state.sessionId,first);
 assert.equal(p.A.finish(),true);assert.equal(p.A.state.complete,true);assert.equal(p.A.state.phase,'complete');
 assert.equal(p.A.state.local.durationMs,500);assert.equal(p.A.state.remote,null);assert.equal(p.A.state.canStart,true);
 assert.equal(p.sends.A,0);assert.doesNotMatch(p.A.state.statusText,/同步|等待/);
 p.A.setSource({active:true,mode:'demo'});assert.equal(p.A.state.phase,'complete');assert.equal(p.A.state.sessionId,first);
});

test('manual offline start works when enabled source is active and source-off stops exactly once',()=>{
 const p=pair({connect:false});p.A.setSource({active:true,mode:'demo'});
 assert.equal(p.A.state.phase,'idle');assert.equal(p.A.state.canStart,true);assert.equal(p.A.start(),true);
 p.advance(800);p.A.setSource({active:false,mode:'demo'});
 assert.equal(p.A.state.phase,'complete');assert.equal(p.A.state.complete,true);assert.equal(p.A.state.local.durationMs,800);
 assert.equal(p.A.state.timing.endedBy,'source-off');assert.equal(p.A.state.canStart,false);
 const before=p.A.state.local;p.advance(500);p.A.setSource({active:false,mode:'demo'});
 assert.deepEqual(p.A.state.local,before);assert.equal(p.A.start(),false);assert.equal(p.sends.A,0);
});

test('new source activation starts a new solo round without mixing live and demo records',()=>{
 const p=pair({autoStart:true,connect:false});p.A.setSource({active:true,mode:'demo'});p.advance(600);
 const previous=p.A.state.sessionId;p.A.setSource({active:false,mode:'demo'});
 p.snapshots.A.mode='live';p.A.setSource({active:true,mode:'live'});
 assert.equal(p.A.state.phase,'recording');assert.equal(p.A.state.kind,'solo');assert.equal(p.A.state.local.mode,'live');
 assert.notEqual(p.A.state.sessionId,previous);assert.equal(p.A.state.local.durationMs,0);assert.equal(p.A.state.remote,null);
});

test('joining a duet archives solo results without sending them or emitting a temporary result panel',()=>{
 const p=pair({autoStart:true,connect:false});
 for(const role of ['A','B'])p[role].setSource({active:true,mode:'demo'});
 p.advance(1200);const ids={A:p.A.state.sessionId,B:p.B.state.sessionId};
 const eventStarts={A:p.events.A.length,B:p.events.B.length};
 p.A.setConnection(p.connection('A'));p.B.setConnection(p.connection('B'));p.flush();
 for(const role of ['A','B']){
  const state=p[role].state;
  assert.equal(state.kind,'duet');assert.equal(state.phase,'recording');assert.equal(state.role,role);assert.equal(state.local.durationMs,0);
  assert.equal(state.previousResult.kind,'solo');assert.equal(state.previousResult.complete,true);
  assert.equal(state.previousResult.local.durationMs,1200);assert.equal(state.previousResult.sessionId,ids[role]);
  assert.equal(state.previousResult.timing.endedBy,'joined-room');assert.equal('previousResult' in state.previousResult,false);
  assert.equal(p.events[role].slice(eventStarts[role]).some(event=>event.kind==='solo'&&event.phase==='complete'),false);
  assert.equal(p.sentMessages[role].some(message=>message.sessionId===ids[role]),false);
 }
 const archived=p.A.state.previousResult;archived.local.durationMs=999;assert.equal(p.A.state.previousResult.local.durationMs,1200);
 p.advance(400);assert.equal(p.A.state.local.durationMs,400);assert.equal(p.B.state.local.durationMs,400);
});

test('duet disconnect preserves its partial result until explicit solo start or a new source activation',()=>{
 const p=pair({autoStart:true,connect:false});p.A.setSource({active:true,mode:'demo'});p.B.setSource({active:true,mode:'demo'});
 p.A.setConnection(p.connection('A'));p.B.setConnection(p.connection('B'));p.flush();p.advance(1000);
 const duetId=p.A.state.sessionId;p.A.setConnection({status:'waiting',role:'A',roomId:p.connection('A').roomId});
 p.B.setConnection({status:'disconnected',role:'B',roomId:p.connection('B').roomId});
 assert.equal(p.A.state.kind,'duet');assert.equal(p.A.state.phase,'complete');assert.equal(p.A.state.complete,false);
 p.A.setSource({active:true,mode:'demo'});p.advance(500);
 assert.equal(p.A.state.sessionId,duetId);assert.equal(p.A.state.kind,'duet');assert.equal(p.A.state.local.durationMs,1000);
 const sends=p.sends.A;assert.equal(p.A.start(),true);
 assert.equal(p.A.state.kind,'solo');assert.equal(p.A.state.phase,'recording');assert.equal(p.A.state.remote,null);
 assert.equal(p.A.state.local.durationMs,0);assert.equal(p.A.state.previousResult.kind,'duet');assert.equal(p.A.state.previousResult.sessionId,duetId);
 p.advance(600);p.A.finish();assert.equal(p.A.state.complete,true);assert.equal(p.sends.A,sends);
});

test('completed duet results survive source-off and disconnected room status updates',()=>{
 const p=pair({autoStart:true});p.A.setSource({active:true,mode:'demo'});p.B.setSource({active:true,mode:'demo'});p.flush();
 p.advance(600);p.A.finish();p.flush();const result=p.A.state.local,sessionId=p.A.state.sessionId;
 p.A.setSource({active:false,mode:'demo'});p.A.setConnection({status:'idle',role:null,roomId:null});
 p.A.setConnection({status:'error',role:null,roomId:null});
 assert.equal(p.A.state.kind,'duet');assert.equal(p.A.state.sessionId,sessionId);assert.equal(p.A.state.complete,true);
 assert.deepEqual(p.A.state.local,result);assert.equal(p.A.state.canStart,false);
});

test('solo timer keeps 30 seconds total when fresh expression samples cover only 2.9 seconds',()=>{
 const p=pair({autoStart:true,connect:false});p.A.setSource({active:true,mode:'demo'});p.advance(2400);
 p.setTime(30000);p.A.tick();p.A.finish();
 assert.equal(p.A.state.kind,'solo');assert.equal(p.A.state.complete,true);assert.equal(p.A.state.local.durationMs,30000);
 assert.equal(p.A.state.local.validMs,2900);assert.equal(p.A.state.local.missingMs,27100);assert.equal(p.sends.A,0);
});

test('observed facial actions reach the solo activity timeline while a score alone remains missing',()=>{
 const p=pair({autoStart:true,connect:false});
 p.snapshots.A.mode='live';p.snapshots.A.expression={id:'smile',actions:{smile:.9},score:.8};
 p.snapshots.B.mode='live';p.snapshots.B.expression={id:'smile',score:1};
 p.A.setSource({active:true,mode:'live'});p.B.setSource({active:true,mode:'live'});p.advance(400);
 p.snapshots.A.expression={id:'raised-eyes',actions:{eyeWide:.8,browRaise:.8},score:.9};p.A.observe();p.advance(200);
 p.A.finish();p.B.finish();
 assert.equal(p.A.state.local.timeline.metric,'facial-activity-v1');
 assert.ok(p.A.state.local.timeline.points.some(([,value])=>value>0));
 assert.equal(p.A.state.local.timeline.points.at(-1)[0],600);
 assert.ok(p.B.state.local.timeline.points.every(([,value])=>value===null),'movement-match score is not facial-activity evidence');
 assert.equal(p.B.state.local.counts.find(row=>row.id==='smile').episodes,1,'missing activity does not discard a displayed emoji');
});
