import { getSpeechConfig } from '../lib/speech/gateway.mjs';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.statusCode = 405; res.setHeader('Allow', 'GET'); return res.end(JSON.stringify({ error: 'Use GET.' }));
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    res.statusCode = 403; return res.end(JSON.stringify({ error: 'Same-origin request required.' }));
  }
  res.statusCode = 200; res.end(JSON.stringify(getSpeechConfig()));
}
