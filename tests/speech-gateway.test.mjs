import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSemanticGateway, getSpeechConfig } from '../lib/speech/gateway.mjs';
import configHandler from '../api/semantic-config.js';
import streamServer from '../api/semantic-stream.js';

const KEYS = { DEEPGRAM_API_KEY: 'test-speech-secret', SEMANTIC_API_KEY: 'test-semantic-secret' };
const REMOTE = { ...KEYS, VERCEL: '1', BABEL_SPEECH_ACCESS_CODE: 'demo-access-secret' };
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const meaning = text => ({ meaning: 'A greeting.', intent: 'greeting', target: '', attributes: [], degree: 'none', polarity: 'neutral', uncertain: false, evidence: [text] });
const transcript = (id, text, extra = {}) => ({ utteranceId: id, revision: 1, text, language: 'en', final: true, startedAt: Date.now(), endedAt: Date.now(), ...extra });

class MemorySocket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.messages = []; this.waiters = []; this.closed = null; }
  send(body) {
    const value = JSON.parse(body), index = this.waiters.findIndex(waiter => waiter.matches(value));
    if (index < 0) this.messages.push(value);
    else { const [waiter] = this.waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(value); }
  }
  input(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  audio(value) { this.emit('message', value, true); }
  close(code = 1000, reason = '') { if (this.closed) return; this.closed = { code, reason }; this.readyState = 3; this.emit('close', code, reason); }
  terminate() { this.close(1006, 'Terminated'); }
  next(matches = () => true) {
    const index = this.messages.findIndex(matches);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { matches, resolve };
      waiter.timer = setTimeout(() => { this.waiters = this.waiters.filter(item => item !== waiter); reject(new Error('Expected gateway output was not received.')); }, 1000);
      this.waiters.push(waiter);
    });
  }
}
class MemoryWebSocketServer extends EventEmitter {
  constructor(options) { super(); this.options = options; }
  handleUpgrade(_req, socket, _head, callback) { socket.client = new MemorySocket(); callback(socket.client); }
  close() { this.closed = true; }
}
function fakeSpeech({ ready = true } = {}) {
  const streams = [];
  return { streams, factory(callbacks) {
    const stream = { callbacks, audio: [], closeCount: 0, sendAudio(bytes) { this.audio.push(Buffer.from(bytes)); }, close() { this.closeCount++; } };
    streams.push(stream); if (ready) queueMicrotask(callbacks.onReady); return stream;
  } };
}
function fixture(t, options = {}) {
  const server = new EventEmitter(); let wss;
  const env = options.env ?? KEYS;
  const gateway = createSemanticGateway({ server, env, interpreter: async input => meaning(input.text), ...options,
    createWebSocketServer: settings => { wss = new MemoryWebSocketServer(settings); return wss; },
  });
  t.after(() => gateway.close());
  const remote = typeof env.VERCEL !== 'undefined';
  const host = remote ? 'babel.example' : '127.0.0.1:4180', origin = `${remote ? 'https' : 'http'}://${host}`;
  function upgrade({ url = '/api/semantic-stream', origin: incomingOrigin = origin, host: incomingHost = host, extraHeaders = {} } = {}) {
    const transport = { response: '', end(value) { this.response = value; } };
    server.emit('upgrade', { url, headers: { host: incomingHost, ...(incomingOrigin === null ? {} : { origin: incomingOrigin }), ...extraHeaders } }, transport, Buffer.alloc(0));
    return transport;
  }
  function connect() { const transport = upgrade(); assert.ok(transport.client, transport.response); return transport.client; }
  return { gateway, server, wss, upgrade, connect, origin, host };
}

