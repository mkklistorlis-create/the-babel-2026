# R07.3 — eye expressions and accessory size

2026-10-24. Scope: double the emoji radius relative to R07.2; add independent eye-shape/coarse-gaze matching.

## Implementation

- EMOJI_SCALE 1 → 2: both radius and diameter double for the same face size. Original full-color texture and head attachment retained.
- 12 additional native per-eye coefficients: wide, squint, inward/outward and upward/downward. Existing local model only.
- 14 → 18 emoji entries: bilateral squint 😑, unilateral squint 🧐, side gaze 👀 and upward gaze 🙄. Existing 😳 can trigger from wide eyes without mouth/brow changes. Sustained wink/closure remain supported.
- Side gaze requires coherent opposite anatomical in/out signals; up gaze requires both eyes. Direction requires measured mostly-frontal head pose. Missing/turned pose immediately clears pending and established gaze.
- Three fresh samples, smoothing, hysteresis and roughly 350–550ms eye-state dwell suppress ordinary blinks, brief glances and repeated samples. At 3Hz inference a stable response can take closer to one second.

## Verification

**101/101 tests passed**, zero failures/skips. Exact report: tests/reports/unit-tests-r073.txt.

A complete native-category → worker extraction → action smoothing → expression selection test runs at333ms samples with mouth held still. Other checks cover gaze conflicts, one-eye noise, missing/turned pose, ordinary blinks, sustained closure, old samples, neutral recovery and exactly twice the previous measured accessory size.

Actual system Chrome / SwiftShader: 18 demo options registered, upward-gaze and narrow-eye glyphs selected through the existing UI. Larger full-color glyph visually inspected over the original background, particle figure and fingertip strokes. No JavaScript/console errors. This uses labeled simulated input.

Byte comparison against R07.2 confirms unchanged styles.css, app.js, particle-motion.js, fingertip-ink.js, cobalt-geometry.js, hand-trails.js, tracking.js and mask-stability.js. Renderer differs only in scale constant/comment. HTML only updates eye-action instructions. Pipeline changes are limited to eye coefficients and finite-value smoothing.

Physical webcam accuracy remains unverified. Gaze is qualitative, not calibrated screen tracking or a claim about emotion/attention. No pupil-dilation measurement. Glasses, glare, blur and occlusion may affect recognition. Local service continues serving updated static files; this revision adds no microphone access or server changes.
