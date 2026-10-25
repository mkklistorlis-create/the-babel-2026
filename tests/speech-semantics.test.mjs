import test from 'node:test';
import assert from 'node:assert/strict';
import { createInterpreter, SemanticScheduler, validateSemanticOutput } from '../lib/speech/semantics.mjs';

const result = text => ({ meaning: '一句话的含义', intent: 'statement', target: '', attributes: [], degree: 'unknown', polarity: 'neutral', uncertain: false, evidence: [text.slice(0, 160)] });
const turn = (id, revision = 1, final = true, text = `turn ${id}`) => ({ utteranceId: id, revision, final, text, language: 'en' });
const envelope = output => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] });
const response = payload => new Response(JSON.stringify(payload), { status: 200 });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

test('interpreter sends original transcript as data, accepts only grounded structured output', async () => {
  let captured;
  const text = 'I do not like this design.';
  const interpret = createInterpreter({ apiKey: 'private-test-key', fetchImpl: async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return response(envelope({ ...result(text), intent: 'evaluate', polarity: 'negative', target: 'this design' }));
  } });
  const output = await interpret({ text, language: 'en-US', final: true });
  assert.equal(output.polarity, 'negative');
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer private-test-key');
  assert.deepEqual(captured.body.response_format, { type: 'json_object' });
  assert.equal(captured.body.model, 'gpt-4.1-mini');
  assert.ok(captured.body.messages.some(message => message.role === 'user' && message.content.includes(text)));
});

test('strict validation rejects invented evidence, confidence, type coercions and oversized output', () => {
  const good = result('hello');
  assert.deepEqual(validateSemanticOutput(good, 'hello'), good);
  for (const bad of [
    { ...good, evidence: ['not present'] }, { ...good, evidence: [] },
    { ...good, confidence: 0.99 }, { ...good, uncertain: 'false' },
    { ...good, intent: 'happiness' }, { ...good, meaning: 'x'.repeat(601) },
    { ...good, attributes: [null] }, { ...good, evidence: [''] },
  ]) assert.throws(() => validateSemanticOutput(bad, 'hello'), { code: 'INVALID_SEMANTIC_OUTPUT' });
});

test('configuration allows HTTPS and loopback HTTP, rejects remote plaintext and URL credentials', () => {
  for (const baseUrl of ['http://api.example.com/v1', 'https://name:pass@api.example.com/v1', 'file:///tmp/a', 'https://api.example.com/v1?key=secret']) {
    assert.throws(() => createInterpreter({ baseUrl }), { code: 'INVALID_SEMANTIC_URL' });
  }
  assert.equal(typeof createInterpreter({ baseUrl: 'http://127.0.0.1:8000/v1' }), 'function');
});

test('missing key and invalid transcript fail before network activity', async () => {
  let calls = 0;
  const interpret = createInterpreter({ fetchImpl: async () => { calls++; } });
  await assert.rejects(interpret({ text: 'hello', language: 'en', final: true }), { code: 'MISSING_SEMANTIC_KEY' });
  await assert.rejects(interpret({ text: ' ', language: 'en', final: true }), { code: 'INVALID_TRANSCRIPT' });
  assert.equal(calls, 0);
});

test('HTTP failures expose only status and do not leak provider response contents', async () => {
  const interpret = createInterpreter({ apiKey: 'test-secret', fetchImpl: async () => new Response('test-secret transcript secret', { status: 401 }) });
  await assert.rejects(interpret({ text: 'hello', final: true }), error => error.code === 'SEMANTIC_PROVIDER_ERROR' && !error.message.includes('test-secret'));
});

test('malformed, truncated and refused model responses fail explicitly', async () => {
  for (const payload of [
    { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(result('hello')) } }] },
    { choices: [{ message: { content: 'no json' } }] },
    { choices: [{ message: { refusal: 'Unable' } }] },
  ]) {
    const interpret = createInterpreter({ apiKey: 'test', fetchImpl: async () => response(payload) });
    await assert.rejects(interpret({ text: 'hello', final: true }), error => ['INVALID_SEMANTIC_OUTPUT', 'SEMANTIC_REFUSAL'].includes(error.code));
  }
});

