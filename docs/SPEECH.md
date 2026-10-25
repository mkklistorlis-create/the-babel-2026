# Four-language speech integration

Speech starts with the main Babel entry button. Each participant uses their own device microphone. The existing camera artwork, facial-action statistics, fingertip animation and final artwork retain their current inputs.

## Enable locally

Requires Node.js 24+. In the repository root:

```sh
cp .env.example .env
# Fill the two provider keys in your local editor.
npm run build
npm start
```

Open http://127.0.0.1:4173 and select Chinese, English, Japanese or Spanish on the start screen. Your choice is both the microphone language and your preferred language for incoming translations. Clicking Start requests camera and microphone permissions. The current utterance grows word by word in one bottom text area, with bold type shrinking to fit. Text is drawn directly over the scene without a panel. Completed captions remain for 1.3 seconds. At microphone startup, recognition results below 0.65 confidence are suppressed until the first accepted transcript; later corrected results can appear immediately. Missing confidence remains compatible and this guard cannot rule out high-confidence misrecognition. There is no fixed startup mute. The toolbar offers microphone stop/retry. Refusing microphone permission leaves the camera available.

## Enable on Vercel

Add these environment variables to the Vercel project, selecting the deployment environments where speech should be available, then redeploy that environment from the intended Git commit:

| Variable | Purpose |
| --- | --- |
| `DEEPGRAM_API_KEY` | Streaming Nova-3 transcription |
| `OPENAI_API_KEY` | Text semantic interpretation |
| `SEMANTIC_MODEL` | Optional; defaults to `gpt-4.1-mini` |

No participant access code is required. Existing `BABEL_SPEECH_ACCESS_CODE` values are ignored. Provider keys remain server-side. Same-origin validation, bounded messages, session duration and per-instance concurrency limits remain enabled.

For an OpenAI-compatible provider, configure `SEMANTIC_API_KEY`, `SEMANTIC_BASE_URL` and `SEMANTIC_MODEL`. The endpoint must support Chat Completions with JSON object output, `temperature` and `max_tokens`. Use HTTPS for external endpoints.

The deployment uses Vercel Fluid Compute with a Node HTTP server exported from `api/semantic-stream.js`. `vercel.json` configures a 300-second function limit. A speech connection ends after 240 seconds with a visible restart message; participants can click to begin a fresh speech session. There is no silent automatic restart or claim of uninterrupted, unlimited streaming.

## Two-person rooms

Each person can choose independently in **YOUR LANGUAGE** before joining, or **I speak** at the top of their own live pane. The same control is available in solo mode. This selects both the microphone language and the language used to read the partner's translations. For example, with A set to Chinese and B to English, B reads A's English translation on A's pane, while A reads B's Chinese translation on B's pane. Their own captions remain in their own spoken language.

Changing the local language clears old captions and restarts only an active microphone stream; the camera, room and session timer continue. A muted microphone stays muted. The partner's language is shown below the selector and updates the outgoing translation target without changing the local recognition language. Transport deduplication includes the target language so a new translation of the same revision is not discarded after a switch.

Use the existing invitation flow. Each device recognizes its own microphone. The local original transcript appears at the bottom of the local pane. Provisional and final translations, together with their source text, are sent through the existing data channel and displayed below the counterpart’s pane. Each sender translates into the receiving participant’s selected language, synchronized in the bounded visual-state snapshot. The receiving side assigns A/B from the established room role. Partial translations are explicitly marked provisional and are replaced by the final sentence, including when the revision number is unchanged. Older turns cannot replace a newer visible turn. The start screen explains microphone permission, external processing and peer sharing before entry.

The code identifies a device/room role, not a biometric speaker. It does not separate two voices on one microphone. Use one participant per device, avoid having the other speaker audible through the same microphone, and use the existing external call/physical conversation for hearing each other. The artwork's WebRTC media stream still contains video only.

Stopping speech or exiting the camera experience clears speech state and cancels pending work. Changing rooms clears displayed captions; face-tracking loss or ownership changes do not stop the microphone. A second remote participant is expected in a duet; audio is always attributed to the local device, not to a tracked face. Changing the remote language cancels pending translations without reopening the microphone. No semantic result changes the current particle, facial-action or final-art rendering in this integration.

## Data and implementation

- Browser: `public/speech/semantic-plugin.js`, PCM AudioWorklet and responsive caption typography in `public/speech/`.
- Provider pipeline: `lib/speech/gateway.mjs`, `deepgram.mjs`, `semantics.mjs`, `languages.mjs`.
- Hosting: `/api/semantic-config` returns availability flags; `/api/semantic-stream` is the same-origin WebSocket. The localhost server mounts those routes too.
- Peers: `public/meaning-protocol.js` validates partial/final messages, translation language/size and reset messages before the existing room data channel handles them.
- The four language prompt packs preserve negation, degree, references and ambiguity. These are prompting specializations, not four separately trained models.
- Output includes original `text`, direct `translation` and `targetLanguage` when requested, Chinese semantic `meaning`, `intent`, `target`, `attributes`, `degree`, `polarity`, `uncertain`, and verbatim source `evidence`. Expressed stance is distinct from a person's inner feelings.
- Audio goes to Deepgram; transcript and recent textual context go to the configured semantic provider. The app does not write recordings or transcript logs. Current text is held in page/server memory and provisional and confirmed text is shared with the connected participant.
- `latencyMs` measures semantic queue/inference time only. It excludes audio capture and transcription and is not end-to-end latency.

The gateway has bounded input, queues, connection duration and per-instance concurrency. These are not an account-wide spending quota. A public production release should add per-user authentication and centralized quotas; the current no-code entry is intended for the hackathon demonstration. Model meaning, transcription accuracy and latency still require real four-language audio evaluation.

## References

- [Deepgram official live-transcription starter](https://github.com/deepgram-starters/node-live-transcription)
- [Deepgram multilingual transcription](https://developers.deepgram.com/docs/multilingual-code-switching)
- [Vercel WebSocket Node server export](https://vercel.com/docs/functions/websockets)
- [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel static configuration](https://vercel.com/docs/project-configuration/vercel-json)

The WebSocket transport is vendored from `ws` 8.21.0 with its MIT license in `lib/speech/vendor/ws`. No runtime npm dependency installation is needed for that transport.
