# R07 verification — camera body study

2026-10-24 · Between Us

## Implemented scope

The active application now has one camera and no microphone, speech recognition, semantic interpretation, language selection or comic balloon. The previous semantic schema/output has not been redesigned. Dormant R06 code is preserved under `legacy/r06` and is not served.

The current visual chain is:

1. Local single-person occupancy guard and complete stabilized foreground mask.
2. Actual two-hand MediaPipe landmarks with persistent identity and fingertip strokes.
3. Seven observable facial-action emoji selected with smoothing, hysteresis and at least three fresh observations.
4. A textured Three.js plane attached to the upper-right temple and rotated using the measured face transform.
5. Camera-colored square particles adapted from the user's actual tutorial implementation, plus a coarse masked mosaic underfill and the unchanged full camera background.

## Automated result

**89 / 89 active Node/CPU tests passed**, zero failures or skipped tests. Reproduce with `npm test`; exact output is `tests/reports/unit-tests-r07.txt`.

Coverage includes:

- Camera-only startup, failure handling, no speech/semantic calls or controls, extra-person suppression, old frame rejection and exit cleanup.
- Facial-action distinctions, normal-blink suppression, sustained-action dwell, threshold noise, stale duplicate observations and participant reset.
- Both hand identities across reordering/crossing, slow inference, missing detections, jumps, reacquisition, bounded history and line fading.
- Segmentation alpha stability, genuine local movement, occupancy lifecycle and isolated native-task failure handling.
- Head matrix conversion checked against projected facial edge directions using actual Three.js matrix/vector math.
- Renderer state, matching bitmap lifetime, shared cover/mirror coordinates, sampled particle RGB and movement, mask underfill, clip plane orientation and artwork pause.
- Server asset delivery, disabled microphone permission, suspended speech endpoints, and public path confinement.

GPU rendering and camera inference are mocked at their boundaries. These tests verify implementation behavior, not measured facial-recognition accuracy or the appearance of a physical camera scene.

## Audit corrections

A separate read-only integration review found two material issues, both fixed before the final suite:

- The original hand continuity/freshness cutoff of roughly 200–220 ms rejected normal delayed CPU detections. Freshness now allows up to 800 ms, continuity uses a separate 550 ms source-sample gap limit, and motion distance/missing observations still break strokes. Fade starts when a new observation is displayed. Duplicate capture timestamps cannot refresh ink. A fixture with 300 ms inference delay and 250 ms sampling interval verifies visible continuity.
- The original head-angle conversion omitted the renderer's downward Y axis. The corrected basis is D R D, with D = diag(-1,-1,1), covering both Y direction and selfie mirror. Tests compare projected face edges with the actual rotated accessory for pure and combined rotations, rather than asserting the same angle formula twice.

## Running-server checks

The server was started at http://127.0.0.1:4173. Its live capabilities response reports R07 camera-only with microphone, transcription and semantics false. Permissions-Policy is `camera=(self), microphone=()`.

Live requests returned HTTP 200 for the page, app, expression selector, hand trails, particle module and 7,819,105-byte local HandLandmarker model. Speech/semantic endpoints return 410 and cannot instantiate the archived inference provider. The model SHA-256 is `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`.

## Remaining physical checks

A working automated browser/camera session was unavailable in this environment; the app-panel open request also failed. No physical webcam, shader compilation, GPU appearance or real device FPS acceptance is claimed.

On the user's device, refresh the page and start the camera. Check continuous movement with both hands, a brief hand exit/re-entry, head tilt in each direction, the seven facial actions, a second visible face, and particle coverage around hair and moving fingers. Confirm background/mask alignment in the actual camera crop. Strong occlusion, lighting, blur and slow CPU inference can still reduce tracking quality.

Figma development log: https://www.figma.com/design/ARPz6Z5NkTlPAz0bv1S6oj?node-id=104-11

## R07.1 small follow-up

The face vocabulary now contains 14 entries using existing vision coefficients. Compound expressions can replace established basic expressions while preserving dwell and blink suppression. Emoji width/height (and radius/diameter) are multiplied by 5; the texture is enlarged to 1024px. The 26 focused expression, app and renderer checks all passed after the local connection recovered. Output: `tests/reports/focused-tests-r071.txt`. No new physical-camera or GPU acceptance is claimed.
