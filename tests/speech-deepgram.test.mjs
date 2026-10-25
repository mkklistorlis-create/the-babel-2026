import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createDeepgramStream} from '../lib/speech/deepgram.mjs';

class MockSocket extends EventEmitter {
  static instances = [];
  constructor(url, options) { super(); this.url = url; this.options = options; this.bufferedAmount = 0; this.sent = []; this.closed = false; MockSocket.instances.push(this); }
  send(data, options) { this.sent.push({data, options}); }
  close() { this.closed = true; this.emit('close', 1000); }
  result(text, start, end, extra = {}) {
    this.emit('message', Buffer.from(JSON.stringify({type:'Results', start, duration:end-start,
      channel:{alternatives:[{transcript:text, words:text ? [{word:text,start,end,language:'en'}] : []}]}, ...extra})));
  }
}
function setup(t, language = 'auto') {
  const transcripts = [], errors = [], closes = []; let ready = 0;
  const stream = createDeepgramStream({apiKey:'secret-example', language, WebSocketImpl:MockSocket,
    onTranscript:x => transcripts.push(x), onError:x => errors.push(x), onClose:x => closes.push(x), onReady:() => ready++});
  const ws = MockSocket.instances.at(-1); t.after(() => stream.close());
  return {stream, ws, transcripts, errors, closes, get ready(){return ready;}};
}
function scoredResult(s, text, confidence, extra = {}) {
  s.ws.result(text,0,.4,{channel:{alternatives:[{transcript:text,confidence,
    words:[{word:text,start:0,end:.4,language:'zh',confidence}]}]},...extra});
}
test('startup noise produces neither interim nor final captions; a corrected first word appears immediately', t => {
  const s=setup(t,'zh'); s.ws.emit('open');
  scoredResult(s,'无意义的猜测',.12);
  scoredResult(s,'无意义的猜测',.24,{is_final:true,speech_final:true});
  s.ws.emit('message',JSON.stringify({type:'UtteranceEnd',last_word_end:.4}));
  assert.equal(s.transcripts.length,0);
  scoredResult(s,'你好',.94);
  assert.equal(s.transcripts.length,1);
  assert.equal(s.transcripts[0].text,'你好');
  assert.equal(s.transcripts[0].revision,1);
  assert.equal(s.transcripts[0].final,false);
  scoredResult(s,'你好',.98,{is_final:true,speech_final:true});
  assert.equal(s.transcripts.at(-1).final,true);
  assert.deepEqual(s.errors,[]);
});
test('startup guard accepts short speech at the threshold and leaves subsequent revisions untouched', t => {
  const s=setup(t,'zh'); s.ws.emit('open');
  scoredResult(s,'好',.65);
  scoredResult(s,'好的',.3);
  assert.deepEqual(s.transcripts.map(x=>x.text),['好','好的']);
  scoredResult(s,'好的',.3,{is_final:true,speech_final:true});
  s.ws.result('下一句',1,1.4,{channel:{alternatives:[{transcript:'下一句',confidence:.3}]}});
  assert.equal(s.transcripts.at(-1).text,'下一句');
  const next=setup(t,'zh'); next.ws.emit('open');
  scoredResult(next,'噪音',.3);
  assert.equal(next.transcripts.length,0);
});
test('startup guard falls back to word confidence and tolerates omitted scores', t => {
  const s=setup(t,'zh'); s.ws.emit('open');
  s.ws.result('噪音',0,.4,{channel:{alternatives:[{transcript:'噪音',words:[{start:0,end:.4,confidence:.1}]}]}});
  assert.equal(s.transcripts.length,0);
  s.ws.result('你好',0,.4);
  assert.equal(s.transcripts.at(-1).text,'你好');
});
test('configures four-language streaming and waits for upstream readiness', t => {
  const s=setup(t), url=new URL(s.ws.url);
  assert.equal(url.searchParams.get('model'),'nova-3');
  assert.deepEqual(url.searchParams.getAll('language_hint'),['zh','en','ja','es']);
  assert.equal(url.searchParams.get('encoding'),'linear16');
  assert.equal(s.stream.sendAudio(Buffer.alloc(4)),false);
  s.ws.emit('open'); assert.equal(s.ready,1);
  assert.equal(s.stream.sendAudio(Buffer.alloc(4)),true);
});
test('replaces interim, accumulates finalized segments, emits final even for identical text', t => {
  const s=setup(t); s.ws.emit('open');
  s.ws.result('I',0,.2); s.ws.result('I like',0,.5);
  s.ws.result('I like',0,.5,{is_final:true});
  s.ws.result('music',.5,1);
  s.ws.result('music',.5,1,{is_final:true,speech_final:true});
  assert.deepEqual(s.transcripts.map(x=>[x.text,x.final]),[['I',false],['I like',false],['I like music',false],['I like music',true]]);
  assert.equal(new Set(s.transcripts.map(x=>x.utteranceId)).size,1);
  assert.deepEqual(s.transcripts.map(x=>x.revision),[1,2,3,4]);
});
test('deduplicates segments and delayed boundaries without finalizing a newer turn', t => {
  const s=setup(t); s.ws.emit('open');
  s.ws.result('yes',0,.4,{is_final:true,speech_final:true});
  s.ws.result('yes',0,.4,{is_final:true,speech_final:true});
  s.ws.result('next',2,2.4);
  s.ws.emit('message',JSON.stringify({type:'UtteranceEnd',last_word_end:.4}));
  assert.equal(s.transcripts.length,2); assert.equal(s.transcripts.at(-1).final,false);
  s.ws.result('next',2,2.4,{is_final:true});
  s.ws.emit('message',JSON.stringify({type:'UtteranceEnd',last_word_end:2.4}));
  assert.equal(s.transcripts.at(-1).final,true);
  assert.notEqual(s.transcripts[0].utteranceId,s.transcripts.at(-1).utteranceId);
});
test('detects mixed language from committed and interim words', t => {
  const s=setup(t); s.ws.emit('open');
  s.ws.result('hello',0,.4,{is_final:true});
  s.ws.result('你好',.4,.8,{channel:{alternatives:[{transcript:'你好',words:[{word:'你好',start:.4,end:.8,language:'zh-CN'}]}]}});
  assert.equal(s.transcripts.at(-1).language,'mixed');
});
test('close releases timers and ignores queued data and errors', t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const s=setup(t); s.ws.emit('open');
  t.mock.timers.tick(4000); assert.equal(s.ws.sent.length,1);
  s.stream.close(); t.mock.timers.tick(20000);
  s.ws.result('late',0,1,{speech_final:true}); s.ws.emit('error',new Error('secret-example'));
  assert.equal(s.ws.sent.length,1); assert.equal(s.transcripts.length,0); assert.equal(s.errors.length,0); assert.equal(s.closes.length,0);
});
test('times out handshake and sanitizes provider errors', t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const s=setup(t); t.mock.timers.tick(10001);
  assert.equal(s.errors[0].code,'SPEECH_CONNECTION_TIMEOUT'); assert.equal(s.ws.closed,true);
  const s2=setup(t); s2.ws.emit('error',new Error('secret-example'));
  assert.equal(s2.errors[0].message.includes('secret-example'),false);
});
test('bounds queued audio, reports unexpected closes and rejects oversized utterances', t => {
  const s=setup(t); s.ws.emit('open'); s.ws.bufferedAmount=262144;
  assert.equal(s.stream.sendAudio(Buffer.alloc(2)),false); assert.equal(s.errors[0].code,'SPEECH_BACKPRESSURE');
  const s2=setup(t); s2.ws.emit('open'); s2.ws.emit('close',1006);
  assert.equal(s2.closes.length,1); assert.equal(s2.stream.sendAudio(Buffer.alloc(2)),false);
  const s3=setup(t); s3.ws.emit('open'); s3.ws.result('字'.repeat(2001),0,100);
  assert.equal(s3.errors[0].code,'SPEECH_UTTERANCE_LIMIT'); assert.equal(s3.transcripts.length,0);
});
test('UtteranceEnd never upgrades an interim and waits for a covering finalized result', t => {
  const s=setup(t); s.ws.emit('open');
  s.ws.result('I like',0,.5,{is_final:true});
  s.ws.result('wrong',.5,1);
  s.ws.emit('message',JSON.stringify({type:'UtteranceEnd',last_word_end:1}));
  assert.equal(s.transcripts.some(x=>x.final),false);
  s.ws.result('music',.5,1,{is_final:true});
  assert.equal(s.transcripts.at(-1).text,'I like music');
  assert.equal(s.transcripts.at(-1).final,true);
  assert.equal(s.transcripts.filter(x=>x.final).length,1);
});
test('an older endpoint cannot finalize a later committed extension', t => {
  const s=setup(t); s.ws.emit('open');
  s.ws.result('I like',0,.5,{is_final:true});
  s.ws.result('music',.5,1);
  s.ws.emit('message',JSON.stringify({type:'UtteranceEnd',last_word_end:.5}));
  s.ws.result('music',.5,1,{is_final:true});
  assert.equal(s.transcripts.some(x=>x.final),false);
  s.ws.emit('message',JSON.stringify({type:'UtteranceEnd',last_word_end:1}));
  assert.equal(s.transcripts.at(-1).text,'I like music');
  assert.equal(s.transcripts.at(-1).final,true);
});
test('speech_final alone cannot certify an unfinalized hypothesis', t => {
  const s=setup(t); s.ws.emit('open');
  s.ws.result('uncertain',0,1,{speech_final:true,is_final:false});
  assert.equal(s.transcripts.length,1); assert.equal(s.transcripts[0].final,false);
  s.ws.result('certain',0,1,{speech_final:true,is_final:true});
  assert.equal(s.transcripts.at(-1).text,'certain'); assert.equal(s.transcripts.at(-1).final,true);
});
test('empty interim retracts ghost text but preserves committed text and future windows', t => {
  const s=setup(t); s.ws.emit('open');
  s.ws.result('ghost',0,1); s.ws.result('',0,1);
  assert.equal(s.transcripts.at(-1).text,''); assert.equal(s.transcripts.at(-1).revision,2);
  s.ws.result('hello',0,.5,{is_final:true});
  s.ws.result('ghost',.5,1); s.ws.result('',.5,1);
  assert.equal(s.transcripts.at(-1).text,'hello');
  s.ws.result('world',2,3); s.ws.result('',.5,1);
  assert.equal(s.transcripts.at(-1).text,'hello world');
  s.ws.result('hello',0,.5,{is_final:true,speech_final:true});
  assert.equal(s.transcripts.some(x=>x.final),false);
  s.ws.result('world',2,3,{is_final:true,speech_final:true});
  assert.equal(s.transcripts.at(-1).text,'hello world'); assert.equal(s.transcripts.at(-1).final,true);
});
test('finalizing an earlier segment keeps a later interim until its own confirmation', t => {
  const s=setup(t); s.ws.emit('open');
  s.ws.result('world',.5,1);
  s.ws.result('hello',0,.5,{is_final:true,speech_final:true});
  assert.equal(s.transcripts.at(-1).text,'hello world'); assert.equal(s.transcripts.some(x=>x.final),false);
  s.ws.result('world',.5,1,{is_final:true,speech_final:true});
  assert.equal(s.transcripts.at(-1).text,'hello world'); assert.equal(s.transcripts.at(-1).final,true);
});
test('joins adjacent Chinese and Japanese segments without artificial spaces', t => {
  const s=setup(t,'zh'); s.ws.emit('open');
  s.ws.result('你好，',0,.5,{is_final:true});
  s.ws.result('世界。',.5,1,{is_final:true,speech_final:true});
  assert.equal(s.transcripts.at(-1).text,'你好，世界。');
  const s2=setup(t,'ja'); s2.ws.emit('open');
  s2.ws.result('音楽が',0,.5,{is_final:true});
  s2.ws.result('好きです。',.5,1,{is_final:true,speech_final:true});
  assert.equal(s2.transcripts.at(-1).text,'音楽が好きです。');
});
