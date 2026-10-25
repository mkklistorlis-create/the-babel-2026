# R07.6 — one-swap activation and persistent hand numerals

2026-10-24. User requested a broader trigger and explicit stopping gestures.

## Current rules

- Two visible hands establish an upper/lower order. One subsequent fresh observation with the opposite order activates the accessory. A .012 normalized-height dead band on each side suppresses near-level noise. No repeated alternation or equal motion amplitudes required.
- Activation is latched: stationary, freshly tracked hands keep their numerals indefinitely at full opacity. The old 1.6-second motion timeout is removed.
- One missing hand hides only its numeral. The remaining visible hand continues following, and both numerals return when both hands are observed.
- Both hands missing hides both numerals immediately, then ends the latch after a 1000ms absence buffer. A shorter miss can resume without retriggering. No unseen hand position is fabricated.
- Both fists end the latch after two distinct hand observations spanning at least 200ms. Duplicate rendered frames cannot confirm closure. At slow inference this can take roughly one sampling interval.
- Fists use the existing 21 hand landmarks. At least three long fingers must be folded/compact and no long finger may be clearly extended. Thumb position is optional. Pointing an index finger or making a V sign does not count as a fist. No new model or network service.
- Closed fists cannot rearm the effect. Open hands establish a new height order; exchanging it restarts. Multiple people, changed participant, tracking failure/staleness and exit retain their existing clearing behavior.
- Resize clears only interpolation anchors and preserves the latch. Camera background, particle body, full-color head emoji and fingertip ink remain unchanged.

## Verification

**122/122 tests passed**, zero failures/skips: `tests/reports/unit-tests-r076.txt`.

Detector checks cover one exchange, dead-band jitter, duplicate/out-of-order frames, 20 seconds of stationary observations, long single-hand absence, short/long total absence, dual-fist confirmation, one-fist/pointing rejection, closed-hand rearming prevention and ownership boundaries. Fist geometry checks include mirror, rotation, scale, 2D input and degenerate observations. The actual HandTrackFilter is exercised at 480/430, 500/450, 600/550 and 900/850ms cadence/delay with 16ms display ticks. Renderer tests cover opaque persistence, reprojection and per-hand visibility.

System Chrome / SwiftShader full application replay used a temporary synthetic camera/worker fixture with 430ms inference delay and actual createTracker/HandTrackFilter integration. Observed transitions: ready → one height exchange → active; stationary past the previous timeout → active; one hand → active with one numeral; two fist observations → stopped-fists. A second run verified viewport resize preserves activation and both hands leaving → stopped-missing. Both numerals were visually inspected. No browser JavaScript/console errors; temporary test tabs were closed.

Physical hand-shape recognition remains a device test. Fist recognition is a geometric cue and may be affected by occlusion or inaccurate landmarks. The existing diagnostic panel exposes hand count, 0/1 exchange, fist count and running/stopped state.

Unchanged versus R07.5: styles.css, expressions.js, tracking.js, tracking-math.js, tracking-worker.js, fingertip-ink.js, particle-motion.js and mask-stability.js. Numeric glyph paths and emoji size unchanged. Server source unchanged.
