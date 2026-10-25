# Caption and controls layout verification

The caption area, recording statistics and navigation now share a bottom flow
layout. Speech settings use a compact disclosure and cannot remain open alongside
the debug or connection panels. Rendering, tracking and speech processing are unchanged.

Validation on 2026-10-25:

- 414 tests passed (all test files except `prototype.test.mjs`, whose TCP listener
  tests require permissions unavailable in the execution sandbox).
- Production build passed, including integrity checks for 13 vendor assets.
- Browser checks at 1280×720, 390×844 and 844×390 covered solo captions, A/B
  caption placement, recording controls and navigation together.
- Speech settings and debug panel exclusivity, and Escape to close speech settings,
  were checked in the browser.
- The actual application demo entry and finish/generate-results flow were checked.
- The caption screenshot below uses simulated transcripts and the actual renderer,
  speech UI and session controls; it is not a live microphone/provider test.

![Solo caption and shared toolbar](ui-dock-solo.png)
