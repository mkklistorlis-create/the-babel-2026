import WebSocket from './vendor/ws/wrapper.mjs';
import { randomUUID } from 'node:crypto';

const LANGUAGES = new Set(['zh', 'en', 'ja', 'es']);
const MAX_BUFFERED_AUDIO = 256 * 1024;
const MAX_TEXT = 2000;
const EPSILON = 0.001;
// Only gate the first recognition of a microphone session. Do not delay audio
// or suppress less certain words once the participant has started speaking.
const STARTUP_MIN_CONFIDENCE = 0.65;
const validConfidence = value => Number.isFinite(value) && value >= 0 && value <= 1;
function transcriptConfidence(alternative, words) {
  if (validConfidence(alternative?.confidence)) return alternative.confidence;
  const values = words.map(word => word.confidence).filter(validConfidence);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
const normalizeLanguage = value => String(value || '').toLowerCase().split(/[-_]/)[0];
const CJK_END = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}。！？、，：；「」『』（）]$/u;
const CJK_START = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}。！？、，：；「」『』（）]/u;
const joinSegments = segments => segments.reduce((text, segment) => {
  if (!text) return segment.text;
  return text + (CJK_END.test(text) && CJK_START.test(segment.text) ? '' : ' ') + segment.text;
}, '').trim();