test('timeout cancels even a fetch adapter that never settles', async () => {
  let signal;
  const interpret = createInterpreter({ apiKey: 'test', timeoutMs: 10, fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(interpret({ text: 'hello', final: true }), { code: 'SEMANTIC_TIMEOUT' });
  assert.equal(signal.aborted, true);
});

test('caller cancellation interrupts an outstanding request without a network error', async () => {
  const controller = new AbortController();
  const interpret = createInterpreter({ apiKey: 'test', fetchImpl: async () => new Promise(() => {}) });
  const pending = interpret({ text: 'hello', final: true }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('continuous transcript revisions still produce bounded provisional snapshots with original evidence', async t => {
  const first = deferred(), results = [], calls = [];
  const scheduler = new SemanticScheduler({ partialIntervalMs: 0, interpret: async input => {
    calls.push(input.text); return calls.length === 1 ? first.promise : result(input.text);
  }, onResult: output => results.push(output) });
  t.after(() => scheduler.stop());
  scheduler.submit(turn('one', 1, false, 'I like'));
  await flush();
  scheduler.submit(turn('one', 2, false, 'I like this'));
  scheduler.submit(turn('one', 3, false, 'I like this design'));
  first.resolve(result('I like'));
  await flush();
  assert.deepEqual(calls, ['I like', 'I like this design']);
  assert.deepEqual(results.map(value => value.revision), [1, 3]);
  assert.deepEqual(results.map(value => value.text), ['I like', 'I like this design']);
  assert.deepEqual(results[0].evidence, ['I like']);
  assert.ok(results.every(value => value.stage === 'partial'));
});

test('final preempts pending partial, remains final even with identical text/revision', async t => {
  const hanging = deferred(), results = [], signals = [];
  const scheduler = new SemanticScheduler({ partialIntervalMs: 0, interpret: async (input, { signal }) => {
    signals.push(signal); return input.final ? result(input.text) : hanging.promise;
  }, onResult: value => results.push(value) });
  t.after(() => scheduler.stop());
  scheduler.submit(turn('one', 1, false, 'hello'));
  await flush();
  scheduler.submit(turn('one', 1, true, 'hello'));
  await flush();
  assert.equal(signals[0].aborted, true);
  assert.equal(results.length, 1);
  assert.equal(results[0].stage, 'final');
  hanging.resolve(result('hello'));
  await flush();
  assert.equal(results.length, 1);
});

test('all final utterances are preserved in order and context includes only last three finals', async t => {
  const first = deferred(), contexts = [], results = [];
  const scheduler = new SemanticScheduler({ interpret: async input => {
    contexts.push(input.context); return input.text === 'turn 1' ? first.promise : result(input.text);
  }, onResult: value => results.push(value) });
  t.after(() => scheduler.stop());
  scheduler.submit(turn('1'));
  await flush();
  for (const id of ['2', '3', '4', '5']) scheduler.submit(turn(id));
  first.resolve(result('turn 1'));
  await flush();
  assert.deepEqual(results.map(value => value.utteranceId), ['1', '2', '3', '4', '5']);
  assert.deepEqual(contexts[4].map(value => value.text), ['turn 2', 'turn 3', 'turn 4']);
  assert.ok(results.every(value => Number.isFinite(value.latencyMs) && value.latencyMs >= 0));
});

test('finals take priority over waiting partials without dropping the newest partial', async t => {
  const first = deferred(), calls = [], results = [];
  const scheduler = new SemanticScheduler({ partialIntervalMs: 0, interpret: async input => {
    calls.push(input.text); return input.text === 'turn a' ? first.promise : result(input.text);
  }, onResult: value => results.push(value) });
  t.after(() => scheduler.stop());
  scheduler.submit(turn('a'));
  await flush();
  scheduler.submit(turn('b', 1, false));
  scheduler.submit(turn('c', 1, false));
  scheduler.submit(turn('b'));
  first.resolve(result('turn a'));
  await flush();
  assert.deepEqual(calls, ['turn a', 'turn b', 'turn c']);
  assert.deepEqual(results.map(value => value.stage), ['final', 'final', 'partial']);
});

test('stop aborts active work, clears queued data and suppresses late output', async () => {
  const hanging = deferred(), results = [], errors = [], signals = [];
  const scheduler = new SemanticScheduler({ interpret: async (_input, { signal }) => { signals.push(signal); return hanging.promise; }, onResult: value => results.push(value), onError: error => errors.push(error) });
  scheduler.submit(turn('a')); await flush();
  scheduler.submit(turn('b')); scheduler.stop();
  hanging.resolve(result('turn a')); await flush();
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(results, []); assert.deepEqual(errors, []);
  assert.equal(scheduler.submit(turn('c')), false);
  assert.equal(scheduler.context.length, 0);
});

test('queue overflow and invalid inputs fail visibly while accepted finals survive', async t => {
  const hanging = deferred(), results = [], errors = [];
  const scheduler = new SemanticScheduler({ maxPendingFinals: 1, interpret: async input => input.text === 'turn a' ? hanging.promise : result(input.text), onResult: value => results.push(value), onError: error => errors.push(error.code) });
  t.after(() => scheduler.stop());
  scheduler.submit(turn('a')); await flush();
  assert.equal(scheduler.submit(turn('b')), true);
  assert.equal(scheduler.submit(turn('c')), false);
  assert.equal(scheduler.submit({ ...turn('d'), revision: NaN }), false);
  hanging.resolve(result('turn a')); await flush();
  assert.deepEqual(errors, ['SEMANTIC_QUEUE_FULL', 'INVALID_TRANSCRIPT']);
  assert.deepEqual(results.map(value => value.utteranceId), ['a', 'b']);
});

test('duplicates and a later partial cannot replace an already delivered final', async t => {
  const results = [];
  const scheduler = new SemanticScheduler({ interpret: async input => result(input.text), onResult: value => results.push(value) });
  t.after(() => scheduler.stop());
  scheduler.submit(turn('a')); await flush();
  assert.equal(scheduler.submit(turn('a')), false);
  assert.equal(scheduler.submit(turn('a', 2, false)), false);
  assert.equal(scheduler.submit(turn('a', 2, true)), false);
  assert.equal(results.length, 1);
});

test('late final preempts a newer turn preview then resumes the current preview', async t => {
  const first = deferred(), results = [], calls = [];
  const scheduler = new SemanticScheduler({ partialIntervalMs: 0, interpret: async input => {
    calls.push(input.text); return calls.length === 1 ? first.promise : result(input.text);
  }, onResult: value => results.push(value) });
  t.after(() => scheduler.stop());
  scheduler.submit(turn('old', 1, false));
  scheduler.submit(turn('new', 1, false)); await flush();
  scheduler.submit(turn('old')); await flush();
  assert.deepEqual(results.map(value => [value.utteranceId, value.stage]), [['old', 'final'], ['new', 'partial']]);
  first.resolve(result('turn new')); await flush();
  assert.equal(results.length, 2);
});

test('provisional snapshots beyond the age budget are discarded', async t => {
  const first = deferred(), results = [], calls = [];
  const scheduler = new SemanticScheduler({ partialIntervalMs: 0, maxPartialAgeMs: 10, interpret: async input => {
    calls.push(input.text); return calls.length === 1 ? first.promise : result(input.text);
  }, onResult: value => results.push(value) });
  t.after(() => scheduler.stop());
  scheduler.submit(turn('a', 1, false, 'old snapshot')); await flush();
  await new Promise(resolve => setTimeout(resolve, 15));
  scheduler.submit(turn('a', 2, false, 'new snapshot'));
  first.resolve(result('old snapshot')); await flush();
  assert.deepEqual(results.map(value => value.revision), [2]);
});

test('a different utterance invalidates earlier partial snapshots and prevents backtracking', async t => {
  const first = deferred(), results = [];
  const scheduler = new SemanticScheduler({ partialIntervalMs: 0, interpret: async input => input.text === 'turn old' ? first.promise : result(input.text), onResult: value => results.push(value) });
  t.after(() => scheduler.stop());
  scheduler.submit(turn('old', 1, false)); await flush();
  scheduler.submit(turn('new', 1, false)); await flush();
  first.resolve(result('turn old')); await flush();
  assert.equal(scheduler.submit(turn('old', 2, false)), false);
  assert.deepEqual(results.map(value => value.utteranceId), ['new']);
});

test('empty partial withdraws an ASR hypothesis without inference or errors; later revisions recover', async t => {
  const first = deferred(), results = [], errors = [], calls = [];
  const scheduler = new SemanticScheduler({ partialIntervalMs: 0, interpret: async input => {
    calls.push(input.text); return calls.length === 1 ? first.promise : result(input.text);
  }, onResult: value => results.push(value), onError: error => errors.push(error) });
  t.after(() => scheduler.stop());
  scheduler.submit(turn('a', 1, false, 'ghost')); await flush();
  assert.equal(scheduler.submit(turn('a', 2, false, '')), true); await flush();
  assert.deepEqual(calls, ['ghost']);
  scheduler.submit(turn('a', 3, false, 'actual words')); await flush();
  first.resolve(result('ghost')); await flush();
  assert.deepEqual(errors, []);
  assert.deepEqual(results.map(value => [value.revision, value.text]), [[3, 'actual words']]);
});
