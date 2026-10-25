# R09.0 — solo/duet statistics, timeline and emoji artwork

## Single-person mode

Open the camera or explicitly simulated demo. The first local round begins when the source is ready; no peer or server is required. **结束并生成** produces your bar chart, facial-activity line chart and centered emoji collage. Start a new round from results or the recording controls. Leaving the camera finishes the local round. Connecting to another participant starts a fresh duet round; the previous local result remains separate in diagnostics and is never sent as peer data.

## Try it

1. Connect A and B using the existing room invitation on two computers.
2. The first round starts automatically after connection. Both clients acknowledge the same round before recording. Check that **REC · 正在记录** and the elapsed clock are visible on both devices.
3. Make expressions. The existing 18-state tracker supplies the labels. No additional model or speech processing runs.
4. Either participant clicks **结束并生成**. The media connection remains open while final cumulative summaries are exchanged and acknowledged.
5. Compare A/B in the grouped bar chart. Switch between **时长占比** and **出现次数**; the collage uses the same metric. Download the artwork PNG and the CSV/JSON statistics.
6. A clicks **开始新一轮** in results or the recording controls to begin another round in the same room. Returning to the picture alone does not resume recording; controls explicitly show stopped. Each round has a fresh ID and fresh counters.

## Measurement

### Facial-activity timeline

The line chart's horizontal axis is elapsed time since the local round began. The vertical axis is a bounded **0–100 facial-activity index**, derived from the existing smoothed mouth, brow, eye and gaze coefficients. It combines visible movement amplitude, time-normalized coefficient change and a small transient on a displayed expression change, then smooths the output over time. This is an artistic descriptor of observed facial motion; no voice/tone input is measured. The exact deterministic formula is documented in `public/expression-activity.js`.

Every 250ms window retains the peak index. Windows containing missing evidence remain null and break the drawn line. Valid low activity is zero. For long sessions, window widths double to keep at most 240 points while retaining the entire session axis; the UI states the actual resolution. Reacquiring a face does not create a fictitious change spike. Live input without facial coefficients has no activity estimate; demo input may use explicitly synthetic presets. A and B share a plotted scale but retain their own elapsed-time origins. Timeline CSV and JSON retain numeric values, gaps and the metric definition.

Each browser uses its own monotonic clock. Every recognized emoji update is recorded immediately at its source, with no additional statistics dwell or minimum-duration threshold. The 5 Hz timer remains for freshness, UI refresh and synchronization; it is not the sole observer. This retains brief appearances between timer ticks. Time is integrated from elapsed milliseconds, independent of render FPS or network packet count. The recorder stores one duration and one episode count per expression. A continuous smile is one episode, whether it lasts one second or ten. A change to another expression or missing observation closes the episode.

Total round time runs from the accepted start confirmation to either participant ending the round. Opening a camera, waiting alone in a room, or viewing a completed result is outside this interval. Loss of recognition never pauses total round time: valid time and missing time add up to total time. A stopped result remains frozen until a new round starts. Recording state is visible even while the results panel is closed. Local diagnostics retain requested/start/end monotonic times and start/end triggers; these timestamps are not shared as synchronized wall-clock times. Expired start confirmations are rejected in the message handler as well as in the periodic timer.

The default chart and artwork metric is independent occurrence count, so a short recognized appearance is visible. An appearance exactly at the end of a round may have one occurrence and zero measurable duration; count mode retains it. Duration mode uses expression duration divided by that participant's valid observation duration. Positive values below the display precision are labeled `<0.1%` or `<0.1 秒`, without inflating the actual bar height or recorded duration. Missing observations, pauses, background tabs and lost tracking do not become `neutral`. The view also exposes total duration, valid duration, missing duration and coverage. A sample expires after at most 500ms if observations stall; elapsed time after that is missing. This freshness budget does not discard short episodes or modify face-tracker thresholds.

The displayed states describe observed facial configurations. A brow-lowering label does not establish anger; the movement-match `score` is not an emotion probability. Charts therefore use the expression names in the existing vocabulary and do not assign psychological traits or an emotional-health score.

Demo mode remains explicitly labeled on screen and in exports. Each participant's `mode` is retained in the summary, including mixed live/demo rooms. Demo outcomes are not recognition-accuracy evidence.

## Networking and completeness

The existing media and hand-data routes remain intact. Statistics use separately validated session messages over the admitted peer's reliable data channel. Start/ready/begin messages establish the round. Each side periodically sends a cumulative summary; recipients replace older revisions rather than adding them again. Final summaries and acknowledgments finish the round. Retries and timeouts are bounded.

Each summary includes the session ID, A/B role, source mode, revision, duration, valid/missing time, the 18 expression counters and the bounded facial-activity timeline. It contains no invitation token, raw camera frame, transcript or recording. Local time origins are not compared across computers. A/B durations can differ slightly during handshake/finalization; charts use each participant's own denominator. This version makes no synchronized-expression or causal-response claims. Older summaries without a timeline remain valid and show an explicit unavailable state for that curve.

Leaving, losing the connection or a finalization timeout retains available statistics with an incomplete-sync notice. An absent peer summary is unavailable, not a zero-expression participant. New rounds cannot accept stale summaries from earlier IDs. Records live in browser memory until the next round/reload; use the export buttons to retain them. There is no analytics database or server-side session storage.

## Chart and artwork

The grouped bar chart shares a zero baseline and common scale for A and B. Duration mode uses percentages; occurrence mode uses independent episode counts. All 18 categories remain available, with exact data in a table and downloads.

The collage allocates equal total symbol area to A and B when both have data. Within each group, symbol area is proportional to the selected metric's share. Linear dimensions therefore grow with the square root of the share. Neutral remains an ordinary category and zero-value categories are omitted from artwork. Color rings identify the participant; the original emoji vocabulary is retained. The exported PNG contains the artwork without controls or the statistics dashboard.

## Validation boundaries

Unit tests exercise elapsed-time integration, long gaps, malformed summaries, round lifecycle, duplicate messages, acknowledgment retries and disconnect behavior. Browser validation uses synthetic expressions in independent sessions with real WebRTC. Physical cameras, two physical computers and restrictive networks still require user testing. The existing STUN-only / optional TURN limitations in NETWORK.md continue to apply.
