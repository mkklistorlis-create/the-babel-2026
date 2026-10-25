# Independent languages and bidirectional translation

Verified 2026-10-25. Adds room and live language selectors using the existing speech controller. Preserves the camera renderer, session statistics, room connection and caption timing.

## Automated checks

- 446 tests passed with `node --test $(rg --files tests -g '*.test.mjs' -g '!prototype.test.mjs')`.
- The three existing HTTP-listener tests in `prototype.test.mjs` were excluded because this execution environment rejects TCP binds. They were not reported as passing.
- `npm run build` passed, including the 13 pinned vendor assets.
- New coverage: all 16 source/target language combinations across paired speech UIs; active restart; muted switch; rapid startup changes; unsupported values; transport delivery of a new target language for an unchanged utterance/revision, with duplicates within one language still rejected.

## Actual provider check

Text requests sent to the public production semantic WebSocket returned these translations with the expected target codes:

| Direction | Input | Translation |
| --- | --- | --- |
| Chinese → English | 你好，很高兴认识你。 | Hello, nice to meet you. |
| English → Chinese | Hello, I am glad to meet you. | 你好，我很高兴见到你。 |
| Japanese → Spanish | こんにちは。お会いできてうれしいです。 | Hola. Me alegra poder verte. |
| Spanish → Japanese | Hola, me alegra conocerte. | こんにちは、お会いできてうれしいです。 |

These were live text-to-translation requests, not a microphone accuracy test.

## Desktop browser check

At 1280 × 720, two local tabs ran the real speech UI, language controls and caption layout, with simulated recognition and the translation samples above. A BroadcastChannel relayed peer language and meaning messages; real room transport was covered separately by the paired transport tests.

- Chinese A / English B: each retained its own source language; incoming translations appeared on the partner's pane in the reader's language.
- Switching to Japanese A / Spanish B cleared old captions, updated partner labels and correctly placed both new translations.
- Muting B and changing its language left the microphone muted.
- The connection dialog's selector updated the canonical language, with no horizontal or vertical overflow at the checked desktop size.

## Final real-device acceptance

1. On two devices, select Chinese for A and English for B, then connect normally.
2. A says a complete Chinese sentence. B should see its English translation in A's pane.
3. B replies in English. A should see its Chinese translation in B's pane.
4. Change A's language during the session, then speak the new language. The room and timer should continue; B should see the updated partner label.
5. Mute, switch language, and confirm it stays muted until Unmute is pressed.

Physical two-device microphone recognition remains a user acceptance check; it is not implied by the simulated browser verification.
