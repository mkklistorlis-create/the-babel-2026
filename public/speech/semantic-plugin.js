const LANGUAGES = new Set(['auto', 'zh', 'en', 'ja', 'es']);
const MESSAGES = {
  NotAllowedError: 'Microphone permission denied. Enable microphone access for this site.',
  NotFoundError: 'No microphone was found.',
  NotReadableError: 'The microphone could not be opened.'
};
const failure = (code, message) => Object.assign(new Error(message), { code });
const stopped = () => Object.assign(failure('STOPPED', 'Session stopped.'), { name: 'AbortError' });

/** Constructing the plugin never activates the microphone. Call start() from a button. */
export class SemanticPlugin extends EventTarget {
  constructor(options = {}) {
    super();
    this.language = options.language ?? 'auto';
    this.targetLanguage = options.targetLanguage;
    this.accessCode = options.accessCode ?? '';
    if (!LANGUAGES.has(this.language)) throw new TypeError('Unsupported language.');
    this.platform = options.platform ?? globalThis;
    const location = this.platform.location;
    const endpoint = options.endpoint ?? `${location?.protocol === 'https:' ? 'wss:' : 'ws:'}//${location?.host ?? '127.0.0.1:4180'}/api/semantic-stream`;
    const url = new URL(endpoint, location?.href);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new TypeError('Endpoint must use ws: or wss:.');
    this.endpoint = url.href;
    this.configUrl = options.configUrl ?? `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}/api/semantic-config`;
    this.workletUrl = options.workletUrl ?? new URL('./pcm-worklet.js', import.meta.url).href;
    this.maxBufferedBytes = options.maxBufferedBytes ?? 256 * 1024;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15000;
    this.session = null;
    this.destroyed = false;
    this.counter = 0;
    this.pagehide = () => this.stop();
    this.platform.addEventListener?.('pagehide', this.pagehide);
  }

  start() {
    if (this.destroyed) return Promise.reject(failure('DESTROYED', 'Plugin has been destroyed.'));
    if (this.session?.mode === 'microphone') return this.session.startPromise;
    this.stop();
    const session = this._newSession('microphone');
    session.startPromise = this._startMicrophone(session).catch(error => {
      if (this._current(session)) { this._emitError(error); this.stop(); }
      throw error;
    });
    return session.startPromise;
  }

