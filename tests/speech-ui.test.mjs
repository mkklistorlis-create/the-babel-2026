import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSpeechUI,CAPTION_FINAL_HOLD_MS} from '../public/speech/speech-ui.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function harness(config={speechConfigured:true,semanticConfigured:true,enabled:true,accessRequired:false}){
 const nodes=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='language'?'auto':'',textContent:'',disabled:false,hidden:false,focus(){this.focused=true;}});return nodes.get(id);};
 let diagnostic={mode:'live',occupancy:'single',ownershipEpoch:1};const sent=[],events=[],timers=new Set(),timeouts=new Map(),deadlines=new Map();let timeoutId=0,sendWorks=true,clock=0;
 class Plugin extends EventTarget{
  constructor(){super();this.language='auto';this.accessCode='';this.active=false;this.startCount=0;this.stopCount=0;}
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  start(){this.startCount++;this.active=true;this.pending=deferred();return this.pending.promise;}
  ready(){this.pending.resolve();this.pending=null;}
  stop(){if(!this.active)return;this.active=false;this.stopCount++;const pending=this.pending;this.pending=null;this.emit('status',{state:'stopped'});pending?.reject(Object.assign(new Error('Stopped'),{code:'STOPPED'}));}
  destroy(){this.stop();this.destroyed=true;}
 }
 const plugin=new Plugin();const platform={document:{getElementById:id=>get(id.replace(/^speech-/,''))},fetch:async()=>({ok:true,json:async()=>config}),setTimeout:(fn,delay)=>{const id=++timeoutId;timeouts.set(id,fn);deadlines.set(id,clock+delay);return id;},clearTimeout:id=>{timeouts.delete(id);deadlines.delete(id);},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),dispatchEvent:event=>events.push(event)};
 const ui=mountSpeechUI({getDiagnostics:()=>diagnostic,sendMeaning:value=>{sent.push(value);return sendWorks;},platform,plugin});
 return{get,plugin,ui,sent,events,timers,timeouts,advance(ms){clock+=ms;for(const [id,fn] of [...timeouts])if(deadlines.get(id)<=clock){timeouts.delete(id);deadlines.delete(id);fn();}},setSendWorks(value){sendWorks=value;},flushTimeout(){const list=[...timeouts.values()];timeouts.clear();for(const fn of list)fn();},setDiagnostic(value){diagnostic={...diagnostic,...value};},tick(){for(const fn of timers)fn();},async start(){const promise=get('start').onclick();plugin.ready();await promise;}};
}
function transcript(h,id='u',text='Hello'){h.plugin.emit('transcript',{utteranceId:id,revision:1,text,language:'en'});}
function meaning(h,id='u',stage='final',text='Hello',value='问好'){h.plugin.emit(stage==='final'?'meaning:final':'meaning:update',{type:'meaning',stage,utteranceId:id,revision:1,language:'en',targetLanguage:h.plugin.targetLanguage,translation:value,text,meaning:value,intent:'greeting',target:'',attributes:[],degree:'none',polarity:'neutral',uncertain:false,evidence:[text],latencyMs:5});}