/** Persistent streaming ASR. Intentional close invalidates every pending event. */
export function createDeepgramStream({
  apiKey, language = 'auto', onReady = () => {}, onTranscript = () => {},
  onError = () => {}, onClose = () => {}, WebSocketImpl = WebSocket,
}) {
  let socket, disposed = false, ready = false, handshakeTimer, keepaliveTimer;
  let turn = null, sequence = 0, closedThrough = -Infinity, audioStartedAt = Date.now();
  let speechEstablished = false;
  const prefix = randomUUID();
  const listeners = [];

  function cleanup() {
    clearTimeout(handshakeTimer); clearInterval(keepaliveTimer);
    handshakeTimer = keepaliveTimer = undefined;
    for (const [event, listener] of listeners) socket?.off?.(event, listener);
    listeners.length = 0;
  }
  function close() {
    if (disposed) return;
    disposed = true; ready = false; turn = null; cleanup();
    // ws emits an error if close() interrupts CONNECTING; retain a no-op handler.
    socket?.on?.('error', () => {});
    try { socket?.close(); } catch { socket?.terminate?.(); }
  }
  function fail(code, message) {
    if (disposed) return;
    const error = new Error(message); error.code = code;
    try { onError(error); } finally { close(); }
  }
  function listen(event, listener) { socket.on(event, listener); listeners.push([event, listener]); }
  function detectedLanguage(segments) {
    const codes = new Set(segments.flatMap(segment => segment.words || [])
      .map(word => normalizeLanguage(word.language)).filter(code => LANGUAGES.has(code)));
    if (codes.size > 1) return 'mixed';
    return codes.values().next().value || (language === 'auto' ? 'und' : language);
  }
  function orderedSegments(includeInterim = true) {
    return [...(turn?.committed.values() || []), ...(includeInterim && turn?.interim ? [turn.interim] : [])]
      .sort((a, b) => a.start - b.start);
  }
  function publish(final = false) {
    if (!turn || disposed) return;
    // An endpoint never upgrades uncommitted recognition hypotheses into facts.
    const segments = orderedSegments(!final);
    const text = joinSegments(segments);
    if (!text && (final || !turn.publishedText)) return;
    if ([...text].length > MAX_TEXT) {
      fail('SPEECH_UTTERANCE_LIMIT', 'A spoken turn exceeded 2000 characters. Start a new speech session.');
      return;
    }
    const resultLanguage = detectedLanguage(segments);
    if (!final && turn.publishedText === text && turn.publishedLanguage === resultLanguage) return;
    turn.publishedText = text; turn.publishedLanguage = resultLanguage;
    const lastEnd = segments.length ? Math.max(...segments.map(segment => segment.end)) : turn.lastEnd;
    onTranscript({type:'transcript', text, language:resultLanguage,
      utteranceId:turn.id, revision:++turn.revision, final,
      startedAt:audioStartedAt + turn.start * 1000,
      endedAt:Math.min(Date.now(), audioStartedAt + lastEnd * 1000)});
  }
  function finish(boundary) {
    if (!turn || disposed || !Number.isFinite(boundary)) return false;
    turn.pendingBoundary = Math.max(turn.pendingBoundary ?? -Infinity, boundary);
    // A pending interim can extend or contradict the committed text. Preserve
    // both until it is finalized/retracted and the boundary covers the result.
    if (turn.interim) return false;
    const segments = orderedSegments(false);
    if (!segments.length) return false;
    const end = Math.max(...segments.map(segment => segment.end));
    // A delayed UtteranceEnd from the previous phrase must not finalize this one.
    if (boundary + EPSILON < end) return false;
    publish(true);
    if (disposed) return false;
    closedThrough = Math.max(closedThrough, end, boundary);
    turn = null;
    return true;
  }
  function receive(raw) {
    if (disposed || !ready) return;
    let message;
    try { message = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
    catch { fail('SPEECH_PROTOCOL_ERROR', 'The speech service returned an invalid message.'); return; }
    if (message.type === 'Error') {
      fail('SPEECH_PROVIDER_ERROR', 'The speech service rejected the audio stream.'); return;
    }
    if (message.type === 'UtteranceEnd') {
      if (Number.isFinite(message.last_word_end) && message.last_word_end > closedThrough + EPSILON) finish(message.last_word_end);
      return;
    }
    if (message.type !== 'Results') return;
    const alternative = message.channel?.alternatives?.[0];
    const text = typeof alternative?.transcript === 'string' ? alternative.transcript.trim() : '';
    const words = Array.isArray(alternative?.words) ? alternative.words : [];
    const start = Number.isFinite(message.start) ? message.start : words[0]?.start;
    const durationEnd = Number.isFinite(start) && Number.isFinite(message.duration) ? start + message.duration : undefined;
    const wordEnd = words.at(-1)?.end;
    const end = Number.isFinite(wordEnd) ? wordEnd : durationEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      if (text) fail('SPEECH_PROTOCOL_ERROR', 'The speech service omitted transcript timestamps.');
      return;
    }
    if (end <= closedThrough + EPSILON) return;
    if (!text) {
      if (!turn) return;
      turn.lastEnd = end;
      const interim = turn.interim;
      // Empty hypotheses retract their corresponding window only, so a late
      // empty result cannot erase a newer nonoverlapping window.
      if (interim && (Math.abs(interim.start - start) <= EPSILON ||
          (start <= interim.start && end + EPSILON >= interim.end))) turn.interim = null;
      const boundary = message.is_final && message.speech_final ? end : turn.pendingBoundary;
      if (!finish(boundary)) publish(false);
      return;
    }
    if (!speechEstablished) {
      const confidence = transcriptConfidence(alternative, words);
      // Silence/startup noise can produce speculative text. Keep it out of both
      // captions and translation, but allow a later corrected result through.
      // Missing confidence remains compatible with provider responses that omit it.
      if (confidence !== null && confidence < STARTUP_MIN_CONFIDENCE) return;
      speechEstablished = true;
    }
    if (!turn) turn = {id:`${prefix}-${++sequence}`, start, lastEnd:end, revision:0, committed:new Map(), interim:null};
    turn.start = Math.min(turn.start, start);
    turn.lastEnd = end;
    const key = start.toFixed(6);
    const segment = {text, words, start, end};
    if (message.is_final) {
      const previous = turn.committed.get(key);
      if (previous && previous.text === text && previous.end === end) {
        finish(message.speech_final ? end : turn.pendingBoundary);
        return;
      }
      turn.committed.set(key, segment);
      if (turn.interim && (Math.abs(turn.interim.start - start) <= EPSILON || turn.interim.end <= end + EPSILON)) turn.interim = null;
    } else {
      const committedEnd = Math.max(-Infinity, ...[...turn.committed.values()].map(item => item.end));
      if (end <= committedEnd + EPSILON) return;
      turn.interim = segment;
    }
    const boundary = message.is_final && message.speech_final ? end : turn.pendingBoundary;
    if (!finish(boundary)) publish(false);
  }

  if (!apiKey || !['auto', ...LANGUAGES].includes(language)) {
    queueMicrotask(() => fail('SPEECH_CONFIGURATION', 'The speech service configuration is incomplete.'));
    return {sendAudio:() => false, close};
  }
  const url = new URL('wss://api.deepgram.com/v1/listen');
  for (const [key, value] of Object.entries({model:'nova-3', language:language === 'auto' ? 'multi' : language,
    interim_results:'true', endpointing:'400', utterance_end_ms:'1000', vad_events:'true',
    encoding:'linear16', sample_rate:'16000', channels:'1', punctuate:'true'})) url.searchParams.set(key, value);
  if (language === 'auto') for (const code of LANGUAGES) url.searchParams.append('language_hint', code);
  try { socket = new WebSocketImpl(url.toString(), {headers:{Authorization:`Token ${apiKey}`}}); }
  catch { queueMicrotask(() => fail('SPEECH_CONNECTION_ERROR', 'The speech service could not be connected.')); return {sendAudio:() => false, close}; }
  listen('open', () => {
    if (disposed) return;
    clearTimeout(handshakeTimer); ready = true; audioStartedAt = Date.now();
    keepaliveTimer = setInterval(() => {
      if (disposed || !ready) return;
      try { socket.send(JSON.stringify({type:'KeepAlive'})); }
      catch { fail('SPEECH_CONNECTION_ERROR', 'The speech connection was interrupted.'); }
    }, 4000);
    keepaliveTimer.unref?.(); onReady();
  });
  listen('message', receive);
  listen('error', () => fail('SPEECH_CONNECTION_ERROR', 'The speech service connection failed. Check its configuration and retry.'));
  listen('close', code => {
    if (disposed) return;
    disposed = true; ready = false; turn = null; cleanup();
    onClose({code:Number.isFinite(code) ? code : 1006, message:'The speech service connection closed.'});
  });
  handshakeTimer = setTimeout(() => fail('SPEECH_CONNECTION_TIMEOUT', 'The speech service did not connect within 10 seconds.'), 10000);
  handshakeTimer.unref?.();
  return {
    sendAudio(buffer) {
      if (disposed || !ready) return false;
      const size = buffer?.byteLength ?? buffer?.length;
      if (!Number.isFinite(size) || size <= 0) return false;
      if ((socket.bufferedAmount || 0) + size > MAX_BUFFERED_AUDIO) {
        fail('SPEECH_BACKPRESSURE', 'The speech connection is too slow. Start a new session.'); return false;
      }
      try { socket.send(buffer, {binary:true}); return true; }
      catch { fail('SPEECH_CONNECTION_ERROR', 'The speech connection was interrupted.'); return false; }
    }, close,
  };
}
