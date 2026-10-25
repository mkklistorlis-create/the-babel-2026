import test from 'node:test';
import assert from 'node:assert/strict';
import { SemanticPlugin } from '../public/speech/semantic-plugin.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness({ configured = true, mediaDeferred = null, autoReady = true, autoOpen = true, configOverrides = {} } = {}) {
  const sockets = [], contexts = [], worklets = [], tracks = [];
  let micCalls = 0;
  const events = new EventTarget();
  class Track extends EventTarget { stop() { this.stopped = true; } }
  const makeStream = () => {
    const track = new Track(); tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  class Socket extends EventTarget {
    constructor() {
      super(); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this);
      if (autoOpen) queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
    }
    send(data) {
      this.sent.push(data);
      if (typeof data === 'string' && JSON.parse(data).type === 'start' && autoReady) queueMicrotask(() => this.message({ type: 'ready' }));
    }
    message(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  class Context {
    constructor() {
      this.state = 'suspended'; this.destination = {}; contexts.push(this);
      this.audioWorklet = { addModule: async () => {} };
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  class Worklet {
    constructor() { this.port = { onmessage: null, postMessage() {}, close() {} }; worklets.push(this); }
    connect() {}
    disconnect() { this.disconnected = true; }
    frame() { this.port.onmessage?.({ data: new ArrayBuffer(1280) }); }
  }
  const platform = {
    location: { protocol: 'http:', host: '127.0.0.1:4180' }, WebSocket: Socket,
    AudioContext: Context, AudioWorkletNode: Worklet,
    navigator: { mediaDevices: { getUserMedia: () => { micCalls++; return mediaDeferred ? mediaDeferred.promise : Promise.resolve(makeStream()); } } },
    fetch: async () => ({ ok: true, json: async () => ({ speechConfigured: configured, semanticConfigured: configured, ...configOverrides }) }),
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events)
  };
  const plugin = new SemanticPlugin({ platform, connectTimeoutMs: 100 });
  return { plugin, platform, sockets, tracks, worklets, contexts, makeStream, events, micCalls: () => micCalls };
}

test('microphone opens only on start, audio sends after upstream ready, stop releases everything', async () => {
  const h = harness({ autoReady: false });
  assert.equal(h.micCalls(), 0);
  const start = h.plugin.start();
  await tick();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.worklets.length, 0);
  assert.deepEqual(JSON.parse(h.sockets[0].sent[0]), { type: 'start', language: 'auto', sampleRate: 16000, accessCode: '' });
  h.sockets[0].message({ type: 'ready' });
  await start;
  h.worklets[0].frame();
  assert.ok(h.sockets[0].sent.at(-1) instanceof ArrayBuffer);
  h.plugin.stop();
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.contexts[0].state, 'closed');
  assert.equal(h.sockets[0].readyState, 3);
  assert.equal(h.worklets[0].disconnected, true);
});

test('stop cancels pending permission promptly and disposes a late microphone grant', async () => {
  const media = defer();
  const h = harness({ mediaDeferred: media });
  const start = h.plugin.start();
  await tick();
  const rejection = assert.rejects(start, { code: 'STOPPED' });
  h.plugin.stop();
  await rejection;
  media.resolve(h.makeStream());
  await tick();
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.sockets.length, 0);
});

test('missing API configuration fails before requesting microphone', async () => {
  const h = harness({ configured: false });
  const errors = [];
  h.plugin.addEventListener('error', event => errors.push(event.detail));
  await assert.rejects(h.plugin.start(), { code: 'SPEECH_NOT_CONFIGURED' });
  assert.equal(h.micCalls(), 0);
  assert.equal(h.contexts[0].state, 'closed');
  assert.equal(errors.length, 1);
});

test('required access code is checked before microphone capture and sent only in the WebSocket message',async()=>{
 const h=harness({configOverrides:{accessRequired:true,accessConfigured:true}});
 await assert.rejects(h.plugin.start(),{code:'ACCESS_REQUIRED'});assert.equal(h.micCalls(),0);
 h.plugin.accessCode='demo-code';await h.plugin.start();
 const message=JSON.parse(h.sockets[0].sent[0]);assert.equal(message.accessCode,'demo-code');assert.equal(h.plugin.endpoint.includes('demo-code'),false);
 h.plugin.destroy();
});