test('only finalized captions expire after 1.3 seconds; a new utterance cancels the old deadline',async()=>{
 const h=harness();await tick();await h.start();transcript(h,'one','Still speaking');
 h.advance(5000);assert.equal(h.get('source').textContent,'Still speaking');
 h.plugin.emit('transcript',{utteranceId:'one',revision:2,text:'Finished.',final:true});
 h.advance(CAPTION_FINAL_HOLD_MS-1);assert.equal(h.get('source').textContent,'Finished.');
 h.advance(1);assert.equal(h.get('source').textContent,'');assert.equal(h.ui.diagnostics.active,true);
 transcript(h,'one','late duplicate');assert.equal(h.get('source').textContent,'');
 h.plugin.emit('transcript',{utteranceId:'two',revision:1,text:'Second.',final:true});
 const stale=[...h.timeouts.values()][0];transcript(h,'three','New sentence');stale();h.advance(2000);
 assert.equal(h.get('source').textContent,'New sentence');h.ui.destroy();assert.equal(h.timeouts.size,0);
});
test('remote final expiry preserves ordering and never clears a newer translation',async()=>{
 const h=harness();await tick();h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'en'});
 const value={type:'meaning',speakerId:'B',utteranceId:'one',turnOrder:1,revision:1,language:'en',targetLanguage:'zh',text:'Hello',translation:'你好',stage:'partial'};
 h.ui.receiveMeaning(value);h.advance(4000);assert.equal(h.get('remote-meaning').textContent,'你好');
 h.ui.receiveMeaning({...value,stage:'final'});h.advance(CAPTION_FINAL_HOLD_MS);assert.equal(h.get('remote-meaning').textContent,'');
 h.ui.receiveMeaning({...value,stage:'final'});assert.equal(h.get('remote-meaning').textContent,'');
 h.ui.receiveMeaning({...value,utteranceId:'two',turnOrder:2,stage:'final'});const stale=[...h.timeouts.values()][0];
 h.ui.receiveMeaning({...value,utteranceId:'three',turnOrder:3,translation:'下一句'});stale();h.advance(2000);
 assert.equal(h.get('remote-meaning').textContent,'下一句');h.ui.destroy();assert.equal(h.timeouts.size,0);
});

