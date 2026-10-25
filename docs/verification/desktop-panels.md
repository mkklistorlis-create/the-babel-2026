# Desktop summary and connection redesign — 2026-10-25

Implemented the supplied English desktop designs using the existing lime, ivory and black visual system. Session overview, portrait, expression distribution and facial activity fit in one viewport at 1440×800, 1280×720 and 1024×768. Full data and measurement explanations are available through a separate details panel. The expression chart scrolls horizontally through all 18 categories.

Solo results show only the local participant. Duet results remain ordered A then B even on the guest device; local/partner labels, separate coverage values, grouped bars, line styles and left/right portrait assignment are preserved. Missing participant data stays unavailable rather than becoming zero. Waiting for host is explicit for a connected guest starting another round.

Back home now closes results and invokes the application's full stop path: stop microphone, stop recording, leave room, release camera, close overlays, return to the welcome screen. Escape from the summary also returns home; Escape from measurement details returns to the summary. Closing the connection panel retains the existing camera/room session.

The connection dialog uses two columns for hosting and joining. Camera source is fixed to My camera in the released UI. Invite links are contained in a scrollable text input; state, error and help text wrap within the panel. The source selector hides after camera activation to leave space for the invitation and room actions.

## Validation

- 427 non-server automated tests passed, including new solo/A/B Back home lifecycle tests and guest/missing-partner attribution tests. The three existing prototype TCP server tests remain excluded because this shell denies localhost listen with EPERM.
- Production build and whitespace checks passed.
- Browser checks used real UI modules with simulated expression records and connection/media boundaries. Verified solo, duet A/B, missing peer, no tracked data, metric switching, full statistics, home navigation, create again, invalid invite, host waiting, guest joining and leave-room states.
- Measured no unintended horizontal overflow in buttons, overview values and room rows at tested desktop widths. No vertical summary scrolling at the tested viewport sizes. Portrait and PNG export retain the full composition.
- No mobile redesign or live two-device camera/microphone session was performed in this change.