test('public readiness is secret-free and no longer requires a participant passphrase', () => {
  assert.deepEqual(getSpeechConfig({}), { speechConfigured: false, semanticConfigured: false, accessRequired: false, accessConfigured: false, enabled: false, maxSessionMs: 240000, languages: ['zh', 'en', 'ja', 'es'] });
  assert.equal(getSpeechConfig(KEYS).enabled, true);
  for (const value of ['1', '0', '']) {
    const config = getSpeechConfig({ ...KEYS, VERCEL: value });
    assert.equal(config.accessRequired, false); assert.equal(config.enabled, true);
  }
  const ready = getSpeechConfig({ ...REMOTE, SEMANTIC_BASE_URL: 'https://private.example/v1' });
  assert.equal(ready.enabled, true); assert.equal(ready.accessConfigured, false);
  for (const value of ['test-speech-secret', 'test-semantic-secret', 'demo-access-secret', 'private.example']) assert.equal(JSON.stringify(ready).includes(value), false);
  assert.equal(getSpeechConfig({ ...KEYS, BABEL_SPEECH_ACCESS_CODE: 'local-code' }).accessRequired, false);
});

test('gateway translates to requested language and cancels obsolete translation when peer preference changes',async t=>{
 const speech=fakeSpeech(),pending=deferred(),inputs=[];
 const f=fixture(t,{speechFactory:speech.factory,interpreter:async(input,{signal})=>{
  inputs.push({input,signal});if(input.targetLanguage==='ja')return pending.promise;
  return {...meaning(input.text),translation:'Hola'};
 }});
 const ws=f.connect();ws.input({type:'start',language:'en',targetLanguage:'ja',sampleRate:16000});await ws.next(x=>x.type==='ready');
 speech.streams[0].callbacks.onTranscript(transcript('first','Hello'));await tick();
 ws.input({type:'target-language',targetLanguage:'es'});assert.equal(inputs[0].signal.aborted,true);
 pending.resolve({...meaning('Hello'),translation:'こんにちは'});
 speech.streams[0].callbacks.onTranscript(transcript('second','Hi'));
 const value=await ws.next(x=>x.type==='meaning');assert.equal(value.targetLanguage,'es');assert.equal(value.translation,'Hola');
 assert.equal(speech.streams.length,1);assert.equal(speech.streams[0].closeCount,0);
 assert.equal(ws.messages.some(x=>x.type==='meaning'&&x.targetLanguage==='ja'),false);
 ws.input({type:'target-language',targetLanguage:'fr'});assert.equal((await ws.next(x=>x.type==='error')).code,'INVALID_CONFIG');
});

test('same-origin upgrade accepts localhost HTTP and production HTTPS only', t => {
  const local = fixture(t), remote = fixture(t, { env: REMOTE });
  assert.deepEqual(local.wss.options, { noServer: true, maxPayload: 16384, perMessageDeflate: false });
  for (const invalid of [{ origin: null }, { origin: 'null' }, { origin: 'https://evil.example' }, { origin: 'http://localhost:4180' }, { host: 'evil.example', origin: 'http://evil.example' }, { url: '/api/other' }, { url: '/api/semantic-stream?accessCode=x' }]) assert.match(local.upgrade(invalid).response, /403 Forbidden/);
  for (const invalid of [{ origin: null }, { origin: 'http://babel.example' }, { origin: 'https://evil.example' }, { origin: 'https://babel.example.evil.com' }, { origin: 'https://babel.example/' }, { host: 'babel.example/evil', origin: 'https://babel.example/evil' }, { extraHeaders: { 'x-forwarded-host': 'evil.example' }, origin: 'https://evil.example' }]) assert.match(remote.upgrade(invalid).response, /403 Forbidden/);
  assert.ok(local.connect()); assert.ok(remote.connect());
});

test('providers stay idle until explicit start, then production works without a code',async t=>{
 const speech=fakeSpeech(),f=fixture(t,{env:{...KEYS,VERCEL:'1'},speechFactory:speech.factory});
 const ws=f.connect();await tick();assert.equal(speech.streams.length,0);
 ws.input({type:'start',language:'en',sampleRate:16000});assert.equal((await ws.next()).type,'ready');assert.equal(speech.streams.length,1);
 const binary=f.connect();binary.audio(Buffer.alloc(4));assert.equal((await binary.next()).code,'ACCESS_REQUIRED');
});