test('unconfigured speech remains disabled and never starts microphone',async()=>{
 const h=harness({speechConfigured:false,semanticConfigured:false,enabled:false});await tick();
 assert.equal(h.get('start').disabled,true);await h.get('start').onclick();assert.equal(h.plugin.startCount,0);assert.match(h.get('caption-state').textContent,/尚未配置/);h.ui.destroy();
});
test('entry can start before configuration and face tracking settle, without an access code',async()=>{
 const h=harness();h.setDiagnostic({occupancy:'empty'});
 const pending=h.ui.start();assert.equal(h.plugin.startCount,1);h.plugin.ready();await pending;
 assert.equal(h.plugin.accessCode,'');assert.equal(h.get('stop').hidden,false);
 h.setDiagnostic({occupancy:'multiple',ownershipEpoch:5});h.tick();assert.equal(h.ui.diagnostics.active,true);
 h.setDiagnostic({mode:'idle'});h.tick();assert.equal(h.ui.diagnostics.active,false);h.ui.destroy();
});
test('late startup rejection after stop cannot clear a newer microphone session',async()=>{
 const h=harness();await tick();const first=h.get('start').onclick();h.get('stop').onclick();const second=h.get('start').onclick();await first;
 assert.equal(h.ui.diagnostics.active,true);assert.equal(h.get('stop').disabled,false);h.plugin.ready();await second;assert.match(h.get('caption-state').textContent,/请说话/);h.ui.destroy();
});
test('permission denial offers retry and tracking updates never silently reopen the microphone',async()=>{
 const h=harness();await tick();const pending=h.ui.start();
 h.plugin.emit('error',{fatal:true,code:'NotAllowedError',message:'Permission denied'});await pending;
 assert.equal(h.ui.diagnostics.active,false);assert.equal(h.get('start').hidden,false);
 assert.match(h.get('caption-state').textContent,/未获授权/);
 h.setDiagnostic({occupancy:'single',ownershipEpoch:8});h.tick();h.tick();assert.equal(h.plugin.startCount,1);
 await h.start();assert.equal(h.plugin.startCount,2);h.ui.destroy();
});
test('partial and final translations are shared without replacing the current live view with an old final',async()=>{
 const h=harness();await tick();h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});await h.start();
 transcript(h,'old');meaning(h,'old','partial','Hello','早期含义');assert.equal(h.sent.length,1);assert.equal(h.sent[0].targetLanguage,'ja');
 transcript(h,'new','Next');meaning(h,'new','partial','Next','当前含义');meaning(h,'old','final','Hello','旧句最终含义');
 assert.equal(h.get('meaning').textContent,'[暂定] 当前含义');assert.equal(h.sent.length,3);assert.equal(h.sent[2].utteranceId,'old');
 meaning(h,'new','final','Next','当前最终含义');assert.equal(h.sent.length,4);assert.equal(h.ui.diagnostics.latest.speakerId,'A');h.ui.destroy();
});
test('connected remote participant does not count as multiple people in the local camera',async()=>{
 const h=harness();await tick();h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});await h.start();h.tick();assert.equal(h.ui.diagnostics.active,true);
 h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});assert.equal(h.ui.diagnostics.active,true);
 h.setDiagnostic({occupancy:'multiple'});h.tick();assert.equal(h.ui.diagnostics.active,true);assert.equal(h.plugin.stopCount,0);h.ui.destroy();
});
test('remote text is rendered as text and rejected after disconnect or from the local role',async()=>{
 const h=harness();await tick();h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});
 const value={type:'meaning',stage:'final',utteranceId:'u',revision:1,speakerId:'B',text:'<img onerror=bad()>',translation:'<script>bad()</script>',targetLanguage:'zh',language:'es'};
 h.ui.receiveMeaning(value);assert.equal(h.get('remote-source').textContent,value.text);assert.equal(h.get('remote-meaning').textContent,value.translation);
 h.ui.receiveMeaning({...value,speakerId:'A',meaning:'wrong role'});assert.equal(h.get('remote-meaning').textContent,value.translation);
 h.ui.receiveMeaning({type:'reset',speakerId:'B'});assert.equal(h.get('remote-meaning').textContent,'');
 h.ui.setConnection({status:'waiting',roomId:'room',role:'A',remoteLanguage:'ja'});h.ui.receiveMeaning(value);assert.equal(h.ui.diagnostics.remote,null);h.ui.destroy();
});
test('room transitions clear old captions while microphone stays open',async()=>{
 const h=harness();await tick();h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});await h.start();transcript(h);meaning(h);
 h.ui.setConnection({status:'waiting',roomId:'room',role:'A',remoteLanguage:'ja'});assert.equal(h.plugin.stopCount,0);assert.equal(h.ui.diagnostics.latest,null);meaning(h);assert.equal(h.ui.diagnostics.latest,null);
 h.setDiagnostic({ownershipEpoch:2});h.tick();assert.equal(h.ui.diagnostics.active,true);h.ui.destroy();
});
test('destroy stops microphone, removes callbacks/timer and clears access code',async()=>{
 const h=harness();await tick();await h.start();h.ui.destroy();
 assert.equal(h.plugin.destroyed,true);assert.equal(h.plugin.active,false);assert.equal(h.plugin.accessCode,'');assert.equal(h.timers.size,0);
 meaning(h);assert.equal(h.ui.diagnostics.latest,null);assert.equal(h.get('start').onclick,null);
});

test('leaving camera mode blocks a late speech result before the timer ticks',async()=>{
 const h=harness();await tick();h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});await h.start();transcript(h);
 h.setDiagnostic({mode:'idle'});meaning(h);
 assert.equal(h.ui.diagnostics.active,false);assert.equal(h.sent.filter(value=>value.stage==='final').length,0);assert.equal(h.sent.at(-1).type,'reset');h.ui.destroy();
});
test('a failed reset has bounded retries and a new speech start cancels the old reset',async()=>{
 const h=harness();await tick();h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});await h.start();h.setSendWorks(false);h.ui.stop();
 assert.equal(h.timeouts.size,1);h.flushTimeout();assert.equal(h.sent.length,2);
 await h.start();assert.equal(h.timeouts.size,0);h.flushTimeout();assert.equal(h.sent.length,2);
 h.ui.stop();for(let i=0;i<10;i++)h.flushTimeout();assert.equal(h.timeouts.size,0);assert.equal(h.sent.length,10);assert.match(h.get('caption-state').textContent,/暂未能清除/);h.ui.destroy();
});
test('disconnect and destruction cancel queued resets',async()=>{
 const h=harness();await tick();h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});await h.start();h.setSendWorks(false);h.ui.stop();assert.equal(h.timeouts.size,1);
 h.ui.setConnection({status:'waiting',roomId:'room',role:'A',remoteLanguage:'ja'});assert.equal(h.timeouts.size,0);
 h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});await h.start();h.ui.stop();assert.equal(h.timeouts.size,1);h.ui.destroy();assert.equal(h.timeouts.size,0);
});

