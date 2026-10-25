import { performance } from 'node:perf_hooks';
import { buildSemanticMessages, normalizeLanguage } from './languages.mjs';

const INTENTS = new Set(['statement', 'question', 'request', 'evaluate', 'agree', 'disagree', 'greeting', 'other']);
const DEGREES = new Set(['none', 'mild', 'moderate', 'strong', 'unknown']);
const POLARITIES = new Set(['positive', 'negative', 'neutral', 'mixed', 'unknown']);
const FIELDS = ['meaning', 'intent', 'target', 'attributes', 'degree', 'polarity', 'uncertain', 'evidence'];

export class SemanticError extends Error {
  constructor(code, message) { super(message); this.name = 'SemanticError'; this.code = code; }
}
function fail(code, message) { throw new SemanticError(code, message); }
function normalizeInput(input) {
  if (!input || typeof input !== 'object' || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000) fail('INVALID_TRANSCRIPT', 'Transcript must contain 1–4000 characters.');
  if (typeof input.final !== 'boolean') fail('INVALID_TRANSCRIPT', 'Transcript final must be a boolean.');
  return { ...input, language: normalizeLanguage(input.language ?? 'auto') };
}

/** The model supplies an interpretation; validation checks shape and grounding. */
export function validateSemanticOutput(output, sourceText) {
  const invalid = () => fail('INVALID_SEMANTIC_OUTPUT', 'The semantic provider returned an invalid or ungrounded result.');
  if (!output || typeof output !== 'object' || Array.isArray(output)) invalid();
  const keys = Object.keys(output);
  if (keys.length !== FIELDS.length || keys.some(key => !FIELDS.includes(key))) invalid();
  if (typeof output.meaning !== 'string' || !output.meaning.trim() || output.meaning.length > 600) invalid();
  if (typeof output.target !== 'string' || output.target.length > 200) invalid();
  if (!INTENTS.has(output.intent) || !DEGREES.has(output.degree) || !POLARITIES.has(output.polarity)) invalid();
  if (typeof output.uncertain !== 'boolean') invalid();
  if (!Array.isArray(output.attributes) || output.attributes.length > 12 || output.attributes.some(v => typeof v !== 'string' || !v.trim() || v.length > 80)) invalid();
  if (!Array.isArray(output.evidence) || output.evidence.length < 1 || output.evidence.length > 8 || output.evidence.some(v => typeof v !== 'string' || !v.trim() || v.length > 160 || !sourceText.includes(v))) invalid();
  return Object.fromEntries(FIELDS.map(key => [key, Array.isArray(output[key]) ? [...output[key]] : output[key]]));
}

function apiEndpoint(baseUrl) {
  let parsed;
  try { parsed = new URL(baseUrl); } catch { fail('INVALID_SEMANTIC_URL', 'Invalid semantic provider URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) || parsed.username || parsed.password || parsed.search || parsed.hash) fail('INVALID_SEMANTIC_URL', 'The semantic provider must use HTTPS, or HTTP on localhost, without URL credentials.');
  return `${parsed.href.replace(/\/+$/, '')}/chat/completions`;
}
function abortReason(signal) { return signal.reason instanceof Error ? signal.reason : new DOMException('Operation aborted.', 'AbortError'); }
/** Stop awaiting adapters that fail to observe AbortSignal. */
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => { cleanup(); reject(abortReason(signal)); };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(v => { cleanup(); resolve(v); }, e => { cleanup(); reject(e); });
  });
}

