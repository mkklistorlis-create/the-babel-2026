# R10.0 — Figma expression-ring implementation

This release was developed on branch `visual-expression-r10` only after the independent R09.0 statistics ZIP had been saved. The confirmed R08.2 demo and R09.0 statistics-only source remain separately preserved.

## Verified locally

- **261/261 unit tests pass.** New tests cover all five design profiles, all 18 expression mappings, observed intensity versus match score, pause, invalid input, owner changes, continuous transitions, viewport bounds, ring geometry, exact 90° equal-leg chevrons, equal arc spacing, buffer reuse and partial GPU upload ranges.
- `npm run build` and `git diff --check` pass. All 13 vendor/model assets are verified.
- System Chrome with software WebGL rendered all five families without page errors. Screenshots were inspected against the latest Figma board. The initially radial chevron orientation was corrected to tangential open arrows with visible spacing; there are three sets of 64.
- Demo family changes reached the expected graphic state. Calm/joy/sadness use three hollow loops, surprise uses three connected spiked outlines, and tension uses 192 chevrons.
- Single-person final results retained the facial-activity timeline after the ring layer was added.
- The statistics/controller modules, original facial classifier/worker, particle-motion module, fingertip renderer and six/seven modules are byte-identical to the saved R09.0 release. `duet-canvas.js` only adds construction/update/reset/disposal hooks for the independent ring layer.

## Performance boundaries

The new layer uses one fixed-capacity mesh and one added draw call. Stable families use 2,304–3,456 vertices, with larger temporary counts during crossfades. Only the active vertex prefix is uploaded. A CPU-only 600-update stress sample averaged about 1.22ms per update before the upload optimization, with a peak of 15,696 vertices below the fixed 24,576 capacity. These measurements do not establish physical webcam or hardware-GPU frame rates. No new camera model, speech processing or network data stream was added.

## Interpretation and remaining live validation

Families are artistic mappings of observable facial movements. They do not diagnose feelings. Demo intensity is explicitly synthetic; live intensity uses the existing smoothed action coefficients. Real camera quality and final visual preference still require the user's device test. Both single-person and duet modes use the same locally rendered artwork; the existing canvas capture carries the composited rings to the other participant.
