# Expression-ring artwork — R11.0

## Design source and scope

The latest board is [Figma 134:11](https://www.figma.com/design/ARPz6Z5NkTlPAz0bv1S6oj?node-id=134-11), titled “UIUX / 03 圆环统一母型 · 五组情绪关键帧”. It replaces the earlier nine-emotion exploration at 119:11 with three hollow ellipses and five coherent graphic families. The implementation uses the latest board's geometry and palette together. The earlier board's 0.4–0.8s transition guidance is implemented as 600ms. No speech or semantic processing is reintroduced.

The board defines shapes and their LOW / BASIC / HIGH keyframes. It does not define an 18-emoji mapping or numeric facial formula. The following is the application's explicit implementation mapping, not a claim that a facial configuration establishes an internal emotion.

| Artistic family | Existing observed configurations | Main measured intensity input |
| --- | --- | --- |
| Calm / 平静 | neutral, wink, eyes-closed, pucker, one-brow, closed-pucker, eyes-narrow, one-eye-squint, gaze-side, gaze-up | Low baseline with bounded facial-action modulation |
| Joy / 舒展 | smile, squint-smile, open-smile, closed-laugh | Smile coefficient |
| Surprise / 扩张 | open-mouth, raised-eyes | Wide-eye and raised-brow coefficients; mouth opening requires those cues |
| Tension / 收紧 | brow-furrow | Brow-lowering coefficient |
| Sadness / 下沉 | mouth-frown | Mouth-corner lowering coefficient |

The existing movement-match score does not control the ring intensity. Natural expressions can have a high match score. Facial activity for statistics and graphic-family intensity remain distinct documented calculations.

## Figma keyframes

All reference widths below use a 900×430 artboard. LOW / BASIC / HIGH values interpolate continuously. Colors are exact board values.

| Family | Stroke widths | Opacity | Palette |
| --- | --- | --- | --- |
| Calm | 2 / 5 / 10 | .30 / .65 / 1 | #A8C5B0 → #F2EBDD → #C7E3DD |
| Joy | 6 / 20 / 38 | .30 / .65 / 1 | #FFAE70 → #FFD65A → #FFF1BA |
| Surprise | 3 / 8 / 15 | .35 / .70 / 1 | #9566F2 → #F19AE8 → #FFF0FA |
| Tension | .8 / 1.3 / 2 | .35 / .70 / 1 | #F06464 |
| Sadness | 10 / 6 / 2.5 | .95 / .60 / .28 | #8D9FB5 → #666780 → #363C55 |

The three regular orbits use 205×78 radii and 0°/±55° orientations. Calm and joy remain hollow. Surprise grows connected small spikes from the three ring outlines, with no extra center circle. Tension uses 64 equally arc-spaced, open 90° chevrons on each orbit; each consists of two equal line segments. Chevron count and size remain fixed as stroke width and opacity change. Sadness shifts downward and elongates, becoming thinner and dimmer at greater intensity; there is no filled droplet.

## Runtime

The renderer uses three tilted orbital planes centered on the torso. With reliable existing pose landmarks, the center is the shoulder midpoint plus 28% of the vector toward the hip midpoint; shoulders alone provide a downward chest estimate. A face-only view uses a lower estimated center, explicitly reported as `face-estimate` in diagnostics. The center follows the body with smoothing and is never moved up to fit the viewport; cropping may trim the lower or outer arcs.

Each orbit carries signed geometric depth. Segments crossing the body plane are split: far arcs draw above the photographic background and behind the mosaic, while near arcs draw above body particles and below fingertip trails and the emoji. Two meshes share a fixed 24,576-vertex budget. Triangle ribbons retain variable width, original palettes and existing shape families without relying on platform-specific line widths.

Every family has a gentle 5.6-second light cycle and a slow traveling highlight in its existing shader. There is no extra bloom pass or recognition model. The light is decorative and never enters statistics. Reduced-motion preference and pause freeze its phase. Missing/ambiguous tracking and participant ownership changes clear both front and back arcs.

Each computer renders its own participant's rings into the existing artwork canvas. The existing WebRTC stream transports that composition to the partner, so solo and duet use the same visual implementation without a second model or a new ring-data network stream. Explicit demo mode uses synthetic preset intensity; it is not evidence of camera accuracy.


## R11.1 — user sketch adjustment

The October 25 sketch replaces the orbit composition with one horizontal and two ±42° diagonal loops. All five expression families retain their palette, opacity, breathing and edge treatment on the same wide orbital frame; sadness also uses this common frame. Stroke widths are multiplied by 1.8. Overall size follows shoulder span (2.3×) or face width (2.7× fallback), limited by pane width. Lower arcs can extend outside a close camera crop. Chest anchoring and front/back body occlusion remain. Final conversation artwork and recognition coefficients are unchanged.

Validation: 18 orbit tests pass, production build succeeds, Chromium WebGL preview inspected with no page errors. Real webcam positioning remains a hands-on check.