test('required server access configuration blocks capture even when model keys exist',async()=>{
 const h=harness({configOverrides:{accessRequired:true,accessConfigured:false}});h.plugin.accessCode='example';
 await assert.rejects(h.plugin.start(),{code:'ACCESS_NOT_CONFIGURED'});assert.equal(h.micCalls(),0);assert.equal(h.sockets.length,0);h.plugin.destroy();
});

test('text interpretation carries the session access code and uses the deployed config route',async()=>{
 const h=harness({configOverrides:{accessRequired:true,accessConfigured:true}});h.plugin.accessCode='text-code';
 await h.plugin.interpret('Hello');assert.equal(JSON.parse(h.sockets[0].sent[0]).accessCode,'text-code');assert.match(h.plugin.configUrl,/\/api\/semantic-config$/);h.plugin.destroy();
});

test('text interpretation reuses one connection and never requests microphone', async () => {
  const h = harness();
  const ids = await Promise.all([h.plugin.interpret('你好', { language: 'zh' }), h.plugin.interpret('Hello', { language: 'en' })]);
  assert.equal(h.micCalls(), 0);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.sockets.length, 1);
  assert.notEqual(ids[0], ids[1]);
  assert.deepEqual(h.sockets[0].sent.map(x => JSON.parse(x).type), ['interpret', 'interpret']);
  h.plugin.destroy();
});

test('text requests during microphone mode fail without stopping microphone streaming', async () => {
  const h = harness(); await h.plugin.start();
  const before = h.sockets[0].sent.length;
  await assert.rejects(h.plugin.interpret('Hello'), { code: 'MODE_CONFLICT' });
  assert.equal(h.sockets[0].sent.length, before);
  assert.equal(h.sockets[0].readyState, 1);
  assert.notEqual(h.tracks[0].stopped, true);
  h.worklets[0].frame();
  assert.ok(h.sockets[0].sent.at(-1) instanceof ArrayBuffer);
  h.plugin.destroy();
});

test('text validation matches the gateway 2000-character limit', async () => {
  const h = harness();
  await assert.rejects(h.plugin.interpret('a'.repeat(2001)), /1–2000/);
  assert.equal(h.sockets.length, 0);
  await h.plugin.interpret('a'.repeat(2000));
  assert.equal(JSON.parse(h.sockets[0].sent[0]).text.length, 2000);
  h.plugin.destroy();
});

test('a newer transcript does not suppress a usable earlier semantic partial', async () => {
  const h = harness(); await h.plugin.interpret('hello');
  const events = []; h.plugin.addEventListener('meaning:update', event => events.push(event.detail));
  h.sockets[0].message({ type: 'transcript', utteranceId: 'u', revision: 4, final: false, text: 'Hello there everyone' });
  h.sockets[0].message({ type: 'meaning', utteranceId: 'u', revision: 2, stage: 'partial', meaning: 'Greeting' });
  assert.equal(events.length, 1);
  assert.equal(events[0].revision, 2);
  h.plugin.destroy();
});

test('empty transcript withdrawal resets meaning and permanently blocks withdrawn revisions', async () => {
  const h = harness(); await h.plugin.interpret('hello');
  const meanings = [], resets = [];
  h.plugin.addEventListener('meaning:update', e => meanings.push(e.detail));
  h.plugin.addEventListener('meaning:reset', e => resets.push(e.detail));
  const send = data => h.sockets[0].message({ utteranceId: 'u', ...data });
  send({ type: 'transcript', revision: 1, text: 'hello', final: false });
  send({ type: 'meaning', revision: 1, stage: 'partial', meaning: 'Greeting' });
  send({ type: 'transcript', revision: 3, text: '', final: false });
  send({ type: 'meaning', revision: 2, stage: 'partial', meaning: 'Old greeting' });
  send({ type: 'transcript', revision: 4, text: 'help', final: false });
  send({ type: 'meaning', revision: 3, stage: 'partial', meaning: 'Withdrawn greeting' });
  send({ type: 'meaning', revision: 4, stage: 'partial', meaning: 'Request for help' });
  assert.deepEqual(meanings.map(x => x.revision), [1, 4]);
  assert.equal(resets.length, 1);
  assert.equal(resets[0].revision, 3);
  h.plugin.destroy();
});

