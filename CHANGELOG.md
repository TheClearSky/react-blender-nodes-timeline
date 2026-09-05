# Changelog

## 0.0.1 — 2026-09-06

Initial version. AGPL-3.0-only.

- **Model**: `TimelineDocument` / `TimelineCurve` / `CurvePoint` with
  per-side interpolation (`step` / `linear` / `ease` as cubic bezier
  P1/P2), `evaluateCurve` (bisection solver, hold clamps), zod schemas
  with path-level import errors, `demoTimelineDocument`.
- **Transport**: stopped/playing/paused/ended machine on the audio clock;
  anchor-first scheduling (set / exact-linear ramp / resampled
  `setValueCurveAtTime`), terminal events, APPEND-ONLY loop wrap topped up
  from an interval (background-tab safe), pause-hold, scrub clamp +
  preview windows, coalesced edit rescheduling, duration-shrink clamping.
- **Drivers**: one `ConstantSourceNode` per (curve, build) via the
  injected context factory (structural seam — Tone 15 `rawContext`
  compatible), `acquireDriver → { node, isNew }`, prune-only
  `releaseBuild`.
- **Store/UI**: `createTimelineDocumentStore` + `TimelineProvider` /
  `useTimelineContext`; `<CurveTimeline>` editor (lanes with canvas
  curves, add/drag/delete points, per-side interp panel, rename/recolor/
  y-range/delete curves, ruler drag-scrub, zoom/fit/ctrl+wheel, loop
  toggle, duration field, wrap-mismatch hint).
- **Node seam**: `makeTimelineCurveNodeType`, `TimelineCurvePicker`,
  `timelineCurveRefSchema` (+`makeTimelineCurveRef` /
  `parseTimelineCurveRef`).
- **Transport hardening** (found by scheduling a ~500-event score):
  - Write guards place every post-curve event STRICTLY after the curve's
    engine-computed end (the Chrome/Tone stack treats curve windows as closed
    on the right), and cancels keep `cancelTime` as a surviving closed edge.
  - New `scheduleHeadroomSeconds` transport option (default 0.08): passes
    anchor slightly in the future so large write bursts can never be
    past-dated (Chrome shifts past-dated curve windows forward, colliding
    with later events of the same pass). The playhead holds at the anchor
    during the headroom.
  - `play()` opens with a single startup cancel sweep (a no-op when genuinely
    parked) so a coalesced edit-flush racing play in the same tick cannot
    leave two live passes; each pass also snapshots its time mapping.
- 98 unit tests (interpolation oracles, scheduling call-sequence pins,
  transport state machine, registry lifecycle, editor edit helpers).
