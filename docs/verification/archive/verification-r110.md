# R11 verification — 2026-10-25

Scope: chest-centered expression orbits and the conversation artwork background specified in Figma `ARPz6Z5NkTlPAz0bv1S6oj`, board `158:11`.

## Automated checks

- All 289 tests pass, including chest anchoring, front/back segment splitting, missing tracking data, two-second artwork windows, geometry coverage, deterministic composition and legacy summary compatibility.
- Production build succeeds with 13 verified vendor assets.
- `git diff --check` passes.
- The face expression coefficients, fingertip renderer and six-seven gesture behavior are unchanged.

## Browser checks

Chromium with WebGL software rendering, using the existing simulated camera input. These checks verify rendering and networking, not physical-camera recognition accuracy.

- Single-person and two-person views render three torso-centered orbits with both front and rear segments. The body occludes rear segments and front segments render over the body.
- With reduced motion disabled, the breathing uniform changes over time. Reduced motion freezes this decorative motion.
- A solo round produces the timeline and the geometric background from its recorded expression data.
- PNG export produces the complete artwork at 1600 × 1000 without the surrounding interface.
- Two independent browser contexts connect through the existing PeerJS/WebRTC flow. A roughly 70-second round finishes and synchronizes successfully on both sides.
- A's local summary equals B's remote summary, and B's local summary equals A's remote summary. The final PNG canvas data is identical on both sides.
- No browser page errors or WebGL shader errors occurred in these checks.

## Remaining hands-on check

Test with the participants' actual webcams to assess chest positioning when only the face or one shoulder is visible. A face-only estimate remains available when reliable torso landmarks are absent. The changes do not claim to improve the underlying expression detector's accuracy.

## Version preservation

The preceding graphic version is preserved on GitHub as `release-r10.1`. The statistics-only project remains separate. R11 algorithm and design decisions are documented in `ARTWORK-GENERATION.md` and `AFFECT-VISUALS.md`.
