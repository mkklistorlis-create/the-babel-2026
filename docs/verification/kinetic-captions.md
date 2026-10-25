# Automatic speech entry and responsive typography

Clicking Start now starts camera and microphone permission flows. No participant
passphrase or speech settings panel is required. A microphone stop/retry control
remains in the existing toolbar. Face-tracking changes do not stop speech; leaving
the camera experience stops it. Room transitions clear stale visible captions.

The current utterance updates in one fixed-height area. A binary search using the
rendered font metrics fits its text as interim results arrive. New utterances grow
large again. Chinese uses Noto Sans SC Bold, Japanese Noto Sans JP Bold, and English
and Spanish Noto Sans Bold, with system fallbacks. Fonts are requested from Google
Fonts and fitting runs again when they load.

Validation on 2026-10-25:

- 413 tests passed; existing TCP-listener tests excluded due sandbox restrictions.
- Production build passed with all 13 vendor assets verified.
- Browser checks at 1280×720, 390×844 and 844×390 covered all four languages,
  short/long utterances, next-sentence reset, and A/B pane alignment.
- At 1280×720 the Chinese sample shrank from 118.6px to 63.3px and returned to
  118.6px for the next sentence. Mobile English fit at 29.7px, with an 8px gap
  above controls and no horizontal page overflow.
- Automated boundary tests cover entry before face/config readiness, permission
  denial/retry, no automatic reopening after denial, and late events after exit.
- Screenshots use simulated transcript events with the actual UI and renderer.
  Live provider audio and physical two-device testing were not performed.

![Short utterance](kinetic-short.png)

![Long utterance](kinetic-long.png)
