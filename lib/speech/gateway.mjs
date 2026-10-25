import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from './vendor/ws/wrapper.mjs';
import { createInterpreter, SemanticScheduler } from './semantics.mjs';
import { createDeepgramStream } from './deepgram.mjs';

const LANGUAGES = ['zh', 'en', 'ja', 'es'];
const DEFAULT_SESSION_MS = 240_000;
const AUTH_TIMEOUT_MS = 10_000;
const PUBLIC_PROVIDER_CODES = new Set(['INVALID_TRANSCRIPT', 'INVALID_LANGUAGE', 'INVALID_SEMANTIC_OUTPUT', 'INVALID_SEMANTIC_URL', 'INVALID_SEMANTIC_MODEL', 'MISSING_SEMANTIC_KEY', 'SEMANTIC_TIMEOUT', 'SEMANTIC_PROVIDER_ERROR', 'SEMANTIC_REFUSAL', 'SEMANTIC_NETWORK_ERROR', 'SEMANTIC_QUEUE_FULL', 'SPEECH_UTTERANCE_LIMIT', 'SPEECH_PROTOCOL_ERROR', 'SPEECH_PROVIDER_ERROR', 'SPEECH_CONFIGURATION', 'SPEECH_CONNECTION_ERROR', 'SPEECH_CONNECTION_TIMEOUT', 'SPEECH_BACKPRESSURE']);
const providerCode = (error, fallback) => PUBLIC_PROVIDER_CODES.has(error?.code) ? error.code : fallback;
const secret = value => typeof value === 'string' ? value.trim() : '';
const isRemote = env => typeof env.VERCEL !== 'undefined';
const validLocalHost = host => /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host || '');

/** Public readiness only. API keys, endpoint URLs and access codes never leave the server. */
export function getSpeechConfig(env = process.env) {
  const speechConfigured = Boolean(secret(env.DEEPGRAM_API_KEY));
  const semanticConfigured = Boolean(secret(env.SEMANTIC_API_KEY) || secret(env.OPENAI_API_KEY));
  const accessConfigured = false;
  const accessRequired = false;
  return { speechConfigured, semanticConfigured, accessRequired, accessConfigured,
    enabled: speechConfigured && semanticConfigured && (!accessRequired || accessConfigured),
    maxSessionMs: DEFAULT_SESSION_MS, languages: [...LANGUAGES] };
}

export function acceptsSpeechOrigin(req, env = process.env) {
  const host = req.headers?.host;
  if (typeof host !== 'string' || host.length > 260) return false;
  if (!isRemote(env)) return validLocalHost(host) && req.headers.origin === `http://${host}`;
  // Trust the request Host, never an arbitrary forwarded host or origin suffix.
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i.test(host)) return false;
  return req.headers.origin === `https://${host}`;
}