export function createInterpreter({ apiKey, baseUrl = 'https://api.openai.com/v1', model = 'gpt-4.1-mini', fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const endpoint = apiEndpoint(baseUrl);
  if (typeof model !== 'string' || !model.trim() || model.length > 160) fail('INVALID_SEMANTIC_MODEL', 'Invalid semantic model name.');
  if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError('A fetch implementation and positive timeout are required.');
  return async function interpret(rawInput, { signal } = {}) {
    const input = normalizeInput(rawInput);
    if (typeof apiKey !== 'string' || !apiKey.trim()) fail('MISSING_SEMANTIC_KEY', 'Configure SEMANTIC_API_KEY or OPENAI_API_KEY to enable semantic interpretation.');
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new SemanticError('SEMANTIC_TIMEOUT', 'Semantic interpretation timed out.')), timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    try {
      if (requestSignal.aborted) throw abortReason(requestSignal);
      const response = await abortable(fetchImpl(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 600, response_format: { type: 'json_object' }, messages: buildSemanticMessages(input) }),
        signal: requestSignal,
      }), requestSignal);
      if (!response.ok) fail('SEMANTIC_PROVIDER_ERROR', `Semantic provider request failed (HTTP ${response.status}).`);
      const body = await abortable(response.text(), requestSignal);
      if (body.length > 128000) fail('INVALID_SEMANTIC_OUTPUT', 'Semantic provider response exceeded the size limit.');
      let envelope;
      try { envelope = JSON.parse(body); } catch { fail('INVALID_SEMANTIC_OUTPUT', 'Semantic provider returned malformed JSON.'); }
      const choice = envelope.choices?.[0];
      if (choice?.message?.refusal) fail('SEMANTIC_REFUSAL', 'The semantic provider could not interpret this input.');
      if (choice?.finish_reason && choice.finish_reason !== 'stop') fail('INVALID_SEMANTIC_OUTPUT', 'Semantic provider response was incomplete.');
      if (typeof choice?.message?.content !== 'string') fail('INVALID_SEMANTIC_OUTPUT', 'Semantic provider returned no JSON interpretation.');
      let output;
      try { output = JSON.parse(choice.message.content); } catch { fail('INVALID_SEMANTIC_OUTPUT', 'Semantic provider returned malformed interpretation JSON.'); }
      return validateSemanticOutput(output, input.text);
    } catch (error) {
      if (requestSignal.aborted) throw abortReason(requestSignal);
      if (error instanceof SemanticError) throw error;
      throw new SemanticError('SEMANTIC_NETWORK_ERROR', 'Unable to reach the semantic provider.');
    } finally { clearTimeout(timer); }
  };
}

/** One request at a time; finals queue in order and partials coalesce. */
export class SemanticScheduler {
  constructor({ interpret, onResult, onError = () => {}, partialIntervalMs = 650, maxPendingFinals = 8, maxPartialAgeMs = 1500 } = {}) {
    if (typeof interpret !== 'function' || typeof onResult !== 'function' || typeof onError !== 'function') throw new TypeError('Scheduler callbacks are required.');
    if (!Number.isFinite(partialIntervalMs) || partialIntervalMs < 0 || !Number.isSafeInteger(maxPendingFinals) || maxPendingFinals < 1 || !Number.isFinite(maxPartialAgeMs) || maxPartialAgeMs <= 0) throw new TypeError('Invalid scheduler limits.');
    Object.assign(this, { interpret, onResult, onError, partialIntervalMs, maxPendingFinals, maxPartialAgeMs });
    this.latest = new Map(); this.finalQueue = []; this.pendingPartial = null; this.active = null;
    this.context = []; this.stopped = false; this.lastPartialStarted = -Infinity; this.timer = null; this.sequence = 0; this.currentUtteranceId = null;
  }

  submit(rawInput) {
    if (this.stopped) return false;
    let input;
    try {
      // An empty intermediate transcript withdraws an earlier ASR hypothesis.
      // Preserve its revision fence without submitting empty text to the model.
      input = rawInput?.final === false && typeof rawInput.text === 'string' && !rawInput.text.trim()
        ? { ...rawInput, text: '', language: normalizeLanguage(rawInput.language ?? 'auto'), _withdrawn: true }
        : normalizeInput(rawInput);
      if (typeof input.utteranceId !== 'string' || !input.utteranceId || input.utteranceId.length > 128 || !Number.isSafeInteger(input.revision) || input.revision < 0) fail('INVALID_TRANSCRIPT', 'An utterance ID and nonnegative integer revision are required.');
    } catch (error) { this.onError(error, rawInput); return false; }
    const previous = this.latest.get(input.utteranceId);
    if (previous?.delivered || (previous?.final && !input.final)) return false;
    if (previous && !input.final && input.utteranceId !== this.currentUtteranceId) return false;
    if (previous && (input.revision < previous.revision || (input.revision === previous.revision && !(input.final && !previous.final)))) return false;
    const queuedIndex = this.finalQueue.findIndex(job => job.utteranceId === input.utteranceId);
    if (input.final && queuedIndex < 0 && this.finalQueue.length >= this.maxPendingFinals) {
      this.onError(new SemanticError('SEMANTIC_QUEUE_FULL', 'Semantic final queue is full; reduce input rate or use a faster model.'), input); return false;
    }
    const job = { ...input, _receivedAt: performance.now(), _sequence: ++this.sequence };
    if (!previous) this.currentUtteranceId = input.utteranceId;
    this.latest.set(input.utteranceId, { revision: input.revision, final: input.final, sequence: job._sequence, delivered: false,
      lastMeaningRevision: previous?.lastMeaningRevision ?? -1,
      withdrawnRevision: input._withdrawn ? input.revision : (previous?.withdrawnRevision ?? -1), withdrawn: Boolean(input._withdrawn) });
    if (input._withdrawn) {
      if (this.pendingPartial?.utteranceId === input.utteranceId) this.pendingPartial = null;
      if (this.active && !this.active.job.final && (this.active.job.utteranceId === input.utteranceId || this.active.job.utteranceId !== this.currentUtteranceId)) this.active.controller.abort();
      this.trimHistory(); this.pump(); return true;
    }
    if (input.final) {
      if (queuedIndex >= 0) this.finalQueue[queuedIndex] = job;
      else if (this.active?.job.final && this.active.job.utteranceId === input.utteranceId) this.finalQueue.unshift(job);
      else this.finalQueue.push(job);
      if (this.pendingPartial?.utteranceId === input.utteranceId) this.pendingPartial = null;
      // A late final for an earlier turn can preempt a fresh preview. Keep that
      // preview available after the final instead of silently dropping it.
      if (this.active && !this.active.job.final && this.active.job.utteranceId !== input.utteranceId && this.isCurrent(this.active.job) && (!this.pendingPartial || this.pendingPartial._sequence < this.active.job._sequence)) this.pendingPartial = this.active.job;
      if (this.active && (!this.active.job.final || this.active.job.utteranceId === input.utteranceId)) this.active.controller.abort();
    } else {
      this.pendingPartial = job;
      if (this.active && !this.active.job.final && this.active.job.utteranceId !== input.utteranceId) this.active.controller.abort();
    }
    this.trimHistory(); this.pump(); return true;
  }