  async _startMicrophone(session) {
    const Context = this.platform.AudioContext ?? this.platform.webkitAudioContext;
    if (!Context || !this.platform.AudioWorkletNode || !this.platform.navigator?.mediaDevices?.getUserMedia) {
      throw failure('UNSUPPORTED', 'Microphone streaming requires a secure context with AudioWorklet support.');
    }
    session.audioContext = new Context();
    // Preserve the user gesture for audio resume; network configuration is checked before mic capture.
    const resumed = session.audioContext.resume();
    resumed.catch(() => {});
    await this._config(session, true);
    const mediaPromise = this.platform.navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false
    }).then(stream => {
      if (!this._current(session)) { for (const track of stream.getTracks()) track.stop(); throw stopped(); }
      session.stream = stream;
      return stream;
    });
    await this._abortable(mediaPromise, session);
    this._assertCurrent(session);
    await this._abortable(resumed, session);
    await this._abortable(session.audioContext.audioWorklet.addModule(this.workletUrl), session);
    await this._openSocket(session);
    this._assertCurrent(session);
    const ready = this._waitReady(session);
    session.startedTarget = this.targetLanguage;
    try { session.socket.send(JSON.stringify({ type: 'start', language: this.language, targetLanguage: this.targetLanguage, sampleRate: 16000, accessCode: session.accessCode })); }
    catch (error) { session.readyWaiter.reject(error); }
    await ready;
    this._assertCurrent(session);
    session.source = session.audioContext.createMediaStreamSource(session.stream);
    session.worklet = new this.platform.AudioWorkletNode(session.audioContext, 'semantic-pcm', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
    });
    session.worklet.port.onmessage = ({ data }) => {
      if (!this._current(session) || !session.ready || !(data instanceof ArrayBuffer)) return;
      if (session.socket.readyState !== 1) return;
      if (session.socket.bufferedAmount + data.byteLength > this.maxBufferedBytes) {
        this._emitError(failure('BACKPRESSURE', 'Audio connection is too slow. Streaming stopped to avoid delayed results.'));
        this.stop();
        return;
      }
      try { session.socket.send(data); }
      catch { this._emitError(failure('CONNECTION_FAILED', 'Audio connection failed.')); this.stop(); }
    };
    session.worklet.onprocessorerror = () => {
      if (!this._current(session)) return;
      this._emitError(failure('AUDIO_PROCESSOR', 'Audio processing failed. Please restart the microphone.'));
      this.stop();
    };
    session.source.connect(session.worklet);
    session.worklet.connect(session.audioContext.destination);
    for (const track of session.stream.getAudioTracks()) track.addEventListener('ended', () => {
      if (!this._current(session)) return;
      this._emitError(failure('MICROPHONE_ENDED', 'Microphone input ended.'));
      this.stop();
    }, { once: true });
    this._emit('status', { type: 'status', state: 'listening', message: 'Microphone streaming is active.' });
  }

  /** Sends actual text to the configured model without requesting microphone permission. */
  async interpret(text, { language = this.language } = {}) {
    if (this.destroyed) throw failure('DESTROYED', 'Plugin has been destroyed.');
    if (!LANGUAGES.has(language)) throw new TypeError('Unsupported language.');
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new TypeError('Text must contain 1–2000 characters.');
    if (this.session?.mode === 'microphone') throw failure('MODE_CONFLICT', 'Stop microphone streaming before sending a text request.');
    let session = this.session;
    if (!session) {
      session = this._newSession('text');
      session.connectionPromise = this._config(session, false).then(() => this._openSocket(session));
      session.connectionPromise.catch(() => {});
    }
    try {
      await session.connectionPromise;
      this._assertCurrent(session);
      const utteranceId = `text-${Date.now()}-${++this.counter}`;
      session.socket.send(JSON.stringify({ type: 'interpret', text: text.trim(), language, targetLanguage: this.targetLanguage, utteranceId, revision: 1, final: true, accessCode: session.accessCode }));
      return utteranceId;
    } catch (error) {
      if (this._current(session)) { this._emitError(error); this.stop(); }
      throw error;
    }
  }

  stop() {
    const session = this.session;
    if (!session) return;
    this.session = null;
    session.abort.abort();
    for (const waiter of [...session.waiters]) waiter.reject(stopped());
    session.waiters.clear();
    if (session.worklet) {
      session.worklet.port.onmessage = null;
      session.worklet.onprocessorerror = null;
      try { session.worklet.port.postMessage('stop'); session.worklet.port.close(); session.worklet.disconnect(); } catch {}
    }
    try { session.source?.disconnect(); } catch {}
    for (const track of session.stream?.getTracks() ?? []) track.stop();
    if (session.audioContext && session.audioContext.state !== 'closed') {
      try { Promise.resolve(session.audioContext.close()).catch(() => {}); } catch {}
    }
    if (session.socket) {
      try {
        if (session.socket.readyState === 1) session.socket.send(JSON.stringify({ type: 'stop' }));
        if (session.socket.readyState < 2) session.socket.close(1000, 'Client stopped');
      } catch {}
    }
    this._emit('status', { type: 'status', state: 'stopped', message: 'Session stopped.' });
  }

  destroy() {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.platform.removeEventListener?.('pagehide', this.pagehide);
  }

  _newSession(mode) {
    const session = { mode, accessCode: typeof this.accessCode === 'string' ? this.accessCode : '', abort: new AbortController(), waiters: new Set(), ready: false, revisions: new Map(), transcripts: new Map(), currentUtteranceId: null };
    this.session = session;
    this._emit('status', { type: 'status', state: 'connecting', message: 'Connecting to semantic service.' });
    return session;
  }
  setTargetLanguage(language) {
    if (!['zh','en','ja','es'].includes(language)) throw new TypeError('Unsupported translation language.');
    if (language === this.targetLanguage) return;
    this.targetLanguage = language;
    const session = this.session;
    session?.revisions.clear();
    if (session?.ready && session.socket?.readyState === 1) session.socket.send(JSON.stringify({type:'target-language',targetLanguage:language}));
  }
  _current(session) { return this.session === session && !session.abort.signal.aborted && !this.destroyed; }
  _assertCurrent(session) { if (!this._current(session)) throw stopped(); }
  _emit(name, data) { if (!this.destroyed) this.dispatchEvent(new CustomEvent(name, { detail: data })); }
  _emitError(error) {
    this._emit('error', { type: 'error', code: error.code ?? error.name ?? 'CLIENT_ERROR', message: MESSAGES[error.name] ?? error.message ?? 'Client error.', fatal: true });
  }

  async _config(session, speech) {
    const response = await this._abortable(this.platform.fetch(this.configUrl, { signal: session.abort.signal, credentials: 'same-origin' }), session);
    if (!response.ok) throw failure('CONFIG_FAILED', 'Could not read server configuration.');
    const config = await this._abortable(response.json(), session);
    this._assertCurrent(session);
    if (config.accessRequired && !config.accessConfigured) throw failure('ACCESS_NOT_CONFIGURED', '站点尚未配置语音访问码，请联系演示者。');
    if (config.accessRequired && !session.accessCode.trim()) throw failure('ACCESS_REQUIRED', '请填写演示者提供的语音访问码。');
    if (speech && !config.speechConfigured) throw failure('SPEECH_NOT_CONFIGURED', 'Set DEEPGRAM_API_KEY on the server before starting the microphone.');
    if (!config.semanticConfigured) throw failure('SEMANTIC_NOT_CONFIGURED', 'Set a semantic model API key on the server before continuing.');
  }

  _openSocket(session) {
    this._assertCurrent(session);
    const socket = new this.platform.WebSocket(this.endpoint);
    session.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', event => this._message(session, event));
    socket.addEventListener('close', () => {
      if (!this._current(session)) return;
      for (const waiter of [...session.waiters]) waiter.reject(failure('CONNECTION_CLOSED', 'Connection closed before the session was ready.'));
      this._emitError(failure('CONNECTION_CLOSED', 'Connection closed. Restart to reconnect.'));
      this.stop();
    });
    return this._wait(session, (resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(failure('CONNECTION_FAILED', 'Could not connect to the semantic server.')), { once: true });
    }, 'Connection timed out.');
  }
  _waitReady(session) {
    return this._wait(session, (resolve, reject) => { session.readyWaiter = { resolve, reject }; }, 'Speech service did not become ready in time.');
  }
  _wait(session, setup, timeoutMessage) {
    return new Promise((resolve, reject) => {
      let timer;
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        session.waiters.delete(waiter);
        fn(value);
      };
      const waiter = { resolve: value => finish(resolve, value), reject: error => finish(reject, error) };
      session.waiters.add(waiter);
      timer = setTimeout(() => waiter.reject(failure('TIMEOUT', timeoutMessage)), this.connectTimeoutMs);
      setup(waiter.resolve, waiter.reject);
    });
  }
  _abortable(promise, session) {
    // Attach a rejection handler even if stop happened before this call.
    if (session.abort.signal.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(stopped()); }
    return new Promise((resolve, reject) => {
      const abort = () => reject(stopped());
      session.abort.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => session.abort.signal.removeEventListener('abort', abort));
    });
  }

  _message(session, event) {
    if (!this._current(session) || typeof event.data !== 'string') return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (!data || typeof data !== 'object') return;
    if (data.type === 'ready') {
      session.ready = true;
      if (this.targetLanguage && session.startedTarget !== this.targetLanguage) session.socket.send(JSON.stringify({type:'target-language',targetLanguage:this.targetLanguage}));
      session.readyWaiter?.resolve();
    } else if (data.type === 'error') {
      this._emit('error', data);
      if (data.fatal) {
        for (const waiter of [...session.waiters]) waiter.reject(failure(data.code ?? 'PROVIDER_ERROR', data.message ?? 'Provider error.'));
        this.stop();
      }
    } else if (data.type === 'status') this._emit('status', data);
    else if (data.type === 'transcript' || data.type === 'meaning') {
      if (data.type === 'meaning' && this.targetLanguage && data.targetLanguage !== this.targetLanguage) return;
      if (typeof data.utteranceId !== 'string' || !Number.isSafeInteger(data.revision)) return;
      const final = data.type === 'meaning' ? data.stage === 'final' : data.final === true;
      const map = data.type === 'meaning' ? session.revisions : session.transcripts;
      const previous = map.get(data.utteranceId);
      if (previous && (previous.final || data.revision < previous.revision || (data.revision === previous.revision && !final))) return;
      if (data.type === 'transcript') {
        if (!previous) session.currentUtteranceId = data.utteranceId;
        const withdrawn = !final && typeof data.text === 'string' && !data.text.trim();
        const withdrawnRevision = withdrawn ? data.revision : previous?.withdrawnRevision ?? -1;
        map.set(data.utteranceId, { revision: data.revision, final, withdrawnRevision });
        if (withdrawn) this._emit('meaning:reset', { type: 'meaning:reset', utteranceId: data.utteranceId, revision: data.revision, reason: 'transcript-withdrawn' });
      } else {
        const transcript = session.transcripts.get(data.utteranceId);
        // A normal newer transcript may coexist with a usable older semantic partial.
        // Explicit withdrawal and finalization are stronger boundaries and block races.
        if (data.revision <= (transcript?.withdrawnRevision ?? -1)) return;
        if (!final && (transcript?.final || (session.currentUtteranceId !== null && data.utteranceId !== session.currentUtteranceId))) return;
        map.set(data.utteranceId, { revision: data.revision, final });
      }
      if (map.size > 128) map.delete(map.keys().next().value);
      this._emit(data.type === 'transcript' ? 'transcript' : final ? 'meaning:final' : 'meaning:update', data);
    }
  }
}

export const createSemanticPlugin = options => new SemanticPlugin(options);
