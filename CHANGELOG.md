# Changelog

## 0.0.3 — 2026-10-05

### Added — in-app docs on the Timeline Curve node

- `makeTimelineCurveNodeType` now sets `description` on the node type and on
  its Curve / Signal / Value sockets. Hosts that support in-app docs show them
  behind an ⓘ. Pass `description` to replace the node's text.

### Added — the Grid finder, triplets, a grid offset, and per-lane value grids

- **Grid finder** (toolbar "find grid"): suggests tempos that fit the
  document's note starts — each with its division, a start offset, a
  confidence and "N of M on the grid" — with a paged preview of the events
  (green on the grid, red off it). "Use this grid" sets the tempo, division
  and offset; points never move. The analysis is exported:
  `collectEventTimes`, `findTempoCandidates`, `findValueGridCandidates`.
- **Triplet divisions** `1/8T`, `1/16T`; **`tempo.offsetSec`** — where bar 1
  starts (a pickup reads as bar 0).
- **Value grids** — `TimelineCurve.valueGrid`: evenly spaced lines
  (`{kind:'linear', step, origin}`) or musical notes (`{kind:'pitch', a4}`,
  labelled C4, D4, …), each with `show` and `snap`; per-lane toggles and a
  per-lane Grid finder. Value snap applies to adding, dragging and painting
  (Alt bypasses).

### Added — tempo, a musical grid with snap, and MIDI-style bars

- **Tempo** — `TimelineDocument.tempo?: { bpm, beatsPerBar }` (absent = 120 BPM
  4/4) and `lockDuration?: boolean`. Times stay in seconds. Changing the BPM
  with the duration UNLOCKED rescales every point and the duration (same
  beats, faster or slower); LOCKED it changes only the grid. A rescale that
  would put two points under 1 ms apart, or take the duration past its limits,
  is refused with a message.
- **Grid & snap** — the ruler reads in bars (beat ticks between), the lanes
  draw bar/beat/subdivision lines (thinned when zoomed out), and snap puts
  point times on the grid (Alt bypasses; arrow keys step one cell, Shift one
  bar). Grid, snap and division (1 bar … 1/16) are per-browser view settings
  (`localStorage` key `rbnt.timeline.view`), not document data.
- **Bars** — `TimelineCurve.display?: 'curve' | 'bars'`. A bars lane shows one
  bar per held step; in edit mode, press and drag to paint values. Turning a
  smooth curve into bars resamples it to one step per grid cell (asks first).
- New exported TYPES `TimelineTempo`, `CurveDisplay`; the runtime surface is
  unchanged. All new fields are optional — existing documents stay valid.

### Changed — layout

- The horizontal scrollbar is pinned under the toolbar; view buttons jump to
  the start, the playhead, or the end; the lane header is regrouped; all
  controls are 12px. The seconds-based ruler-step helper is gone (the ruler is
  musical).

### Changed — **BREAKING (CSS)**: every utility is namespaced `rbnt:`, and preflight is no longer shipped

- **All classes this plugin renders now carry an `rbnt:` prefix** —
  `rbnt:flex`, `rbnt:text-primary-white`. Same reasoning as the host library's
  `rbn:` migration: a plugin, its host and the consuming app all shipped
  Tailwind sheets declaring the same class names, and which one won was decided
  by stylesheet load order rather than by anything anyone controlled.

  **A DIFFERENT prefix from the host's `rbn:` is deliberate.** A shared prefix
  would put `.rbn\:flex` in both stylesheets again and recreate exactly the
  ordering bug this removes. The two namespaces are provably disjoint:
  `[class*='rbn:']` does not match `rbnt:flex`, because after `n` comes `t`,
  not `:`. Verified in the built sheet — zero `.rbn\:` selectors in this
  package's CSS.

  `cn` is imported from the host and already reconciles both namespaces
  (`FIRST_PARTY_PREFIXES = ['rbnt', 'rbn']`, longest-first), so passing a
  `rbnt:` class into a host component still merges correctly.

  **What breaks:** anything naming one of this package's class names from
  outside — a consumer stylesheet, an e2e selector. The `.rbnt-timeline` and
  `.rbnt-tl-toolbar` identity hooks are NOT classes in this sense and are
  unchanged.

- **Preflight is no longer part of `dist/style.css`.** The bundled
  `@import 'tailwindcss'` is split into `theme.css` + `utilities.css`;
  `prefix()` cannot namespace preflight because its selectors are element
  names. The load-bearing resets are re-declared in an `@layer base` block
  scoped to `[class*='rbnt:']`. The sheet drops from ~20 KB to 7.3 KB, and a
  page loading it keeps its own `<h1>`, `<ul>` and `<a>` styling.

  Verified mechanically: the compiled rule set with the prefix (prefix
  stripped) is IDENTICAL to the rule set without it — 86 selectors both sides.

### Fixed — the number fields' left chevron no longer lights up on hover

