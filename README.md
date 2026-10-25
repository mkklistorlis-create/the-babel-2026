# Between Us — R10.1 expression rings and session timelines

R10.1 fits the ring layer to the available drawing bounds after sizing from view height, keeping the artwork readable beside a large camera-cover face in narrow duet panes. The independent R09.0 statistics release remains unchanged.

R10.0 builds on the saved R09.0 statistics release and adds a Three.js/WebGL expression-ring layer above the camera background and behind the participant. It follows the latest Figma `134:11` three-orbit geometry, five palettes and LOW/BASIC/HIGH stroke/opacity rules. The existing facial-action values drive the artistic family and intensity through smooth transitions. No additional recognition model or audio input is added. Camera particles, emoji, fingertip ink and six/seven remain independent. See [AFFECT-VISUALS.md](AFFECT-VISUALS.md) for the mapping and design provenance.

R09.0 adds final statistics to single-person camera/demo sessions and a facial-activity line chart to both solo and duet results. It reuses the existing facial-action coefficients, records a bounded time series, keeps missing intervals empty, and supports timeline CSV/JSON exports. The original bar chart and data-sized emoji artwork remain available; solo artwork is centered. Opening a ready camera/demo automatically starts a local round. Connecting to a peer starts a fresh duet round with separate counters. No microphone or new inference model is added.

The **statistics-only checkpoint** is independently preserved as tag `stats-only-r09.0`, `The-Babel-R09.0-Statistics.zip`, and https://the-babel-stats.vercel.app/. The user-confirmed R08.2 demo is preserved separately as tag `demo-verified-r08.2` and `The-Babel-R08.2-Verified-Demo.zip`. R10.0 is developed on branch `visual-expression-r10` after those copies were saved.

R08.2 starts the first statistics round automatically once A and B connect and acknowledge the start. The controls show recording / waiting / stopped and an elapsed clock. Results distinguish total round time from valid expression time, explain the timing boundaries, and offer an explicit next-round action. Late start confirmations are rejected after the handshake deadline even if the timer was delayed. JSON exports include local timing diagnostics for troubleshooting; device clocks are never subtracted across participants. Facial thresholds and the artwork are unchanged.

R08.1 records each recognized emoji change immediately, including brief appearances between the 200ms statistics ticks. Charts and artwork default to independent occurrence counts; duration shares remain available. Tiny positive durations/shares are labeled explicitly rather than rounded to zero. The live counter shows how many expression categories have been recorded. This change does not alter the visual tracker's thresholds.

R08 adds conversation statistics after both participants connect. From R08.2 the first round starts automatically; the host starts subsequent rounds, and either person can end a round without leaving the room. Results contain an A/B grouped **bar chart**, a data-sized emoji collage, and PNG / CSV / JSON downloads. Each device records its own stable emoji durations and episode counts; cumulative summaries are exchanged over the existing peer connection. See [SESSION-STATS.md](SESSION-STATS.md) for definitions, lifecycle and limits. R07.6 facial thresholds, camera composition, fingertip rendering and the successful six/seven gesture are preserved.

## Artwork history — R07.6

BU DS+X / Artech · 2026-10-24

R07.2 restored the original experience and limited cobalt styling to index-fingertip trails. R07.3 doubles the emoji radius relative to R07.2 and adds independent eye-shape/coarse-gaze input. The existing UI layout, camera background, sampled-color particle body and fingertip animation are preserved.

R07.4 adds a small six/seven hand gesture: alternate lifting and lowering both hands two or three times to hold a bold, tilted 6 and 7 above the hands. It reuses existing hand landmarks; no new model, microphone, or external font is required.

R07.5 fixes gesture evidence being repeatedly erased between slow CPU frames. A separate bounded gesture budget retains progress through brief hand misses and nearby renewed hand IDs. The minimum per-palm travel is reduced to 1.8% of camera height, and three opposing strokes may span 4.2 seconds. The existing test panel now shows detected hands, accumulated strokes and sample cadence. The face, particles and fingertip detection/rendering keep their previous behavior.

