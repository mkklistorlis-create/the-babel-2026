# R07.4 — six/seven held-hand accessory

2026-10-24. Scope: add a simple six/seven gesture using existing two-hand landmark tracking.

## Behavior

- Three opposing palm strokes, including two direction reversals, within 2.4 seconds activate the effect. Each palm must travel at least 3.5% of camera height; predominantly lateral movement does not qualify.
- The initially mirrored screen-left hand receives 6, the other 7. Assignment follows persistent hand IDs across array reorder and hand crossing.
- Numerals are drawn above the highest measured palm/fingertip position with a short interpolation. Original condensed vector glyphs use an ivory face, navy edge and violet offset. They evoke chunky game-title lettering without fetching a font. Two cached CanvasTextures and two Three.js meshes are added.
- Qualifying motion holds the effect for 1.6 seconds, with a 350ms fade at the end. Static/cached frames cannot refresh it. Missing hands, stale data, ownership changes, tracking breaks and multiple occupancy clear it.
- No new palm-facing/finger-shape classifier: this intentionally recognizes the simple alternating movement. Similar deliberate alternating gestures can also trigger it.

## Verification

**110/110 tests passed**, zero failures/skips. Report: `tests/reports/unit-tests-r074.txt`.

Eight new detector cases cover deliberate reversals, realistic delayed 3–5Hz inference, smooth 0.8Hz gestures, stationary hands, fingertip-only wiggles, unequal synchronous motion, jitter, duplicate/old observations, identity continuity, timeout and invalidation. A full renderer test checks mirrored attachment above both hands and removal on multiple occupancy while retaining camera, particles and the facial emoji.

System Chrome / SwiftShader: original intro and demo load; a temporary synthetic-hand harness runs the actual DuetCanvas and displays both upright numerals above their corresponding hands. Visually inspected the chunky 6/7 forms, preserved background, particle figure, fingertip strokes and doubled R07.3 emoji. Multiple occupancy hides the numbers immediately. No browser JavaScript/console errors. Harness removed after the check.

Physical camera gesture recognition is not yet tested on the user's device. Lighting, occlusion and hands leaving the frame can interrupt the effect. Existing hand landmarks and inference settings are unchanged.

Byte comparison confirms unchanged `styles.css`, `expressions.js`, `fingertip-ink.js`, `tracking-math.js` and `tracking-worker.js`. Integration adds the separate numeral layer, one instruction line and diagnostic status. Camera/body rendering, emoji scale and face/eye matching stay as R07.3. Server source is unchanged.