test('a final transcript immediately blocks partial meanings before final meaning arrives', async () => {
  const h = harness(); await h.plugin.interpret('hello');
  const meanings = [];
  for (const name of ['meaning:update', 'meaning:final']) h.plugin.addEventListener(name, e => meanings.push(e.detail));
  h.sockets[0].message({ type: 'transcript', utteranceId: 'u', revision: 3, text: 'Hello.', final: true });
  h.sockets[0].message({ type: 'meaning', utteranceId: 'u', revision: 2, stage: 'partial', meaning: 'Greeting' });
  h.sockets[0].message({ type: 'meaning', utteranceId: 'u', revision: 3, stage: 'final', meaning: 'Greeting' });
  assert.equal(meanings.length, 1);
  assert.equal(meanings[0].stage, 'final');
  h.plugin.destroy();
});

test('new utterance blocks older partials while allowing late final results without changing current turn', async () => {
  const h = harness(); await h.plugin.interpret('hello');
  const meanings = [];
  for (const name of ['meaning:update', 'meaning:final']) h.plugin.addEventListener(name, e => meanings.push(e.detail));
  const send = (type, utteranceId, revision, final) => h.sockets[0].message({ type, utteranceId, revision, final, text: 'words', stage: final ? 'final' : 'partial' });
  send('transcript', 'old', 1, false);
  send('transcript', 'new', 1, false);
  send('meaning', 'old', 1, false);
  send('transcript', 'old', 2, true);
  send('meaning', 'old', 2, true);
  send('meaning', 'new', 1, false);
  assert.deepEqual(meanings.map(x => [x.utteranceId, x.stage]), [['old', 'final'], ['new', 'partial']]);
  h.plugin.destroy();
});

test('same-revision final supersedes partial, stale and post-final partial results are ignored', async () => {
  const h = harness(); await h.plugin.interpret('hello');
  const events = [];
  for (const type of ['meaning:update', 'meaning:final']) h.plugin.addEventListener(type, event => events.push(event.detail));
  const send = (revision, stage) => h.sockets[0].message({ type: 'meaning', utteranceId: 'u', revision, stage, meaning: 'Greeting' });
  send(2, 'partial'); send(1, 'partial'); send(2, 'partial'); send(2, 'final'); send(3, 'partial');
  assert.equal(events.length, 2);
  assert.equal(events[1].stage, 'final');
  h.plugin.destroy();
});

test('events from a stopped connection do not reach a restarted session', async () => {
  const h = harness(); await h.plugin.interpret('first');
  const old = h.sockets[0]; h.plugin.stop(); await h.plugin.interpret('second');
  const got = []; h.plugin.addEventListener('meaning:final', e => got.push(e.detail));
  old.message({ type: 'meaning', utteranceId: 'u1', revision: 1, stage: 'final' });
  h.sockets[1].message({ type: 'meaning', utteranceId: 'u2', revision: 1, stage: 'final' });
  assert.deepEqual(got.map(x => x.utteranceId), ['u2']);
  h.plugin.destroy();
});

test('backpressure stops capture instead of accumulating delayed audio', async () => {
  const h = harness(); await h.plugin.start();
  const got = []; h.plugin.addEventListener('error', e => got.push(e.detail));
  h.sockets[0].bufferedAmount = 300000;
  h.worklets[0].frame();
  assert.equal(got[0].code, 'BACKPRESSURE');
  assert.equal(h.tracks[0].stopped, true);
});

test('pagehide stops capture and destroy prevents future sessions', async () => {
  const h = harness(); await h.plugin.start();
  h.events.dispatchEvent(new Event('pagehide'));
  assert.equal(h.tracks[0].stopped, true);
  h.plugin.destroy();
  await assert.rejects(h.plugin.start(), { code: 'DESTROYED' });
  await assert.rejects(h.plugin.interpret('Hello'), { code: 'DESTROYED' });
});

test('a fatal provider error rejects pending startup without duplicate error events', async () => {
  const h = harness({ autoReady: false });
  const errors = []; h.plugin.addEventListener('error', e => errors.push(e.detail));
  const start = h.plugin.start(); await tick();
  const rejection = assert.rejects(start);
  h.sockets[0].message({ type: 'error', code: 'UPSTREAM', message: 'Authentication failed.', fatal: true });
  await rejection;
  assert.equal(errors.length, 1);
  assert.equal(h.tracks[0].stopped, true);
});

test('connection timeout releases microphone and audio context', async () => {
  const h = harness({ autoOpen: false });
  await assert.rejects(h.plugin.start(), { code: 'TIMEOUT' });
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.contexts[0].state, 'closed');
});