test('legacy client credentials are ignored and never included in responses', async t => {
  const speech = fakeSpeech(), f = fixture(t, { env: REMOTE, speechFactory: speech.factory });
  const ws = f.connect(); ws.input({ type: 'start', language: 'auto', sampleRate: 16000, accessCode: REMOTE.BABEL_SPEECH_ACCESS_CODE });
  assert.equal((await ws.next()).type, 'ready');
  ws.audio(Buffer.from([1, 0, 2, 0])); assert.deepEqual(speech.streams[0].audio, [Buffer.from([1, 0, 2, 0])]);
  speech.streams[0].callbacks.onTranscript(transcript('a', 'Hola', { language: 'es', final: false }));
  const partial = await ws.next(item => item.type === 'meaning'); assert.equal(partial.stage, 'partial');
  speech.streams[0].callbacks.onTranscript(transcript('a', 'Hola amigo', { language: 'es', revision: 2 }));
  const final = await ws.next(item => item.type === 'meaning'); assert.equal(final.stage, 'final'); assert.deepEqual(final.evidence, ['Hola amigo']);
  for (const item of [...ws.messages, partial, final]) assert.equal(JSON.stringify(item).includes(REMOTE.BABEL_SPEECH_ACCESS_CODE), false);
});

test('a legacy environment access code does not block the new no-code experience',async t=>{
 const f=fixture(t,{env:REMOTE});const ws=f.connect();ws.input({type:'interpret',language:'en',text:'Hello'});
 assert.equal((await ws.next(item=>item.type==='meaning')).stage,'final');
});

test('first message expires after 10 seconds without opening providers', t => {
  const original = globalThis.setTimeout; let expire;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 10000) { expire = callback; return { unref() {} }; }
    return original(callback, delay, ...args);
  });
  const speech = fakeSpeech(), f = fixture(t, { env: REMOTE, speechFactory: speech.factory });
  const ws = f.connect(); assert.equal(typeof expire, 'function'); expire();
  assert.equal(ws.messages[0].code, 'AUTH_TIMEOUT'); assert.equal(ws.closed.code, 1008); assert.equal(speech.streams.length, 0);
});

test('authenticated session time limit closes providers with a clear restart message', async t => {
  const speech = fakeSpeech(), f = fixture(t, { speechFactory: speech.factory, maxSessionMs: 25 });
  const ws = f.connect(); ws.input({ type: 'start', language: 'en', sampleRate: 16000 }); await ws.next();
  const error = await ws.next(); assert.equal(error.code, 'SESSION_LIMIT'); assert.match(error.message, /4 分钟.*重新/);
  assert.equal(ws.closed.code, 1008); assert.equal(speech.streams[0].closeCount, 1);
});

test('concurrency limit is per gateway instance and closing a session frees its slot', async t => {
  const a = fixture(t, { maxSessions: 1 }), b = fixture(t, { maxSessions: 1 });
  const first = a.connect(); assert.match(a.upgrade().response, /403 Forbidden/); assert.ok(b.connect());
  first.input({ type: 'stop' }); assert.equal(first.closed.code, 1000); assert.ok(a.connect());
});

test('text requests preserve context and reject duplicates and invalid inputs', async t => {
  const seen = [], f = fixture(t, { env: REMOTE, interpreter: async input => { seen.push(input); return meaning(input.text); } });
  const ws = f.connect();
  for (const [id, text, language] of [['one', '你好', 'zh'], ['two', 'Hello', 'en'], ['three', 'こんにちは', 'ja'], ['four', 'Hola', 'es']]) {
    ws.input({ type: 'interpret', text, language, utteranceId: id, ...(id === 'one' ? { accessCode: REMOTE.BABEL_SPEECH_ACCESS_CODE } : {}) });
    assert.equal((await ws.next(item => item.type === 'meaning')).language, language);
  }
  assert.equal(seen[3].context.length, 3); assert.equal(seen[1].context[0].text, '你好');
  ws.input({ type: 'interpret', text: 'Again', language: 'en', utteranceId: 'one' }); assert.equal((await ws.next(item => item.type === 'error')).code, 'DUPLICATE_ID');
  for (const invalid of [{ text: '', language: 'en' }, { text: 'x'.repeat(2001), language: 'en' }, { text: 'Bonjour', language: 'fr' }]) {
    ws.input({ type: 'interpret', ...invalid }); assert.equal((await ws.next(item => item.type === 'error')).code, 'INVALID_TEXT');
  }
  assert.equal(seen.length, 4);
});

