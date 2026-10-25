import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {EXPRESSION_LIBRARY,createExpressionTracker,expressionForDemo} from '../public/expressions.js';
import {createSessionController as createRealSessionController} from '../public/session-controller.js';

// Actual app entry point with media/GPU boundaries replaced; no network permitted.
function appHarness({startError,recordSessions=false}={}){
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,{id,hidden: ['debug','transport'].includes(id),checked:false,value:'',textContent:'',attributes:{},setAttribute(name,value){this.attributes[name]=value;},focus(){},add(){}}]));
 let trackerCallbacks,renderer,raf,roomOptions,sessionOptions,sessionController,sessionState={phase:'idle'},now=100,stops=0,starts=0,networkCalls=0,sessionIds=0;
 const lifecycle=[];
 class Canvas{constructor(){renderer=this;this.state={};this.fps=60;this.rendererType='CPU fixture';}setState(s){Object.assign(this.state,s);}setPointer(){}destroy(){}}
 const person={id:'local',faceSeen:true,stale:false,faceBBox:{x:.4,y:.2,width:.2,height:.25},facialActions:{smile:0},hands:[{id:'left'},{id:'right'}]};
 const globals={console,EXPRESSION_LIBRARY,createExpressionTracker,expressionForDemo,DuetCanvas:Canvas,mountRoomUI:options=>{roomOptions=options;return {leave(){lifecycle.push('room-leave');},closePanel(){},destroy(){lifecycle.push('room-destroy');},panelOpen:false,diagnostics:{status:'idle'}};},
  createSessionController:options=>{sessionOptions=options;sessionController=recordSessions?createRealSessionController({...options,send:()=>true,now:()=>now,randomId:()=> (++sessionIds).toString(16).padStart(32,'0')}):{get state(){return sessionState;},setConnection(s){sessionState={...sessionState,connection:s};},receive(s){sessionState={...sessionState,message:s};},start(){},finish(){},observe(){},tick(){},destroy(){}};return sessionController;},
  mountSessionResults:()=>({update(){},close(){},destroy(){},panelOpen:false}),
  mountSpeechUI:()=>({stop(){},destroy(){},setConnection(){},receiveMeaning(){},diagnostics:{active:false}}),
  getDemoPeople:()=>[person],createTracker:callbacks=>{trackerCallbacks=callbacks;return {async start(){starts++;if(startError)throw new Error(startError);},stop(){stops++;lifecycle.push('tracker-stop');}};},
  document:{getElementById:id=>nodes.get(id)||null,body:{classList:{add(){},remove(){}}}},window:{addEventListener(){}},Option:class{},innerWidth:1280,innerHeight:720,
  performance:{now:()=>now},Date,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},requestAnimationFrame:callback=>{raf=callback;return 1;},cancelAnimationFrame(){},
  fetch(){networkCalls++;throw new Error('R07 must not request speech/semantic services');},
 };
 const context=vm.createContext(globals);
 vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
 return {nodes,renderer,context,lifecycle,get roomOptions(){return roomOptions;},get sessionOptions(){return sessionOptions;},get sessionController(){return sessionController;},get stops(){return stops;},get starts(){return starts;},get networkCalls(){return networkCalls;},
  start:()=>nodes.get('start').onclick(),frame(time){now=time;raf(time);},setTime(time){now=time;},status:event=>trackerCallbacks.onStatus(event),
  observation(occupancy,options={}){trackerCallbacks.onFrame({people:occupancy==='single'?[{...person,faceObservedAt:now}]:[],count:occupancy==='single'?1:0,occupancy,countGuardHealthy:true,ownershipEpoch:1,observedPeopleCount:occupancy==='multiple'?2:occupancy==='single'?1:0,faceCount:occupancy==='multiple'?2:1,poseCount:1,latencyMs:40,...options});},
 };
}

test('R07 starts camera only, no audio/semantic APIs or controls',async()=>{
 const h=appHarness();await h.start();h.observation('single');h.frame(200);
 assert.equal(h.starts,1);assert.equal(h.networkCalls,0);
 assert.equal(h.renderer.state.interactionsEnabled,true);assert.equal(h.renderer.state.people[0].hands.length,2);
 assert.equal(h.context.window.betweenUs.diagnostics.microphone,false);
 assert.equal(h.context.window.betweenUs.diagnostics.semantics,false);
 assert.equal(h.nodes.has('words'),false);assert.equal(h.nodes.has('language-zh'),false);assert.equal(h.nodes.has('demo-speaking'),false);
 h.nodes.get('exit').onclick();assert.equal(h.stops,1);assert.equal(h.nodes.get('intro').hidden,false);assert.equal(h.renderer.state.expression.visible,false);
});

