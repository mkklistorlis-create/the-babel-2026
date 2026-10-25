import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import rtcConfigHandler from './api/rtc-config.js';
import {createSemanticGateway, getSpeechConfig} from './lib/speech/gateway.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.tflite': 'application/octet-stream' };
const CAPABILITIES = Object.freeze({revision:'R07',mode:'camera-only',camera:true,hands:true,facialExpressions:true,microphone:false,transcription:false,semantics:false,provider:null});
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

/** Vision stays in-browser; speech providers start only after an explicit request. */
export function createPrototypeServer({ publicRoot = ROOT, env = process.env } = {}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) return send(res,403,{error:'Local host required.'});
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname === '/api/rtc-config') return rtcConfigHandler(req,res);
      if (url.pathname === '/api/semantic-config') {
        if (req.method !== 'GET') return send(res,405,{error:'Use GET.'});
        return send(res,200,getSpeechConfig(env));
      }
      if (url.pathname === '/api/semantic-stream') return send(res,426,{error:'WebSocket upgrade required.'});
      if (url.pathname === '/api/capabilities') {
        if (req.method !== 'GET') return send(res,405,{error:'Use GET.'});
        const speech=getSpeechConfig(env);
        return send(res,200,{...CAPABILITIES,revision:'R12.3',mode:'camera-with-optional-speech',microphone:speech.enabled,transcription:speech.enabled,semantics:speech.enabled,provider:speech.enabled?'deepgram-nova-3':null});
      }
      if (url.pathname === '/api/transcribe' || url.pathname === '/api/interpret') {
        if ((req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') return send(res,403,{error:'Same-origin request required.'});
        // Reject before reading a body or looking up any model configuration.
        return send(res,410,{error:'Legacy speech endpoints are retired. Use /api/semantic-stream for opt-in speech.',revision:'R12.3',suspended:true});
      }
      if (url.pathname.startsWith('/api/')) return send(res,404,{error:'Unknown API endpoint.'});
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res,405,{error:'Use GET.'});
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return send(res,400,{error:'Invalid path.'}); }
      const root = await realpath(publicRoot);
      const candidate = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!candidate.startsWith(root + sep)) return send(res,403,{error:'Invalid path.'});
      let path;
      try { path = await realpath(candidate); if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) throw new Error(); }
      catch { return send(res,404,{error:'File not found.'}); }
      const body = await readFile(path);
      res.writeHead(200,{'Content-Type':MIME[extname(path)] || 'application/octet-stream','Content-Length':body.length,'Cache-Control':'no-cache'});
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { if (!res.headersSent) send(res,500,{error:'Local server error.'}); else res.end(); }
  });
  server.requestTimeout = 45_000;
  server.headersTimeout = 10_000;
  const speech=createSemanticGateway({server,env});
  server.once('close',()=>speech.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPrototypeServer();
  const port = Number(process.env.PORT || 4173);
  server.listen(port,'127.0.0.1',()=>console.log(`The Babel: http://127.0.0.1:${port}`));
  server.on('error',error=>{console.error(`Server could not start: ${error.code || 'unknown error'}`);process.exitCode=1;});
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{server.close();server.closeAllConnections();});
}