test('audio readiness, configuration, alignment and frame size are validated', async t => {
  const speech = fakeSpeech(), f = fixture(t, { speechFactory: speech.factory });
  for (const configuration of [{ language: 'fr', sampleRate: 16000 }, { language: 'en', sampleRate: 48000 }]) {
    const ws = f.connect(); ws.input({ type: 'start', ...configuration }); assert.equal((await ws.next()).code, 'INVALID_CONFIG');
  }
  assert.equal(speech.streams.length, 0);
  for (const frame of [Buffer.alloc(3), Buffer.alloc(8194)]) {
    const ws = f.connect(); ws.input({ type: 'start', language: 'en', sampleRate: 16000 }); await ws.next(); ws.audio(frame);
    assert.equal((await ws.next()).code, 'INVALID_AUDIO'); assert.equal(speech.streams.at(-1).audio.length, 0);
  }
  const unready = fakeSpeech({ ready: false }), waiting = fixture(t, { speechFactory: unready.factory }), ws = waiting.connect();
  ws.input({ type: 'start', language: 'en', sampleRate: 16000 }); ws.audio(Buffer.alloc(4)); assert.equal((await ws.next()).code, 'INVALID_AUDIO');
});

test('message size and rate limits apply before provider work', async t => {
  const f = fixture(t), large = f.connect(); large.emit('message', Buffer.alloc(16385), false); assert.equal((await large.next()).code, 'INVALID_MESSAGE');
  const flood = f.connect(); flood.input({ type: 'interpret', text: '', language: 'en' });
  for (let i = 0; i < 101; i++) flood.input({ type: 'unknown' });
  assert.equal((await flood.next(item => item.code === 'RATE_LIMIT')).fatal, true); assert.equal(flood.closed.code, 1008);
});

test('malformed, unauthenticated and mode-conflicting messages never invoke wrong providers', async t => {
  const speech = fakeSpeech(), f = fixture(t, { speechFactory: speech.factory });
  for (const value of ['{', '[]', 'null']) { const ws = f.connect(); ws.emit('message', Buffer.from(value), false); assert.equal((await ws.next()).code, 'INVALID_MESSAGE'); }
  const unknown = f.connect(); unknown.input({ type: 'hello' }); assert.equal((await unknown.next()).code, 'ACCESS_REQUIRED');
  const ws = f.connect(); ws.input({ type: 'start', language: 'en', sampleRate: 16000 }); await ws.next();
  ws.input({ type: 'interpret', text: 'Hello', language: 'en' }); assert.equal((await ws.next()).code, 'MODE_CONFLICT'); assert.equal(ws.closed, null);
  ws.input({ type: 'start', language: 'en', sampleRate: 16000 }); assert.equal((await ws.next()).code, 'ALREADY_STARTED');
});

test('stop cancels active model work, queued finals and late speech callbacks', async t => {
  const started = deferred(), pending = deferred(), speech = fakeSpeech(); let signal, calls = 0;
  const f = fixture(t, { speechFactory: speech.factory, interpreter: (_input, options) => { signal = options.signal; calls++; started.resolve(); return pending.promise; } });
  const ws = f.connect(); ws.input({ type: 'start', language: 'en', sampleRate: 16000 }); await ws.next();
  const stream = speech.streams[0]; stream.callbacks.onTranscript(transcript('a', 'Hello')); await started.promise;
  stream.callbacks.onTranscript(transcript('b', 'Hi')); ws.input({ type: 'stop' }); assert.equal(signal.aborted, true); assert.equal(stream.closeCount, 1);
  const count = ws.messages.length; pending.resolve(meaning('Hello')); stream.callbacks.onTranscript(transcript('late', 'Later')); stream.callbacks.onReady(); await tick();
  assert.equal(calls, 1); assert.equal(ws.messages.length, count);
});