test('language choice configures recognition and receiving language; peer language sets outgoing translation',async()=>{
 const h=harness();await tick();h.get('language').value='en';h.get('language').onchange();
 h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});await h.start();
 assert.equal(h.ui.language,'en');assert.equal(h.plugin.language,'en');assert.equal(h.plugin.targetLanguage,'ja');
 h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'es'});
 assert.equal(h.plugin.targetLanguage,'es');assert.equal(h.plugin.stopCount,0);assert.equal(h.ui.diagnostics.active,true);
 const base={type:'meaning',speakerId:'B',utteranceId:'one',revision:1,language:'ja',text:'こんにちは',translation:'Hello',targetLanguage:'en',stage:'partial'};
 h.ui.receiveMeaning(base);assert.equal(h.get('remote-meaning').textContent,'Hello');
 h.ui.receiveMeaning({...base,stage:'final',translation:'Hello!'});assert.equal(h.get('remote-meaning').textContent,'Hello!');
 h.ui.receiveMeaning({...base,translation:'stale'});assert.equal(h.get('remote-meaning').textContent,'Hello!');
 h.ui.receiveMeaning({...base,utteranceId:'two',translation:'Next'});
 h.ui.receiveMeaning({...base,stage:'final',revision:2,translation:'old turn'});assert.equal(h.get('remote-meaning').textContent,'Next');
 h.ui.receiveMeaning({...base,utteranceId:'three',targetLanguage:'zh',translation:'wrong language'});assert.equal(h.get('remote-meaning').textContent,'Next');
 h.ui.destroy();
});

test('solo transcript stays in bottom caption region and unknown peer language is never guessed for sharing',async()=>{
 const h=harness();await tick();await h.start();transcript(h,'one','First');transcript(h,'one','First sentence');
 assert.equal(h.get('source').textContent,'First sentence');assert.equal(h.get('captions').hidden,false);assert.equal(h.get('remote').hidden,true);
 h.ui.setConnection({status:'connected',roomId:'room',role:'A'});transcript(h);meaning(h);
 assert.equal(h.sent.length,0);h.ui.destroy();
});

test('an unseen delayed final cannot replace a newer translated turn; source order survives microphone restart',async()=>{
 const h=harness();await tick();h.ui.setConnection({status:'connected',roomId:'room',role:'A',remoteLanguage:'ja'});await h.start();
 transcript(h,'first');transcript(h,'second');meaning(h,'second');meaning(h,'first');
 assert.deepEqual(h.sent.map(x=>x.turnOrder),[2,1]);h.ui.stop();await h.start();transcript(h,'third');meaning(h,'third');assert.equal(h.sent.at(-1).turnOrder,3);
 const value={type:'meaning',speakerId:'B',utteranceId:'new',turnOrder:2,revision:1,language:'en',targetLanguage:'zh',text:'Now',translation:'现在',stage:'partial'};
 h.ui.receiveMeaning(value);h.ui.receiveMeaning({...value,utteranceId:'never-seen-old',turnOrder:1,stage:'final',translation:'旧句'});
 assert.equal(h.get('remote-meaning').textContent,'现在');h.ui.destroy();
});
