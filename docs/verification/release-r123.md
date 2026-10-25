# R12.3 integrated release

The release combines the gesture repair, radial backgrounds, four-language captions/translation, automatic microphone entry, adaptive bold typography, caption/background holds, denser particles and the startup confidence guard.

The repository cleanup only reorganizes documentation and historical screenshots. Runtime code and regression tests are unchanged from the accepted preview (`e5b1510caf2b27b6505046babaaff06a0236a57b`). The root README describes the current experience; old reports are kept under `docs/verification/archive/` rather than deleted. No provider credentials or generated build output are committed.

## Validation

- `npm test`: 421 tests passed; three existing local HTTP-listener tests could not run because the execution sandbox rejects `listen(127.0.0.1)` with `EPERM`. They remain in the suite, unchanged.
- `npm run build`: passed. No runtime files changed in this cleanup.
- The production build checks SHA-256 integrity of all 13 pinned browser/model assets.
- Documentation links and tracked-file hygiene are checked after the moves.
- Prior automated/browser checks use synthetic tracking, provider events or simulated caption inputs. They do not establish live microphone accuracy or camera FPS.
- The user reported Chinese recognition working and no longer observed the startup flash after the confidence-guard preview. This is user acceptance feedback, not a recorded audio benchmark.

## Final manual pass on the production URL

1. Select Chinese and enter; stay quiet briefly, then speak a short phrase and a longer sentence. Confirm no startup text, live growth, shrinking type and clearing about 1.3 seconds after completion.
2. Repeat brief speech in English, Japanese and Spanish. Test microphone stop/retry and denied-permission recovery.
3. Trigger joy, surprise and tension, then relax and speak. Check the short expressive hold, smooth transition, radial layout and animated triangles/circles.
4. Exchange hand heights to trigger 6/7. Hold still, briefly crop fingertips or lose one hand, then end with two fists or both hands leaving.
5. Join from two physical devices with different languages. Confirm A/B placement, translations in each viewer's language, room exit/rejoin and no stale captions. Test the intended network; TURN may be needed across restrictive networks.
6. End a round and inspect the final artwork, statistics and PNG/CSV/JSON exports. Check the target screen sizes for remaining UI overlap.
7. For a longer session, confirm the visible speech stop/restart behavior at the four-minute connection limit.

Production URL: https://the-babel-duet.vercel.app
