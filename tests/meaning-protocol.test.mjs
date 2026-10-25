import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMeaningMessage,meaningMessageFits,MAX_MEANING_BYTES} from '../public/meaning-protocol.js';
import {readMessage} from '../public/room-protocol.js';

const detail=(extra={})=>({type:'meaning',stage:'final',utteranceId:'turn-1',revision:2,language:'zh',
 text:'我觉得这个设计有点太复杂了',meaning:'说话者认为当前设计略显复杂。',intent:'evaluate',target:'这个设计',
 attributes:['复杂'],degree:'mild',polarity:'negative',uncertain:false,evidence:['有点太复杂'],latencyMs:650,...extra});

test('translation carries a bounded whitelisted target language',()=>{
 assert.equal(normalizeMeaningMessage(detail({targetLanguage:'ja',translation:'このデザインは少し複雑すぎる。'})).targetLanguage,'ja');
 for(const extra of [{targetLanguage:'fr',translation:'bonjour'},{targetLanguage:'en'},{targetLanguage:'es',translation:''},{targetLanguage:'ja',translation:'x'.repeat(2001)}])assert.equal(normalizeMeaningMessage(detail(extra)),null);
});

test('normalizes bounded partial and final semantic fields and strips untrusted identity and metadata',()=>{
 const source=detail({speakerId:'A',role:'B',audio:'unused',apiKey:'never-forward'}),normalized=normalizeMeaningMessage(source);
 assert.deepEqual(normalized,detail());assert.equal(normalized.speakerId,undefined);assert.equal(normalized.apiKey,undefined);
 source.evidence[0]='changed';assert.deepEqual(normalized.evidence,['有点太复杂']);
 assert.deepEqual(normalizeMeaningMessage({type:'reset',speakerId:'A'}),{type:'reset'});
 assert.equal(normalizeMeaningMessage(detail({stage:'partial'})).stage,'partial');
});

test('validates source evidence, enums, types, revisions and field bounds',()=>{
 for(const extra of [
  {text:''},{text:'x'.repeat(2001)},{meaning:'x'.repeat(601)},{target:'x'.repeat(201)},
  {utteranceId:'x'.repeat(129)},{revision:-1},{revision:1.5},{revision:Number.MAX_SAFE_INTEGER+1},
  {language:'fr'},{intent:'read-mind'},{degree:'huge'},{polarity:'bad'},{uncertain:'false'},
  {latencyMs:NaN},{latencyMs:-1},{evidence:[]},{evidence:['不在原文']},{evidence:['']},
  {evidence:Array(9).fill('复杂')},{attributes:Array(13).fill('复杂')},{attributes:['']},{attributes:['x'.repeat(81)]},
 ])assert.equal(normalizeMeaningMessage(detail(extra)),null,JSON.stringify(extra));
 assert.ok(normalizeMeaningMessage(detail({language:'mixed'})));
 assert.ok(normalizeMeaningMessage(detail({text:'x'.repeat(2000),evidence:['x']})));
});

test('caps serialized UTF-8 bytes, including room envelope, without truncation',()=>{
 assert.equal(MAX_MEANING_BYTES,8192);
 const big=detail({text:'中'.repeat(2000),meaning:'意'.repeat(600),target:'对'.repeat(200),evidence:['中'.repeat(160)],attributes:Array(12).fill('性'.repeat(80))});
 assert.equal(meaningMessageFits(big),false);assert.equal(normalizeMeaningMessage(big),null);
 assert.equal(readMessage({v:1,type:'meaning',seq:0,body:big}),null);
 const cycle={type:'reset'};cycle.self=cycle;assert.equal(normalizeMeaningMessage(cycle),null);
 assert.equal(normalizeMeaningMessage({type:'reset',extra:'x'.repeat(9000)}),null);
});

test('room meaning envelopes preserve sequence and fixed body only',()=>{
 assert.deepEqual(readMessage({v:1,type:'meaning',seq:3,body:detail({speakerId:'A'}),speakerId:'B'}),{v:1,type:'meaning',seq:3,body:detail()});
 assert.deepEqual(readMessage({v:1,type:'meaning',seq:4,body:{type:'reset'}}),{v:1,type:'meaning',seq:4,body:{type:'reset'}});
 for(const seq of [-1,NaN,1.2,Number.MAX_SAFE_INTEGER+1])assert.equal(readMessage({v:1,type:'meaning',seq,body:detail()}),null);
 assert.equal(readMessage({v:1,type:'meaning',seq:4,body:detail({stage:'partial'})}).body.stage,'partial');
});
