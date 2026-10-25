# R07.5 — six/seven live timing repair

2026-10-24. The user reported repeated alternating hand motion never triggered R07.4.

## Reproduced cause

R07.4 tests drove the detector mainly when new samples arrived. Actual rendering calls it every frame. With a 480ms sample interval and 430ms inference delay, source age exceeds the old 800ms limit before the next sample arrives, resetting all accumulated movement. The app's separate 900ms source-age gate also cleared the entire overlay. At intervals above 550ms, the ink hand filter renews IDs and the gesture detector restarted again. A one-hand miss similarly erased progress. These failures were reproduced with the actual HandTrackFilter and 16ms display calls; previous successful ideal-input tests did not establish camera usability.

## Repair

- Dedicated six/seven eligibility: bounded to 1400ms since result arrival and 2200ms source age, still requiring healthy single-person tracking. Existing face/ink gates remain unchanged.
- Gesture ownership follows the current session and person, independently of the old speech/face ownership epoch. Multiple people, new person, exit, failed tracking and expired input still clear it.
- Minimum per-palm travel reduced from .035 to .018 normalized height; stroke window 2400 → 4200ms. Existing three-stroke / two-reversal criterion retained.
- Gesture-only pair reassociation tolerates nearby renewed IDs and ink break flags within 1400ms and .32 normalized distance. Existing IDs take priority; handedness and distance resolve renewed pairs. Upstream hand tracking is unchanged.
- Missing hands hide numbers immediately while preserving evidence for up to 1200ms after the last paired arrival. Cached frames cannot advance strokes or extend the 1600ms effect hold.
- Two interpolation anchors are keyed by the stable numeral slots, keeping memory bounded despite renewed source IDs.
- Existing diagnostic panel shows hand count, stroke count, waiting/gap/active status and measured paired sample interval. It contains no new camera recording or network telemetry.

## Verification

**118/118 tests passed**, zero failures/skips: `tests/reports/unit-tests-r075.txt`.

The detector suite includes the actual HandTrackFilter + display-frame cadence, 480/430 and 500/450ms arrival patterns, 600/550 and 900/850ms slow patterns with appropriate gesture speed, missing hands, unequal .10/.025 amplitudes and baseline differences. Still hands, one hand, fingertip-only motion, jitter and synchronized movements remain inactive. App and full-draw tests cover the separate input budget and prevent face timeout from resetting a same-person sequence.

System Chrome / SwiftShader ran the full app start → createTracker → HandTrackFilter → renderer path. A test-only camera/worker fixture supplied synthetic landmarks with 430ms delay and occasional missing hands; measured paired intervals were approximately 558–591ms, reaching 1181ms across a missed pair. The live entry path displayed both numerals and reported 3/3 strokes, including when the shorter face display budget expired. Missing hands hid the effect; exit cleared it. No browser JavaScript/console errors. Browser overrides were confined to the temporary test tab and the tab was closed.

This verifies reproduced timing failures with synthetic replay; it does not replace a physical webcam trial on the user's device. Very fast motion relative to inference rate can still be undersampled. The diagnostic panel now makes insufficient hand observations visible.

Byte comparison against R07.4 confirms unchanged styles.css, expressions.js, tracking.js, tracking-math.js, tracking-worker.js, fingertip-ink.js, particle-motion.js and mask-stability.js. Numeral glyph design, body/background rendering and emoji scale are preserved. Server source unchanged.
