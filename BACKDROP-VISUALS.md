# R12 — expression background collage

The active live visual layer replaces the R11 orbits with screen-space color blocks, open line bundles, halftone dots and hatching. It uses the five palettes from Figma `134:11` and the graphic vocabulary visible in the user's reference screenshot of the epohlog tutorial. The Instagram page's description was readable; video playback was unavailable during implementation. This version is an original interpretation of the screenshot, not a frame-by-frame video reproduction.

## Visual mapping

| Artistic family | Existing palette | Geometry and motion |
| --- | --- | --- |
| Calm | Sage, ivory, pale mint | Soft panels, gently curved parallel lines, slow drift |
| Joy | Peach, yellow, cream | Rounded expanded blocks, wider line spacing, buoyant movement |
| Surprise | Purple, pink, pale pink | Star-shaped fragments, angular bends, larger rotations |
| Tension | Coral red | Slanted shards, closely spaced zigzag bundles, tighter geometry |
| Sadness | Slate blue, muted violet, deep slate | Tall blocks and slow vertical line structures |

These categories reuse the existing emoji/facial-action mapping. They are artistic controls and do not establish a participant's psychological state.

## Algorithm

1. Reuse the existing valid facial-action observations and their family/intensity values. No additional inference model, audio input or semantic classifier.
2. Smooth family transitions over 900 ms and intensity with a 260 ms time constant. Geometry and palette blend together; background shapes do not snap to a newly rolled layout every frame.
3. Seed a screen-space composition per participant ownership token: eight large edge forms, twelve small accents and four bundles of five open lines. Nothing is anchored to the face or neck.
4. Blend sixteen-point shape templates by family weights. Intensity changes size, visible accent density, line width and motion rate. Seeded interpolated noise controls continuous translation and rotation. The motion clock integrates current speed, preventing elapsed-time jumps when expression intensity changes.
5. Draw the collage after the original camera image and before the existing body mosaic/particles. The participant, emoji, hands and six/seven remain in front; camera background remains visible through negative space.
6. Freeze decorative motion for pause/reduced-motion settings. Stale/missing tracking, multiple-person state or participant changes clear the layer through the existing eligibility rules.

## Rendering and preservation

Three.js/WebGL uses one mesh, one draw call and reusable buffers capped at 12,000 vertices; the current composition uses 4,800. Halftone and hatch patterns are analytic fragment shaders. There is no bloom pass, texture upload loop or extra recognition task. This bounds the added geometry; actual frame rate depends on the device, camera inference and browser.

`affect-backdrop.js` owns the new renderer. `duet-canvas.js` installs it for both camera and demo modes; each peer transmits its processed canvas through the existing video connection. Diagnostics expose `affectBackdrop`. The old orbit module remains archived in source but is no longer instantiated.

The final session artwork, bar chart, activity timeline, PNG generation, expression coefficients, fingertip renderer and six/seven gesture are unchanged. R11.5 remains recoverable from Git history.

## Validation

- 294 tests pass, including new deterministic composition, bounded buffers, screen-relative positioning, pause, reduced motion and invalid-tracking checks.
- Production build succeeds with all 13 pinned vendor assets.
- Chromium/WebGL previews inspected for all five palettes; no page errors.
- Two independent browser contexts connected with PeerJS/WebRTC and received each other's different expression backgrounds.
- Both peers completed the round and produced identical final artwork canvases at 1600 × 1000.
- Browser checks used simulated camera input; physical webcam accuracy was not retested.
