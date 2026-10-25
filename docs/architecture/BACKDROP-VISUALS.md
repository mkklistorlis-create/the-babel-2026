# Radial bloom with soft transitions

The live composition now grows from the participant toward every edge: 24 pointed torn-paper petals, 16 slender spears and three bundles of fine radial cuts. All five palettes share this topology. Calm gently curves; joy expands; surprise lengthens; tension narrows; sadness softens with a slight downward bend. Rectangular strip layouts have been removed.

The origin follows the projected face/chin region with a 550 ms smoothing constant. Existing facial observations supply the location; no new model is added. Seeded angular variation and gentle breathing keep the composition alive. Wide color planes, paper texture, offset cream edges and halftone retain the approved concept vocabulary.

The decorative family transition is now 1500 ms with a two-stage 200 ms low-pass on render weights. Intensity uses a 420 ms time constant. Retargeting midway through a transition preserves the current blended composition; the same petal identities persist, so layout does not flip between horizontal and vertical bands. This changes visual response only, not expression detection, emoji or statistics.

Joy, surprise and tension hold for 1600 ms on a return to calm before the smooth transition. The decoration layer adds 84 triangles and 84 circles across seven radial bands, with varied sizes, drift, rotation and brightness. These effects share the existing mesh and buffer.

Eight radial knockout seams and gaps between petals reveal the original camera. Every collage layer discards fragments there. The existing participant mosaic, particles, emoji, hands and 6/7 render in front.

## Rendering

One Three.js mesh / draw call, 17,964 vertices and reusable 18,000-vertex buffers. Direct vertex writes avoid temporary typed-array input allocations. No added inference, microphone, downloaded art textures or postprocessing pass. Decorative motion freezes during pause/reduced motion. Tracking eligibility and participant ownership resets remain intact.

## 6/7 repairs

Two reproducible missed-trigger cases were found and covered by regression tests:

- A brief single-hand miss during the first exchange erased the last two-hand order. The last measured order now survives within the existing 1400 ms evidence window; no unseen hand position is invented.
- A fingertip beyond the image edge invalidated the entire pair even when both palms were visible. Finite offscreen tips are now allowed; invalid coordinates and out-of-frame palms still reject the observation.

Held digits are clamped to the actual viewport so raised hands do not push the whole accessory offscreen. One measured height exchange still activates; both hands missing for a second or two sustained fists still stops it. Owner/multiple-person/stale-input gates are unchanged.

## Validation

300 tests pass, including the two previously failing gesture regressions, viewport placement, pointed radial geometry, smooth retargeting, tracked origin smoothing, bounded buffers and the existing gesture lifecycle cases. Production build verifies all 13 pinned assets. Browser verification uses simulated camera input; physical webcam behavior needs the user's retest.

R12.1 remains in Git history. Final artwork, charts, exports, face recognition coefficients and fingertip ink are unchanged.