test('multiple people and stale/failed tracking revoke emoji and hand attribution immediately',async()=>{
 const h=appHarness();await h.start();h.observation('single');h.frame(200);
 assert.equal(h.renderer.state.expression.visible,true);
 h.observation('multiple',{ownershipEpoch:2});h.frame(300);
 assert.equal(h.renderer.state.interactionsEnabled,false);assert.equal(h.renderer.state.expression.visible,false);assert.match(h.nodes.get('status').textContent,/只有一人/);
 h.status({kind:'tracking',state:'ready',message:'单人追踪继续'});assert.match(h.nodes.get('status').textContent,/只有一人/);
 h.observation('single',{ownershipEpoch:3});h.frame(400);assert.equal(h.renderer.state.interactionsEnabled,true);assert.doesNotMatch(h.nodes.get('status').textContent,/检测到多人/);
 h.frame(1200);assert.equal(h.renderer.state.interactionsEnabled,false);assert.equal(h.renderer.state.expression.visible,false);
 h.observation('single',{frameTimestamp:100});h.frame(1210);assert.equal(h.renderer.state.interactionsEnabled,false,'newly delivered but old camera frame cannot authorize overlays');
 h.observation('single',{countGuardHealthy:false});h.frame(1250);assert.equal(h.renderer.state.interactionsEnabled,false);
 h.observation('single');h.status({kind:'tracking',state:'recovering',message:'正在恢复'});h.frame(1300);assert.equal(h.renderer.state.interactionsEnabled,false);
});

test('only sustained fresh face observations change emoji, never speech text',async()=>{
 const h=appHarness();await h.start();
 for(let t=100;t<1200;t+=80){h.frame(t);h.observation('single',{people:[{id:'local',faceSeen:true,stale:false,faceObservedAt:t,facialActions:{smile:.95},hands:[]}]});}
 h.frame(1200);assert.equal(h.renderer.state.expression.id,'smile');
 h.observation('single',{people:[{id:'local',faceSeen:false,stale:false,facialActions:null,hands:[]}]});h.frame(1250);
 assert.equal(h.renderer.state.expression.visible,false);assert.equal(h.networkCalls,0);
});

test('six/seven has a bounded CPU gesture budget independent of the face display timeout',async()=>{
 const h=appHarness();await h.start();h.frame(1000);
 h.observation('single',{frameTimestamp:550});h.frame(1480);
 assert.equal(h.renderer.state.interactionsEnabled,false,'existing 900ms face/ink budget is preserved');
 assert.equal(h.renderer.state.gestureEnabled,true,'waiting for the next CPU result must not erase the gesture');
 assert.equal(h.renderer.state.gestureOwner,'1:local');
 h.observation('single',{frameTimestamp:1030});h.frame(1960);
 assert.equal(h.renderer.state.gestureEnabled,true);
 assert.match(h.nodes.get('gesture-status').textContent,/6 \/ 7/);
 h.frame(2900);assert.equal(h.renderer.state.gestureEnabled,false,'a stalled tracker still expires');
 h.observation('single',{frameTimestamp:2850});h.frame(2950);assert.equal(h.renderer.state.gestureEnabled,true);
 h.observation('multiple',{ownershipEpoch:2});h.frame(3000);assert.equal(h.renderer.state.gestureEnabled,false);
 h.observation('single',{countGuardHealthy:false});h.frame(3050);assert.equal(h.renderer.state.gestureEnabled,false);
 h.observation('single');h.status({kind:'tracking',state:'recovering'});h.frame(3100);assert.equal(h.renderer.state.gestureEnabled,false);
});

test('demo is explicitly simulated, has two hands and cycles through expression library',()=>{
 const h=appHarness();h.nodes.get('demo').onclick();h.frame(200);
 assert.equal(h.renderer.state.mode,'demo');assert.equal(h.renderer.state.count,1);assert.equal(h.renderer.state.people[0].hands.length,2);
 const before=h.renderer.state.expression.id;h.nodes.get('stage').onpointerdown({clientX:300,clientY:200});h.frame(300);
 assert.notEqual(h.renderer.state.expression.id,before);assert.equal(h.renderer.state.expression.visible,true);assert.equal(h.starts,0);
 h.nodes.get('pause').onclick();h.frame(400);assert.equal(h.renderer.state.paused,true);
});

test('camera startup failure is visible and never falls back to fake live data',async()=>{
 const h=appHarness({startError:'permission fixture'});await h.start();h.frame(200);
 assert.equal(h.nodes.get('debug').hidden,false);assert.match(h.nodes.get('status').textContent,/permission fixture/);
 assert.equal(h.renderer.state.count,0);assert.equal(h.renderer.state.expression.visible,false);assert.equal(h.networkCalls,0);
});

