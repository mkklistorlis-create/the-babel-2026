# Visual polish — 2026-10-25

- Person-mask mosaic cells: 18 → 24 screen pixels. Floating squares: 10–28 → 14–38 pixels, with spacing 9.5 → 13 to retain the existing coverage ratio. Spring motion, idle drift, source colors and hand/face tracking are unchanged.
- Original and translated captions use white fill and a black outline, with no blurred shadow or panel. Main outline scales with type size, capped at 3 pixels; secondary caption text uses a 1-pixel outline.
- Removed the solo/duet “SESSION, IN ONE FRAME” heading and its update code. The results dialog retains an accessible name, logo and Back home button.

Validation: 38 renderer/results tests passed; production build and whitespace checks passed. Desktop browser checks at 1280 × 720 rendered the real WebGL mosaic and floating squares using simulated camera input. Solo and duet captions were checked against bright and dark backgrounds. Both summary modes rendered statistics, artwork and charts; the duet page had no viewport overflow. No real camera or speech was used for these visual checks.
