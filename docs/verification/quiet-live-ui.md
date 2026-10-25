# Quiet live interface — 2026-10-25

Camera/renderer notices, startup errors, speech connection/error messages, translation revision metadata, remote-video waiting text and demo status now live inside the manually opened D diagnostics panel. They no longer occupy the live viewport or caption dock. Camera startup failure does not open diagnostics automatically. D also works before entering so initialization failures remain inspectable.

The connection badge is a fixed “Connection” control. Asynchronous capture, join and playback failures do not reopen the connection dialog; its controls and status remain available when opened manually. The playback recovery button is English. Original captions, translations, language choice, recording controls, artwork, tracking guards and recovery logic remain intact.

Validation: 71 app, speech UI and room-transport tests passed, including failure behavior and manual D toggling; production build passed. A desktop browser fixture injected all six notice categories simultaneously, including a long texture-error message. None had visible layout rectangles; both original and translated captions remained visible in the real caption layout over simulated WebGL camera input. This change suppresses error presentation; it does not claim to repair the underlying WebGL texture allocation error reported in the screenshot.
