# The Babel

A live communication artwork for BU DS+X / Artech. Facial movements, hand gestures and speech become a shared visual conversation, followed by an exportable artwork and session statistics.

**Live site:** https://the-babel-duet.vercel.app · **Integrated release:** R12.3

## Current experience

- **One participant per device:** camera-colored square particles, head-following emoji and independent fingertip trails. Two people connect from separate devices, with A on the left and B on the right.
- **6/7 gesture:** exchange the hands' vertical order once. Digits follow the hands at rest; brief hand misses are tolerated. Both hands leaving for about a second or confirmed dual fists end the effect.
- **Five visual families:** calm, joy, surprise, tension and sadness drive a radial composition with smooth transitions. Joy, surprise and tension remain for 1.6 seconds on a return to calm. Each background includes 84 triangles and 84 circles with varied sizes and animated movement/brightness.
- **Four-language speech:** choose Chinese, English, Japanese or Spanish before entry. Start requests camera and microphone permissions. Bold, transparent captions grow word by word and shrink to fit longer sentences; completed text stays for 1.3 seconds. Low-confidence startup hypotheses are filtered before display and translation.
- **Two-device translation:** each microphone recognizes its own participant; the counterpart's pane shows translations in the viewer's chosen language. The WebRTC artwork stream carries video only, so use an external call or physical conversation to hear each other.
- **Session results:** expression counts/durations, an activity timeline, a generated artwork and PNG/CSV/JSON exports. Visual families represent observed facial actions, not a diagnosis of inner emotion. Speech does not drive the visual emotion mapping.

## Run locally

Requires Node.js 24+ and a WebGL2-capable browser.

```sh
npm install --ignore-scripts
cp .env.example .env
# Configure provider keys in your editor for speech; camera/demo can run without them.
npm run build
npm test
npm start
```

Open http://127.0.0.1:4173. Select a language, click **开始**, and allow the camera and microphone. If microphone permission is denied, the camera remains usable and the toolbar provides a retry control. The demo uses simulated input.

The build downloads and verifies 13 pinned browser/model assets using `assets-manifest.json`. Generated `dist/`, downloaded browser vendors and local secrets are excluded from Git. The WebSocket transport is vendored with its license under `lib/speech/vendor/ws/`.

## Deploy and test

Vercel project `the-babel-duet`: framework **Other**, Node.js **24.x**, build `npm run build`, output `dist`. Configure `DEEPGRAM_API_KEY` and `OPENAI_API_KEY` in the desired deployment environment, then deploy. No participant access code is required. The example environment file contains names only.

Audio is processed by Deepgram; transcripts and recent text context are processed by the configured semantic provider. Connected peers receive provisional/final captions and translations. The app does not save audio recordings or transcript logs. Speech sessions end after four minutes and can be restarted with the toolbar.

See [speech setup and lifecycle](docs/SPEECH.md), [networking and TURN](docs/NETWORK.md), and the [release verification checklist](docs/verification/release-r123.md). Real microphone accuracy, cross-network two-device behavior and device-specific tracking FPS still need live testing.

## Repository layout

| Path | Purpose |
| --- | --- |
| `public/` | Browser app, tracking, renderer, captions, room UI and results |
| `api/` | Vercel speech and RTC endpoints |
| `lib/speech/` | Server-side transcription and semantic pipeline |
| `tests/` | Regression tests, including local HTTP boundary checks |
| `scripts/` | Build and asset verification |
| `docs/` | Current setup, architecture, verification and archived development notes |
| `prototype-server.mjs` | Local HTTP/WebSocket server |

[Documentation index](docs/README.md) · [Historical release notes](docs/archive/README-before-release.md)
