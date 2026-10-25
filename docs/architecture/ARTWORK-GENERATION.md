# Conversation portraits — R11.0

## Source and scope

[Figma 158:11 — Conversation Art · 纯色几何统计背景](https://www.figma.com/design/ARPz6Z5NkTlPAz0bv1S6oj?node-id=158-11) is the reference for the final session artwork. The background is generated from the actual round's existing facial-action data. The foreground retains the existing emoji library, occurrence/duration area rule and equal A/B foreground area budgets. The bar chart and facial-activity line chart are unchanged.

## Data

The existing validated expression output maps into the same five artistic families as the live rings. The movement-match `score` is not used as emotion probability. The input must already pass the app's participant/visibility/freshness checks and contain usable facial-action values. Unavailable intervals contribute no graphic evidence. This implements the board's reliability requirement with the signals the prototype actually has; it does not introduce an invented confidence threshold or drop brief emoji episodes from the original statistics.

Each 2-second window records duration-weighted family shares `p` and facial-action strengths `a`. A family’s adjacent-window change is `0.65 × |Δp| + 0.35 × |Δa|`. Global change uses half the sum of absolute share differences plus the change in overall mean strength. Missing evidence breaks adjacent-window comparisons; usable fragments still contribute their actual time and strength. The unfinished final window is included without changing accumulated state.

Window mean strengths are grouped into `[0, 1/3)`, `[1/3, 2/3)` and `[2/3, 1]`. Only five families and three strength-band aggregates are retained; no growing facial-history list or raw video is stored. The optional `summary.art` field is validated and exchanged through the existing room protocol. Both peers aggregate A/B in fixed role order. Background shares are weighted by the available valid participant-time; this quantity is distinct from wall-clock session duration.

Old summaries lacking graphic evidence keep their foreground emoji artwork. A mixed-version round uses only the available graphic evidence and identifies the missing side in the result description.

## Graphic rules

| Family | Middle color from Figma | Geometry |
| --- | --- | --- |
| Calm | `#A8C5B0` | Capsule, width:height 5:3 |
| Joy | `#FFD65A` | Circle |
| Surprise | `#9566F2` | Eight-ray star, inner/outer radius 11/30 |
| Tension | `#F06464` | Oblique triangular wedge, width:height 1.5 |
| Sadness | `#8D9FB5` | Rectangle, height:width 2.6 |

Family share allocates target covered area. Target total coverage is `45% + 15% × meanStrength`. A bounded 96-column grid estimates the visible union after clipping and overlap; this estimate is not an exact pixel measurement. Protecting readable foreground space takes priority when the available area is insufficient.

Within fixed edge/interior size ranges, area follows `Amin + (Amax − Amin) × strength`; lengths are derived from the square root of area. Large shapes crop at the edges, with smaller shapes toward the foreground. Rotation follows `baseAngle + seededRandom(-1, 1) × (6° + 75° × variation)`. Session ID seeds all placement details. The same seed, statistics, foreground metric and generator reproduce the same composition.

The board specifies three solid lightness bands but gives only the middle hex values. Implementation choices are: light = 30% mix toward `#F2EBDD`; deep = 20% mix toward `#292933`. The unprovided sadness-dominant paper is `#E4E8ED`; the other four papers match the board. All fills are opaque and flat. No gradient, glow or UI appears in the final artwork.

## Export and performance

`session-art-background.js` renders the final static composition into the existing 1600×1000 result canvas. Live chest orbits remain Three.js/WebGL. PNG exports include the geometric background and emoji foreground only. JSON exports include normalized graphic evidence, the generator identifier, source board, seed and derived profiles.

The real-time recorder adds constant-memory arithmetic; layout generation runs only when displaying results. Layout is bounded to 110 shapes and 520 placement attempts. The combined summary, including the full existing timeline, stays within the room's 8,192-byte message limit.