  trimHistory() {
    if (this.latest.size <= 256) return;
    const protectedIds = new Set(this.finalQueue.map(job => job.utteranceId));
    if (this.active) protectedIds.add(this.active.job.utteranceId);
    if (this.pendingPartial) protectedIds.add(this.pendingPartial.utteranceId);
    for (const id of this.latest.keys()) {
      if (!protectedIds.has(id)) this.latest.delete(id);
      if (this.latest.size <= 128) break;
    }
  }
  isCurrent(job) {
    const latest = this.latest.get(job.utteranceId);
    return !this.stopped && latest?.sequence === job._sequence && !latest.delivered && !latest.withdrawn && (job.final || job.utteranceId === this.currentUtteranceId);
  }
  mayPublish(job) {
    if (job.final) return this.isCurrent(job);
    const latest = this.latest.get(job.utteranceId);
    // A live ASR can revise faster than a model can finish. A bounded snapshot
    // can still be a useful provisional, with its own exact text and revision.
    return !this.stopped && job.utteranceId === this.currentUtteranceId && latest && !latest.final && !latest.delivered && !latest.withdrawn
      && job.revision > latest.lastMeaningRevision && job.revision > latest.withdrawnRevision
      && performance.now() - job._receivedAt <= this.maxPartialAgeMs;
  }
  pump() {
    if (this.stopped || this.active) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    let job = this.finalQueue.shift();
    if (!job && this.pendingPartial) {
      const delay = this.partialIntervalMs - (performance.now() - this.lastPartialStarted);
      if (delay > 0) { this.timer = setTimeout(() => { this.timer = null; this.pump(); }, delay); return; }
      job = this.pendingPartial; this.pendingPartial = null; this.lastPartialStarted = performance.now();
    }
    if (!job) return;
    if (!this.isCurrent(job)) { this.pump(); return; }
    const controller = new AbortController();
    const active = { job, controller }; this.active = active;
    const context = this.context.map(turn => ({ ...turn }));
    const request = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw abortReason(controller.signal);
      return this.interpret({ text: job.text, language: job.language, final: job.final, context }, { signal: controller.signal });
    });
    abortable(request, controller.signal).then(output => {
      if (!this.mayPublish(job)) return;
      const fields = validateSemanticOutput(output, job.text);
      this.latest.get(job.utteranceId).lastMeaningRevision = job.revision;
      if (job.final) {
        this.latest.get(job.utteranceId).delivered = true;
        this.context.push({ text: job.text, language: job.language, meaning: fields.meaning }); this.context = this.context.slice(-3);
      }
      this.onResult({ type: 'meaning', stage: job.final ? 'final' : 'partial', utteranceId: job.utteranceId, revision: job.revision, language: job.language, text: job.text, ...fields,
        // Queue + inference elapsed time, not microphone-to-output latency.
        latencyMs: Math.round(performance.now() - job._receivedAt) });
    }).catch(error => {
      if (this.isCurrent(job) && !controller.signal.aborted) this.onError(error, job);
    }).finally(() => { if (this.active === active) this.active = null; this.pump(); });
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.active?.controller.abort(); this.pendingPartial = null; this.finalQueue = []; this.context = []; this.latest.clear(); this.currentUtteranceId = null;
  }
}