test('gateway close removes upgrade handler and releases WS without closing the HTTP server', async t => {
  const speech = fakeSpeech(), started = deferred(); let signal, httpClosed = false;
  const f = fixture(t, { speechFactory: speech.factory, interpreter: (_input, options) => { signal = options.signal; started.resolve(); return new Promise(() => {}); } });
  f.server.close = () => { httpClosed = true; };
  const ws = f.connect(); ws.input({ type: 'start', language: 'en', sampleRate: 16000 }); await ws.next();
  speech.streams[0].callbacks.onTranscript(transcript('a', 'Hi')); await started.promise;
  f.gateway.close(); f.gateway.close(); assert.equal(signal.aborted, true); assert.equal(ws.closed.code, 1006);
  assert.equal(speech.streams[0].closeCount, 1); assert.equal(f.wss.closed, true); assert.equal(httpClosed, false); assert.equal(f.server.listenerCount('upgrade'), 0);
});

test('provider errors are safe and invalid evidence cannot become a semantic result', async t => {
  const f = fixture(t, { interpreter: async () => { throw Object.assign(new Error(KEYS.SEMANTIC_API_KEY), { code: KEYS.SEMANTIC_API_KEY }); } });
  const ws = f.connect(); ws.input({ type: 'interpret', text: 'Hello', language: 'en', utteranceId: 'failure' });
  const error = await ws.next(item => item.type === 'error'); assert.equal(error.code, 'SEMANTIC_ERROR'); assert.equal(JSON.stringify(error).includes(KEYS.SEMANTIC_API_KEY), false);
  const bad = fixture(t, { interpreter: async () => ({ ...meaning('Hello'), evidence: ['invented'] }) }), badWs = bad.connect();
  badWs.input({ type: 'interpret', text: 'Hello', language: 'en' }); assert.equal((await badWs.next(item => item.type === 'error')).code, 'INVALID_SEMANTIC_OUTPUT');
  assert.equal(badWs.messages.some(item => item.type === 'meaning'), false);
  const speech = fakeSpeech(), audio = fixture(t, { speechFactory: speech.factory }), audioWs = audio.connect();
  audioWs.input({ type: 'start', language: 'en', sampleRate: 16000 }); await audioWs.next();
  speech.streams[0].callbacks.onError({ code: KEYS.DEEPGRAM_API_KEY, message: KEYS.DEEPGRAM_API_KEY });
  const speechError = await audioWs.next(); assert.equal(speechError.code, 'SPEECH_ERROR'); assert.equal(JSON.stringify(speechError).includes(KEYS.DEEPGRAM_API_KEY), false);
});

test('a synchronous speech-open error closes its returned provider and releases the slot', async t => {
  let closes = 0;
  const f = fixture(t, { maxSessions: 1, speechFactory: callbacks => { callbacks.onError(new Error('private')); return { close() { closes++; } }; } });
  const ws = f.connect(); ws.input({ type: 'start', language: 'en', sampleRate: 16000 });
  assert.equal((await ws.next()).code, 'SPEECH_ERROR'); assert.equal(closes, 1); assert.equal(ws.closed.code, 1008); assert.ok(f.connect());
});

test('configuration HTTP route rejects writes and cross-site fetches and disables caching', () => {
  for (const [req, expected] of [[{ method: 'POST', headers: {} }, 405], [{ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }, 403], [{ method: 'GET', headers: {} }, 200]]) {
    const headers = {}; let body; const res = { setHeader: (key, value) => { headers[key] = value; }, end: value => { body = JSON.parse(value); } };
    configHandler(req, res); assert.equal(res.statusCode, expected); assert.equal(headers['Cache-Control'], 'no-store');
    if (expected === 200) assert.deepEqual(Object.keys(body).sort(), ['speechConfigured', 'semanticConfigured', 'accessRequired', 'accessConfigured', 'enabled', 'maxSessionMs', 'languages'].sort());
  }
});

test('Vercel HTTP-server export returns 426 for an ordinary HTTP request', () => {
  let status, headers, body;
  streamServer.emit('request', { method: 'GET', url: '/api/semantic-stream', headers: {} }, {
    writeHead: (code, values) => { status = code; headers = values; }, end: value => { body = JSON.parse(value); },
  });
  assert.equal(status, 426); assert.equal(headers.Upgrade, 'websocket'); assert.equal(headers['Cache-Control'], 'no-store'); assert.match(body.error, /WebSocket/);
  assert.equal(streamServer.listening, false); streamServer.emit('close');
});