- Hovering the middle of any timeline number field (`t s`, `v`, `min`, `max`,
  `dur s`) also lit the DECREMENT chevron, at the full direct-hover brightness
  rather than the dim sibling one. The cause was not CSS: `NumberField` wrapped
  the host's three-button control in a `<label>`, a `<label>` binds to its first
  labelable descendant — the decrement chevron — and Chromium propagates
  `:hover` to that control from anywhere inside the label. Measured: with the
  pointer on the middle button the chevron reported `:hover` true and
  `rgba(255,255,255,0.22)` instead of `0.10`, and it did so for every pointer
  position inside the label; moving the identical markup out of the `<label>`
  fixed it with no CSS change.
- The wrapper is now `<div role="group" aria-labelledby>`. The visually-hidden
  full name is KEPT (not replaced by an `aria-label`): `sr-only` leaves the text
  in the accessibility tree, so readers that walk the document still reach it.
  While the pinned host (`^0.0.14`) cannot name the text field the control
  swaps to when clicked, the field is named on focus so it no longer announces
  itself as "dur"; that shim goes away once the plugin can use the host's
  `ariaLabel` prop.

### Added — pointer modes, fullscreen, rewind

- **Pan / edit modes**, exactly one active, shown as a pair in the toolbar.
  **Pan is the default**: dragging anywhere over the lanes moves through time,
  which is the gesture people reach for first and cannot damage a curve by
  accident. Edit is the previous behaviour (drag to add and move points). The
  RULER keeps scrubbing in both modes — it is the transport, not the canvas.
- **Fullscreen one curve**: a button per lane header (and an exit button in the
  toolbar) renders that curve alone at the full height the surrounding panel
  gives the timeline, following it as the host resizes. Escape leaves
  fullscreen; if the curve is deleted while fullscreen, the editor falls back to
  the full list rather than blanking.
- **Playhead to start** (`⏮`): moves the playhead to 0 WITHOUT stopping —
  while playing, the transport reschedules from the new position and keeps
  going.

### Changed — bigger, and every number is a slider

- Buttons and inputs are larger throughout (toolbar buttons 13px text with
  wider padding, fields 28px tall), and the lane header column widened to 240px
  to fit them.
- **A single curve's lane is 1.5× taller** (110 → 165 px, `LANE_HEIGHT_PX`).
- **Numbers are the host's `SliderNumberInput`** — drag to scrub, click to
  type, chevrons to step — instead of a plain text box that could only be typed
  into. Each shows a short label (`t s`, `v`, `min`, `max`, `dur s`) and carries
  its full name for screen readers.
- **The curve colour uses the host's `PopoverColorPicker`**, replacing the
  native `<input type="color">` that opened the operating system's dialog.

### Changed — styling is Tailwind now

- The package compiles **Tailwind v4** the way the host library does:
  `@tailwindcss/vite`, no config file, design tokens in `@theme` inside
  `src/style.css`, utilities written in the components. `dist/style.css` — the
  `exports['./style.css']` artifact consumers already import — is that compiled
  output, so nothing changes for a consumer except that the sheet is now
  self-contained utilities instead of hand-written `.rbnt-*` rules.
- The `.rbnt-*` class names survive ONLY as identity hooks: `rbnt-timeline`
  (which the component and its children find with `closest()`, and which a host
  application targets) and `rbnt-tl-toolbar`. They carry no styling.
- New `CurveTimeline` prop **`className`** (type `CurveTimelineProps`
  exported): appended to the root element and merged with the host's `cn`, so a
  host can fit the timeline to its own surface — drop the border inside a
  drawer, set a min-height, allow overflow so its sticky toolbar attaches to the
  host's scroll container — without a global stylesheet reaching into this
  package.

### Changed — the host is now a REQUIRED peer (BREAKING for host-less consumers)

- Every control in the timeline editor and in the curve-picker node is now the
  host library's own widget — `Button` for the transport, loop, add-curve,
  zoom, fit, auto and delete actions; `Input` for the duration, the curve name
  and the y-range fields; `Select` for the two per-side interpolation pickers
  and for the node's curve picker — so a host application's timeline looks and
  behaves like the rest of its editor instead of showing native form controls.
- Consequently `@theclearsky/react-blender-nodes` is no longer an OPTIONAL peer
  dependency: the plugin imports it at runtime. `peerDependenciesMeta` is gone.
  The rolled `.d.ts` still declares no host types (the node factory's props stay
  structural), so type-checking a consumer is unchanged.
- The host's stylesheet must be loaded for the timeline to look right:
  `import '@theclearsky/react-blender-nodes/style.css'` (host applications
  already do this).
- Accessible names for the number and name fields now come from wrapping
  `<label>`s with visually-hidden text (`.rbnt-tl-sr-only`), because the pinned
  host `Input` (`^0.0.14`) forwards no `aria-label`.
- `NumberField` no longer takes `step` (the host input has no stepper);
  Escape still cancels an edit, now by remounting the field so no blur-commit
  fires.

## 0.0.2 — 2026-09-06

No code changes since 0.0.1 (`TIMELINE_PLUGIN_VERSION` follows the version).

- First release published by CI: `npm publish --provenance` under OIDC trusted
  publishing from `library-deploy.yml`, so the registry carries a provenance
  attestation linking the tarball to the exact commit and workflow run. 0.0.1
  was published by hand once, only to create the package on the registry — npm
  can register a trusted publisher only for a package that already exists.

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