/** Attach only the speech upgrade endpoint; the caller owns the HTTP server. */
export function createSemanticGateway({ server, env = process.env, interpreter,
  speechFactory = createDeepgramStream, createWebSocketServer = options => new WebSocketServer(options),
  maxSessionMs = DEFAULT_SESSION_MS, maxSessions = 4 } = {}) {
  if (!server || typeof server.on !== 'function' || typeof server.off !== 'function') throw new TypeError('An HTTP server is required.');
  if (!Number.isFinite(maxSessionMs) || maxSessionMs < 1 || maxSessionMs > DEFAULT_SESSION_MS || !Number.isSafeInteger(maxSessions) || maxSessions < 1) throw new TypeError('Invalid speech session limits.');
  const config = { ...getSpeechConfig(env), maxSessionMs };
  const sessions = new Set();
  let disposed = false, interpretProvider = interpreter;
  const wss = createWebSocketServer({ noServer: true, maxPayload: 16_384, perMessageDeflate: false });

  const upgrade = (req, socket, head) => {
    if (disposed || !acceptsSpeechOrigin(req, env) || req.url !== '/api/semantic-stream' || sessions.size >= maxSessions) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  };
  server.on('upgrade', upgrade);

  wss.on('connection', ws => {
    if (disposed || sessions.size >= maxSessions) { ws.close(1013, 'Instance session limit'); return; }
    sessions.add(ws);
    let closed = false, authenticated = false, mode = null, speech, audioReady = false;
    let count = 0, second = Date.now(), textCount = 0, minute = Date.now(), expiry, authExpiry;
    const seenIds = new Set();
    const send = data => {
      if (!closed && ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 262_144) { shutdown(); ws.terminate(); return; }
        try { ws.send(JSON.stringify(data)); } catch { shutdown(); ws.terminate(); }
      }
    };
    const fail = (code, message, fatal = false, extra = {}) => {
      send({ type: 'error', code, message, fatal, ...extra });
      if (fatal) { shutdown(); ws.close(1008, 'Session stopped'); }
    };
    let targetLanguage;
    const makeScheduler = () => new SemanticScheduler({
      interpret: (...args) => {
        if (!authenticated || closed) throw new Error('Session is not authenticated.');
        if (!interpretProvider) interpretProvider = createInterpreter({
          apiKey: secret(env.SEMANTIC_API_KEY) || secret(env.OPENAI_API_KEY),
          baseUrl: env.SEMANTIC_BASE_URL || 'https://api.openai.com/v1', model: env.SEMANTIC_MODEL || 'gpt-4.1-mini',
        });
        return interpretProvider(...args);
      },
      onResult: send,
      onError: (error, input) => fail(providerCode(error, 'SEMANTIC_ERROR'), publicError(providerCode(error, 'SEMANTIC_ERROR')), false, { utteranceId: input?.utteranceId, revision: input?.revision }),
    });
    let scheduler = makeScheduler();
    function setTarget(value) {
      if (value !== targetLanguage) { scheduler.stop(); scheduler = makeScheduler(); targetLanguage = value; }
    }
    function shutdown() {
      if (closed) return;
      closed = true; clearTimeout(authExpiry); clearTimeout(expiry); scheduler.stop();
      try { speech?.close(); } catch { /* The transport must still be released. */ } finally { sessions.delete(ws); }
    }
    function authenticate(msg) {
      if (authenticated) return true;
      delete msg.accessCode; // Ignore credentials from older clients.
      authenticated = true; clearTimeout(authExpiry);
      expiry = setTimeout(() => fail('SESSION_LIMIT', '本次语音连接已达 4 分钟，请点击开始重新连接。', true), maxSessionMs);
      expiry.unref?.();
      return true;
    }
    authExpiry = setTimeout(() => fail('AUTH_TIMEOUT', '连接等待超过 10 秒，请重新开始。', true), AUTH_TIMEOUT_MS);
    authExpiry.unref?.();
    ws.on('close', shutdown); ws.on('error', shutdown);
    ws.on('message', (data, isBinary) => {
      if (closed) return;
      const now = Date.now();
      if (now - second >= 1000) { second = now; count = 0; }
      if (++count > 100) return fail('RATE_LIMIT', '输入过快，请重新开始。', true);
      if (data.length > 16_384) return fail('INVALID_MESSAGE', '消息过大。', true);
      if (isBinary) {
        if (!authenticated) return fail('ACCESS_REQUIRED', '请先开始经过验证的语音连接。', true);
        if (mode !== 'audio' || !audioReady || !speech || data.length % 2 || data.length > 8192) return fail('INVALID_AUDIO', '音频格式或会话状态无效。', true);
        try { speech.sendAudio(data); } catch { fail('SPEECH_STREAM_ERROR', '语音连接已中断，请重新开始。', true); }
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return fail('INVALID_MESSAGE', '消息格式无效。', true); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return fail('INVALID_MESSAGE', '消息格式无效。', true);
      if (msg.type === 'stop') { shutdown(); ws.close(1000, 'Stopped'); return; }
      if (!authenticated) {
        if (!['start', 'interpret'].includes(msg.type)) return fail('ACCESS_REQUIRED', '请先开始经过验证的语音连接。', true);
        if (!authenticate(msg)) return;
      }
      if (['start', 'interpret', 'target-language'].includes(msg.type) && msg.targetLanguage !== undefined && !LANGUAGES.includes(msg.targetLanguage)) return fail('INVALID_CONFIG', '请选择中文、英语、日语或西班牙语作为译文语言。');
      if (msg.type === 'target-language') {
        if (!mode || !LANGUAGES.includes(msg.targetLanguage)) return fail('INVALID_CONFIG', '请先开始语音连接。');
        setTarget(msg.targetLanguage); return;
      }
      if (msg.type === 'start') {
        if (mode) return fail('ALREADY_STARTED', '连接已经开始。', true);
        if (!['auto', ...LANGUAGES].includes(msg.language) || msg.sampleRate !== 16000) return fail('INVALID_CONFIG', '请选择支持的语言并使用 16 kHz PCM 音频。', true);
        if (!config.speechConfigured || !config.semanticConfigured) return fail('MISSING_KEYS', '语音和语义服务尚未配置，请联系网站管理员。', true);
        setTarget(msg.targetLanguage);
        mode = 'audio';
        try {
          speech = speechFactory({ apiKey: secret(env.DEEPGRAM_API_KEY), language: msg.language,
            onReady: () => { if (!closed) { audioReady = true; send({ type: 'ready' }); } },
            onTranscript: input => { if (!closed) { send({ type: 'transcript', ...input }); scheduler.submit({...input, targetLanguage}); } },
            onError: error => fail(providerCode(error, 'SPEECH_ERROR'), '语音服务连接失败。请检查密钥、网络及账户用量。', true),
            onClose: () => { if (!closed) fail('SPEECH_CLOSED', '语音服务已断开，请重新开始。', true); },
          });
          // A provider can invoke an error callback synchronously while opening.
          if (closed) speech?.close();
        } catch { fail('SPEECH_ERROR', '语音服务无法启动。', true); }
        return;
      }
      if (msg.type === 'interpret') {
        if (mode === 'audio') return fail('MODE_CONFLICT', '请先停止麦克风，再测试文字。');
        if (!config.semanticConfigured) return fail('MISSING_SEMANTIC_KEY', '语义服务尚未配置，请联系网站管理员。');
        if (typeof msg.text !== 'string' || !msg.text.trim() || msg.text.length > 2000 || !['auto', ...LANGUAGES].includes(msg.language)) return fail('INVALID_TEXT', '请输入 1–2000 字，并选择支持的语言。');
        if (now - minute >= 60_000) { minute = now; textCount = 0; }
        if (++textCount > 20) return fail('RATE_LIMIT', '文字测试每分钟最多 20 次。');
        const id = typeof msg.utteranceId === 'string' && /^[\w-]{1,96}$/.test(msg.utteranceId) ? msg.utteranceId : randomUUID();
        if (seenIds.has(id)) return fail('DUPLICATE_ID', '请使用新的话语编号。');
        seenIds.add(id); if (seenIds.size > 256) seenIds.delete(seenIds.values().next().value);
        setTarget(msg.targetLanguage);
        mode = 'text';
        const input = { type: 'transcript', text: msg.text.trim(), language: msg.language, utteranceId: id, revision: 1, final: true, startedAt: now, endedAt: now, source: 'text' };
        send(input); scheduler.submit({...input, targetLanguage}); return;
      }
      fail('INVALID_MESSAGE', '不支持的消息类型。');
    });
  });
  return { config, close() {
    if (disposed) return;
    disposed = true; server.off('upgrade', upgrade);
    for (const ws of sessions) ws.terminate();
    wss.close();
  } };
}

function publicError(code) {
  if (code === 'MISSING_SEMANTIC_KEY') return '语义 API Key 未配置。';
  if (/TIMEOUT/.test(code || '')) return '语义服务超时，请重试。';
  if (/QUEUE/.test(code || '')) return '语义处理暂时跟不上输入，请稍后继续。';
  if (/VALID|SCHEMA|JSON|EVIDENCE/.test(code || '')) return '模型返回的语义格式或原文证据无效，本条结果未采用。';
  return '语义服务请求失败，请检查模型、密钥、网络和账户用量。';
}
