# R10.1 — narrow-pane artwork fit

R10.0 production verification completed on two independent browsers with real WebRTC and explicitly simulated expressions. Both participants displayed their own graphic family; the partner's decoded video carried the rendered ring composition. The 30-second round completed with A=30,154.6ms and B=30,153ms, 122 timeline points per participant, identical final summaries across peers, and no page errors. Single-person online results also retained their curve. These are synthetic-input network/render checks, not physical camera-accuracy measurements.

Visual inspection showed that the original reference-artboard width included generous margins: using that full width to scale a portrait duet pane made its rings too small relative to the camera-cover face. R10.1 sizes from viewport height and then fits the actual stroke bounds within each pane. The face tracker does not control scale, preserving stability. Five-family resize regression covers viewport containment and size retention.

- **262/262 unit tests pass**; build and whitespace checks pass.
- A 720×900 browser viewport now produces a tension-layer scale of 1.606, compared with the previous 0.8. The 192 tangential chevrons remain hollow, separated, and inside the viewport. Screenshot inspected; no page errors.
- Statistics and facial-recognition code are unchanged by this fit patch.
- Current release: package0.10.1, diagnostic revision `10.1-figma-expression-rings`.

The separate R09.0 statistics-only deployment and ZIP remain unchanged. The confirmed R08.2 demo is independently saved as well.