R07.6 replaces the earlier activation/expiry rule: one exchange of the hands' vertical order starts 6/7, and the accessory stays on while hands are stationary. Both hands leaving for about one second or both hands holding a fist ends it. One visible hand keeps its numeral; the missing hand's numeral hides. The original appearance and R07.5 slow-frame input budget are preserved.

R07 follows the revised camera-only direction. One participant uses one camera. Speech, language selection, semantic interpretation, the old shape categories and comic speech balloons are removed from the active experience. R06 source and its semantic output/schema are preserved unchanged in `legacy/r06`.

## Run

Node.js 24+ and a WebGL2-capable desktop browser are required. After cloning, run the build once to download and verify the pinned vision models, Three.js and WASM assets. These assets are then served locally. The current app requires no API key or language-model server.

```sh
cd between-us
npm run build
npm start
```

Open http://127.0.0.1:4173 and refresh an existing tab. Click **开始** and grant camera access. The app does not request microphone access; the server prohibits it through Permissions-Policy. Camera frames remain in the browser.

- Move either hand: the index fingertip draws its own fading cobalt trail: fine/dashed/hatching strands for one hand and a blue/ivory ribbon for the other.
- Exchange the hands' vertical order once: 6 appears above the initial screen-left hand and 7 above the other. They keep following at rest. End by moving both hands out of view for about one second or making two fists for two fresh observations (at least 200ms). A single missing hand hides only its numeral. Open your hands and exchange heights again to restart.
- Smile, hold a wink, close both eyes, pucker, lower your brows, or open your mouth while raising your brows: a matching emoji appears like a hairclip at the head's upper-right side.
- Turn or tilt your head: the emoji plane follows the measured head orientation in 3D.
- Your original background stays visible. Your body becomes camera-colored square particles, with movement inertia, gentle idle drift and fading detached particles.
- **D** opens diagnostics; **Space** pauses particle motion while camera and tracking continue. **Esc** closes diagnostics, then exits and releases the camera.
- **先试试动态** is an explicitly simulated illustration. Clicking the scene cycles emoji; it does not demonstrate recognition accuracy.

One participant is tracked per camera. Additional visible faces suspend personal hand/emoji attribution; sustained single-person evidence restores it. R07.9 adds two-computer networking, described below.

## Visual input and rendering

MediaPipe runs in a worker with a single FaceLandmarker, single PoseLandmarker, SelfieSegmenter, separate BlazeFace extra-person check and a two-hand HandLandmarker. Hand positions and identities are independent of detection-array order. Missing hands break line continuity; returned hands start a new stroke. A recent-data budget supports slower CPU inference without accepting indefinitely stale positions.

The face model supplies observable blendshape coefficients and a face transformation matrix. The original emoji set has seven entries: 😐 natural, 😀 raised mouth corners, 😮 open mouth with raised brows/wide eyes, 😉 sustained one-eye closure, 😌 sustained two-eye closure, 😗 puckered lips, 😠 lowered brows. At least three distinct observations and a short dwell are required to change the selected expression; ordinary blinks and isolated spikes are suppressed. R07.1 adds seven combinations: 😄 squint-smile, 😃 open-mouth smile, 😆 closed-eye open-mouth smile, 🤨 one raised brow, 🙁 lowered mouth corners, 😳 raised brows with wide eyes, and 😙 closed-eye pucker, for 14 entries total. R07.3 adds 😑 bilateral squint, 🧐 unilateral squint, 👀 side glance and 🙄 upward glance, for **18 entries total**. 😳 now responds to sustained wide eyes without requiring raised brows or mouth movement. The accessory has twice the R07.2 radius and diameter, with the same temple anchor and full-color 1024px texture. These are visual shape matches, not estimates of inner feelings or psychological state. The diagnostic score is a movement-match score, not calibrated emotion confidence.

