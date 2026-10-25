# Four-language speech integration

The optional speech panel is part of the existing Babel page. Each participant uses their own device microphone. The existing camera artwork, facial-action statistics, fingertip animation and final artwork retain their current inputs.

## Enable locally

Requires Node.js 24+. In the repository root:

```sh
cp .env.example .env
# Fill the two provider keys in your local editor.
npm run build
npm start
```

Open http://127.0.0.1:4173 and open the four-language speech panel. Select automatic detection or Chinese, English, Japanese or Spanish. Starting the camera does not start the microphone. Speech requires an explicit microphone button click and browser permission.

## Enable on Vercel

Add these environment variables to the Vercel project, selecting the deployment environments where speech should be available, then redeploy the integration branch:

| Variable | Purpose |
| --- | --- |
| `DEEPGRAM_API_KEY` | Streaming Nova-3 transcription |
| `OPENAI_API_KEY` | Text semantic interpretation |
| `BABEL_SPEECH_ACCESS_CODE` | Private demo passphrase entered by each participant |
| `SEMANTIC_MODEL` | Optional; defaults to `gpt-4.1-mini` |

Use a long, unguessable demo passphrase. Provider keys remain server-side. The participant's demo code remains in page memory and travels over the same-origin secure WebSocket; it is not stored in a URL or localStorage. Setting keys without an access code does not enable paid speech on Vercel. Missing configuration leaves the camera experience available and the speech panel unavailable.

For an OpenAI-compatible provider, configure `SEMANTIC_API_KEY`, `SEMANTIC_BASE_URL` and `SEMANTIC_MODEL`. The endpoint must support Chat Completions with JSON object output, `temperature` and `max_tokens`. Use HTTPS for external endpoints.

The deployment uses Vercel Fluid Compute with a Node HTTP server exported from `api/semantic-stream.js`. `vercel.json` configures a 300-second function limit. A speech connection ends after 240 seconds with a visible restart message; participants can click to begin a fresh speech session. There is no silent automatic restart or claim of uninterrupted, unlimited streaming.

## Two-person rooms

Use the existing invitation flow. Each device recognizes its own microphone. Confirmed original text and meaning are sent to the connected peer through the existing data channel. The receiving side assigns A/B from the established room role. Provisional interpretations stay local. Speech is opt-in; the panel explains external API processing and peer sharing before activation.

The code identifies a device/room role, not a biometric speaker. It does not separate two voices on one microphone. Use one participant per device, avoid having the other speaker audible through the same microphone, and use the existing external call/physical conversation for hearing each other. The artwork's WebRTC media stream still contains video only.

Stopping speech, leaving/replacing a connection, exiting the camera experience or detecting a local participant change clears speech state and cancels pending work. A second remote participant is expected in a duet; multiple people visible to the same local camera remain an attribution problem. No semantic result changes the current particle, facial-action or final-art rendering in this integration.

## Data and implementation

- Browser: `public/speech/semantic-plugin.js`, PCM AudioWorklet and isolated panel in `public/speech/`.
- Provider pipeline: `lib/speech/gateway.mjs`, `deepgram.mjs`, `semantics.mjs`, `languages.mjs`.
- Hosting: `/api/semantic-config` returns availability flags; `/api/semantic-stream` is the same-origin WebSocket. The localhost server mounts those routes too.
- Peers: `public/meaning-protocol.js` validates final messages and reset messages before the existing room data channel handles them.
- The four language prompt packs preserve negation, degree, references and ambiguity. These are prompting specializations, not four separately trained models.
- Output includes original `text`, Chinese `meaning`, `intent`, `target`, `attributes`, `degree`, `polarity`, `uncertain`, and verbatim source `evidence`. Expressed stance is distinct from a person's inner feelings.
- Audio goes to Deepgram; transcript and recent textual context go to the configured semantic provider. The app does not write recordings or transcript logs. Current text is held in page/server memory and confirmed text is shared with the connected participant.
- `latencyMs` measures semantic queue/inference time only. It excludes audio capture and transcription and is not end-to-end latency.

The gateway has bounded input, queues, connection duration and per-instance concurrency. These are not an account-wide spending quota. A public production release should add per-user authentication and centralized quotas; this access-code gate is for a controlled hackathon demonstration. Model meaning, transcription accuracy and latency still require real four-language audio evaluation.

## References

- [Deepgram official live-transcription starter](https://github.com/deepgram-starters/node-live-transcription)
- [Deepgram multilingual transcription](https://developers.deepgram.com/docs/multilingual-code-switching)
- [Vercel WebSocket Node server export](https://vercel.com/docs/functions/websockets)
- [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel static configuration](https://vercel.com/docs/project-configuration/vercel-json)

The WebSocket transport is vendored from `ws` 8.21.0 with its MIT license in `lib/speech/vendor/ws`. No runtime npm dependency installation is needed for that transport.
