# R07.2 — scoped rollback verification

2026-10-24. Restore the previous R07.1 visual experience. Keep only a cobalt/ivory treatment of the existing index-fingertip trails, plus the separately requested one-fifth emoji size.

## Scope checks

Byte comparison against the restored version-7 project archive confirmed exact identity for index.html, styles.css, app.js, expressions.js, particle-motion.js, hand-trails.js, tracking.js, tracking-worker.js, tracking-math.js, mask-stability.js and prototype-server.mjs.

The renderer changes are limited to fingertip ink integration/lifecycle and EMOJI_SCALE=1. Original camera background, camera-color particle mosaic, complete mask, colored emoji texture, head rotation and demo geometry are restored. No poster layout, blue background blocks, cyanotype body, new typography, audio controls or export controls remain in the active experience. Broad R08 additions are archived outside the app.

## Checks completed

- Full regression: **93 passed, 0 failed, 0 skipped**.
- Fingertip renderer: existing hand.tip coordinates, stable identities, source freshness, 950ms fading, invalid-input rejection, pause/clear and bounded triangle buffers.
- Actual system Chrome / SwiftShader at 1440×900: restored intro and simulated scene visually inspected. Original background, particle body and small colored emoji present; cobalt/ivory marks confined to fingertip paths. No page JavaScript or console errors.
- Served application responds HTTP 200 at 127.0.0.1:4173. The already-running static server serves the restored files. Process restart is restricted in this environment; its in-memory capability response/permissions header can retain R08 metadata until restarted. The restored frontend has no microphone or R08 API calls. The packaged server source is R07 and will use its original camera-only policy on the next launch.

Physical webcam appearance, landmark accuracy and device FPS still require a real-device check. The browser check uses labeled simulated input.
