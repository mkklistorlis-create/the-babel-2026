# Live captions integration verification — 2026-10-25

Integrates speech PR #1 (1c8a93a) with main (4077270), preserving the merged gesture/projection/edge-tracking repair.

- Start screen selects Chinese, English, Japanese or Spanish. Choice persists locally and determines spoken language and incoming translation language.
- Explicit microphone opt-in remains. Solo original text appears at bottom. Duet original text stays in the local pane; counterpart translation appears in the remote pane, with smaller original text.
- Partial/final translations travel through the bounded authenticated peer channel. Same-revision finals replace partials; duplicate/reordered output and old-language results are rejected. A monotonically increasing source turn order also blocks delayed finals whose earlier partial never reached the peer. Changing the remote language cancels obsolete semantic work without reopening the microphone.
- Translation is a separate field from the Chinese semantic explanation, preserving the existing semantic event contract.

## Automated checks

414 tests passed, including all non-listening regression suites. The three existing tests in tests/prototype.test.mjs require binding TCP ports, denied by the shell sandbox (EPERM). Actual HTTP handlers are independently exercised by tests/speech-site.test.mjs. Gateway tests exercise authentication, audio forwarding, target language switching/cancellation and teardown with in-memory transports.

npm run build passed, including checksum verification of all 13 vendor assets. Whitespace checks passed for application and test changes; the upstream vendored ws files retain their existing trailing blank lines.

## Browser checks

The actual start page accepted a Japanese language selection, then returned to Chinese. The actual app’s WebGL demo ran without browser console errors. An isolated local fixture (not shipped in public/) mounted the actual speech UI and actual WebGL renderer, using simulated transcript/translation events and no microphone:

- Solo: bottom original caption visible.
- Role A: local original left, remote translation/original right.
- Role B: local original right (x=664 at 1280px width), remote translation left (x=24).
- Existing radial backdrop, particles, emoji and 6/7 numerals remained visible.

![Solo, simulated text](verification-captions-solo.png)
![Duet A, simulated text and placeholder remote video](verification-captions-duet.png)

## Remaining live validation

No actual microphone audio or provider translation quality/latency was validated. Provider keys must use exact names DEEPGRAM_API_KEY and OPENAI_API_KEY, and the hosted access code must be configured for the deployment environment. Run two-device camera/microphone checks after configuration. Simulated screenshots do not demonstrate real translation accuracy, physical tracking FPS or a connected remote camera.