test('room source preparation reuses a ready camera and tears the room down before stopping it',async()=>{
 const h=appHarness();
 assert.equal(await h.roomOptions.prepareSource('live'),true);
 assert.equal(await h.roomOptions.prepareSource('live'),true);assert.equal(h.starts,1);
 h.observation('single');h.frame(200);
 assert.equal(h.roomOptions.getSnapshot().present,true);
 h.frame(1200);assert.equal(h.roomOptions.getSnapshot().present,false);
 h.nodes.get('exit').onclick();
 assert.deepEqual(h.lifecycle,['room-leave','tracker-stop']);
});

test('room source preparation cannot broadcast a failed camera or silently choose a demo',async()=>{
 const h=appHarness({startError:'permission fixture'});
 assert.equal(await h.roomOptions.prepareSource('live'),false);
 assert.equal(await h.roomOptions.prepareSource('demo'),false);
 assert.equal(h.roomOptions.getSnapshot().present,false);
 assert.equal(h.context.window.betweenUs.diagnostics.mode,'live');
});

test('session statistics receives stable expression state and pauses for hidden or paused views',async()=>{
 const h=appHarness();await h.start();h.observation('single');h.frame(200);
 assert.equal(h.sessionOptions.getSnapshot().present,true);
 assert.equal(h.sessionOptions.getSnapshot().expression.id,'neutral');
 assert.equal(h.sessionOptions.getSnapshot().paused,false);
 h.nodes.get('pause').onclick();assert.equal(h.sessionOptions.getSnapshot().paused,true);
 h.nodes.get('pause').onclick();h.context.document.hidden=true;
 assert.equal(h.sessionOptions.getSnapshot().paused,true);
 h.context.document.hidden=false;h.frame(1300);
 assert.equal(h.sessionOptions.getSnapshot().present,false);
 h.roomOptions.onConnectionState({status:'connected',role:'B',roomId:'test'});
 assert.equal(h.context.window.betweenUs.diagnostics.session.connection.role,'B');
 h.roomOptions.onSession({kind:'test'});
 assert.equal(h.context.window.betweenUs.diagnostics.session.message.kind,'test');
});

function startStatistics(h){
 h.roomOptions.onConnectionState({status:'connected',role:'A',roomId:'room'});
 assert.equal(h.sessionController.state.phase,'starting','connecting starts the first round without a second button');
 h.roomOptions.onSession({action:'ready',role:'B',sessionId:h.sessionController.state.sessionId});
 assert.equal(h.sessionController.state.phase,'recording');
}

test('app forwards rapid demo changes before the next statistics tick or rendered frame',()=>{
 const h=appHarness({recordSessions:true});h.nodes.get('demo').onclick();h.frame(200);startStatistics(h);
 h.setTime(240);h.nodes.get('demo-expression').onchange({target:{value:'wink'}});
 h.setTime(270);h.nodes.get('demo-expression').onchange({target:{value:'smile'}});
 h.setTime(290);h.nodes.get('demo-expression').onchange({target:{value:'neutral'}});
 const result=h.sessionController.state.local;
 assert.equal(result.counts.find(x=>x.id==='wink').episodes,1);
 assert.equal(result.counts.find(x=>x.id==='wink').durationMs,30);
 assert.equal(result.counts.find(x=>x.id==='smile').episodes,1);
 assert.equal(result.counts.find(x=>x.id==='smile').durationMs,20);
 assert.equal(result.counts.find(x=>x.id==='neutral').episodes,2);
});

test('camera output is recorded immediately and loss of tracking closes a short expression',async()=>{
 const h=appHarness({recordSessions:true});await h.start();h.observation('single');h.frame(200);startStatistics(h);
 for(const t of [220,320,420,520]){
  h.setTime(t);h.observation('single',{people:[{id:'local',faceSeen:true,stale:false,faceObservedAt:t,facialActions:{smile:.95},hands:[]}]});
 }
 assert.equal(h.renderer.state.expression.id,'smile');
 assert.equal(h.sessionController.state.local.counts.find(x=>x.id==='smile').episodes,1,'no periodic statistics tick has run');
 h.setTime(540);h.status({kind:'tracking',state:'recovering'});
 assert.equal(h.sessionController.state.local.counts.find(x=>x.id==='smile').durationMs,20);
 h.setTime(700);h.sessionController.tick();
 assert.equal(h.sessionController.state.local.counts.find(x=>x.id==='smile').durationMs,20);
 assert.equal(h.sessionController.state.local.missingMs,160);
});
