# R09.0 — statistics-only checkpoint

This independently saved release adds single-person final statistics and facial-activity timelines. It intentionally precedes the Figma ring-art implementation. The confirmed R08.2 demo remains tagged `demo-verified-r08.2` and saved separately.

## Verified

- 235/235 unit tests pass, including the original camera/emoji/hand/six-seven cases, elapsed-time recording, solo/duet transitions, bounded timelines, strict packet normalization and line-chart gaps.
- `npm run build` passes with all 13 vendor/model assets verified; `git diff --check` passes.
- Single browser, explicitly simulated input: auto-started local recording, six expression configurations, pause/resume, final results without any peer, one participant card, no B curve, centered artwork. Timeline had 36 points across 8.568 seconds with observed values from 0 to 61.4 and missing sections shown as gaps.
- Two independent Chrome contexts, real WebRTC with simulated input: existing solo source joined a room, fresh duet session started automatically, B ended the round, both complete results contained exactly matching local/remote summaries including timeline arrays. Both curves rendered. No page errors.
- Timeline screenshot inspected. Measured zero and missing evidence are visually distinct. CSV/JSON definitions explain the observable facial-activity measure.
- No modifications to face thresholds, hand/six-seven logic, camera composition, particle rendering or fingertip style in this checkpoint.

## Limits

Activity uses existing facial coefficients and a documented artistic formula. It measures no audio/tone, internal emotion or physiological signal. Tests use mocked input or synthetic browser expressions; live-camera accuracy still depends on the existing tracker. Curve time origins are local to each device, and long sessions coarsen the sampling windows while retaining the full time axis.
