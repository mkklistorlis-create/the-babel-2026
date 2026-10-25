# R12.3 speech integration verification

Base: `4ca67c847324fb2c07200a62ce80b803f4a7028f` (R12.2 radial bloom).

- **402 tests passed**, 0 failed, 0 skipped, across 34 test files. The command ran every `tests/*.test.mjs` except `tests/prototype.test.mjs`.
- `npm run build` passed with all 13 pinned vendor assets verified against SHA-256.
- `git diff --check` passed.

Covered by real module tests with mocked media, transport or providers:

- Existing camera, hand, expression, backdrop, artwork, statistics and room regressions.
- Four language prompts, semantic schema/evidence validation, interim revision handling, final priority and cancellation.
- PCM resampling, microphone lifecycle, permission denial/late grants and access-code handshake.
- Production origin validation, missing/wrong access code, provider isolation before authentication, bounds/rate limits and session expiry.
- A/B attribution from established connections, final-only peer sharing, malformed/oversized/replayed message rejection, reset and reconnect behavior.
- UI opt-in, local/remote meanings, source changes checked before sending, bounded reset retries, teardown and stale asynchronous work.
- Actual localhost request handlers invoked in memory: speech routes, availability flags, secret exclusion, public-file confinement and Permissions-Policy.

`tests/prototype.test.mjs` contains three existing tests requiring a real localhost listener. It remains in the full `npm test` command, with assertions updated for opt-in speech, but was not rerun here because this session's sandbox prohibits local TCP listening (EPERM). Run `npm test` on an unrestricted developer machine or CI runner.

Not verified in this integration: physical microphone/camera behavior, browser visual acceptance, real Deepgram/model credentials, multilingual accuracy, end-to-end latency, two real devices, or the deployed Vercel WebSocket upgrade. API keys and the demo access code are intentionally unconfigured. No live deployment or automatic merge was performed.

Deployment uses the current official Vercel Node HTTP-server WebSocket export and Fluid Compute configuration. This documentation check is not a substitute for testing the deployed endpoint. The speech connection closes after 240 seconds before the configured 300-second function duration; reconnection is explicit.
