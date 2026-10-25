import http from 'node:http';
import { createSemanticGateway } from '../lib/speech/gateway.mjs';

// Vercel's Node HTTP-server entrypoint owns listening and the Upgrade transport.
// Deployment duration (300s) is set in vercel.json; sessions close after 240s.
const server = http.createServer((_req, res) => {
  res.writeHead(426, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Upgrade: 'websocket' });
  res.end(JSON.stringify({ error: 'Use a WebSocket connection to /api/semantic-stream.' }));
});
const gateway = createSemanticGateway({ server });
server.once('close', () => gateway.close());
export default server;