Three.js/WebGL2 composites the camera frame and its matching stabilized foreground mask. The particle motion implementation is adapted directly from the user's `echo-of-motion/dist/particle-motion.js` tutorial project. Square colors sample the actual camera RGB. A coarse camera-color mosaic underfill covers the segmented body between displaced squares; the original detailed face/body texture is not deliberately exposed through particle gaps. The background outside the mask stays photographic. Complete-mask failure is explicit rather than silently substituting another representation.

Hold eye actions for about half a second; at slower inference rates this can approach one second. Coarse gaze needs coherent binocular signals and a measured, mostly frontal head pose. Missing/turned pose immediately clears directional gaze. The existing model supplies separate eye-wide, eye-squint and in/out/up/down coefficients. Three fresh samples, dwell and hysteresis suppress ordinary blinks and brief glances. These are qualitative eye-motion cues, not calibrated screen coordinates.

Both hand trails and the head accessory use the same camera-cover crop and one horizontal mirror. Trails render as variable-width triangle ribbons. The emoji is a textured Mesh plane rotated with the measured head matrix; it is not a screen-fixed badge or camera-facing Sprite. Face loss hides the clip. Multiple people, stale data, ownership changes and exiting clear personal overlays.

## Verification and limits

The R07.6 regression suite passed **122/122** checks. Run `npm test`. Cases cover a single height swap, long stationary retention, partial/total hand loss, dual-fist confirmation from distinct observations, pointing-finger rejection, restart, resize and slow CPU sampling with renewed IDs. App and renderer tests retain the R07.5 fix for face-display timeouts erasing gesture progress. GPU/media boundaries are mocked in these tests.

Physical webcam appearance, landmark quality, real device FPS and lighting sensitivity still require a live device test. System Chrome with SwiftShader successfully rendered the restored intro and simulated camera scene, including the original particle body, background, small colored emoji and new fingertip ink; no JavaScript errors were observed. This was a simulated-input check without physical camera access. No claim of physical visual acceptance is made. Strong occlusion, a head turned away, motion blur or hands outside the camera may lose tracking. The extra-person guard depends on visible faces and is not comprehensive person counting.

See `verification-r076.md` for current verification; earlier reports are historical. Earlier semantic benchmark results remain historical R06 records and are not used to describe R07 quality.

## Files

- `public/app.js`, `index.html`, `styles.css`: camera-only flow and diagnostic panel.
- `public/expressions.js`: facial-action emoji vocabulary and temporal selection.
- `public/tracking-worker.js`, `tracking.js`, `tracking-math.js`, `mask-stability.js`: vision, tracking identities and filters.
- `public/duet-canvas.js`, `particle-motion.js`, `hand-trails.js`: original Three.js composition, square-particle physics and input strokes. `fingertip-ink.js` and `cobalt-geometry.js` style only those fingertip strokes.
- `public/six-seven-gesture.js`, `six-seven-overlay.js`, `hand-pose.js`: one-swap persistent hand accessory, geometric fist cue and two cached numeral textures rendered above the measured hands.
- `prototype-server.mjs`: localhost static server; old transcription and semantic endpoints return 410.
- `public/vendor/`: bundled vision assets, Three.js, model checksums and licenses.
- `legacy/r06/`: dormant previous speech/semantic experiment; not served by the current application.

Figma development log: https://www.figma.com/design/ARPz6Z5NkTlPAz0bv1S6oj?node-id=67-11

Implementation references: [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), [Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js), [Three.js](https://threejs.org/docs/).
# R07.9 — two-computer rooms

This version adds opt-in two-person WebRTC rooms to the R07.6 artwork. Create an invitation, join from another computer, and view A on the left / B on the right. Local facial, hand and six/seven algorithms are unchanged. See [NETWORK.md](NETWORK.md) for setup, testing, privacy and the current STUN-only network limitation.

Build for Vercel: `npm run build` (Node.js 24+). Pinned vendor/model assets are downloaded and integrity-checked; no API key is needed for the initial PeerServer signaling test. `npm test` runs the existing visual regression suite and room lifecycle tests.

The notes below document the earlier single-person iterations.

