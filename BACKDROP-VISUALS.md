# R12.1 — transparent screenprint collage

The five approved concept images guide the live backdrop: large torn-paper swaths, offset cream edges, angular cutouts, fine parallel cuts, dense halftone and paper distress. The concepts' dark solid masses become transparent camera windows. No dark background rectangle or tinted camera filter is introduced.

## Composition and movement

| Family | Light inks | Geometry and motion |
| --- | --- | --- |
| Calm | Sage, ivory, mint | Broad horizontal torn ribbons with slow flowing deformation |
| Joy | Orange, yellow, cream | Splayed diagonals, elastic width and buoyant drifting |
| Surprise | Violet, pink, blush | Opposing diagonals and sharp interlocking fragments |
| Tension | Coral, pale coral, cream | Compressed steep strips and tight angular cuts |
| Sadness | Slate blue, muted violet, pale blue-gray | Descending vertical ribbons with slow sway |

Eleven large swaths have 112 segments per edge, fixed multiscale tears, and four off-register cream underprints. Sixteen long/short wedges and three small line bundles supply a secondary scale. Geometry uses common topology, so the existing 900 ms family transition morphs layout and inks continuously. Existing facial-action intensity affects ribbon width, breathing amplitude and motion rate. Seeded, integrated motion avoids per-frame random flicker. These are artistic mappings of observed facial configurations, not psychological diagnoses.

Nine screen-space knockout wedges remove ALL collage ink layers at their positions. Natural gaps between paper pieces also remain transparent. Fine dark halftone dots are retained as printed detail, while the large dark masses are absent. The original camera is drawn first; the paper collage follows; the existing body mosaic, particles, hands, emoji and 6/7 remain in front.

## Rendering and preservation

One Three.js mesh / draw call, 10,296 vertices, reusable 18,000-vertex buffers. The fragment shader draws halftone, grain, fine edge tears and alpha-discard windows. No added recognition model, audio processing, image downloads or postprocessing pass. Pause and reduced motion freeze decorative time; stale tracking and multiple-person state use the existing eligibility gates.

The same renderer runs for solo and duet, and the existing processed video stream carries the backdrop to the peer. Expression coefficients, participant rendering, hand gestures, final session artwork, statistics and exports are unchanged. R12.0 remains in Git history.

## Validation

- All 294 existing tests pass, including deterministic composition, bounded buffers, face-independent coordinates and pause/stale/ownership behavior.
- Production build verifies all 13 pinned runtime assets.
- Chromium WebGL preview inspected in all five families with no page or shader errors.
- GPU alpha readback at 640 × 400 found 32–53% transparent background pixels across five seeded sample compositions. Every fully transparent pixel retained the exact RGB of the underlying test background.
- GPU frames two seconds apart changed in all five families, confirming rendered animation rather than only changing diagnostic values.
- This is a procedural interpretation of the approved image concepts. Browser checks use simulated input; physical webcam expression accuracy is unchanged and was not remeasured.
