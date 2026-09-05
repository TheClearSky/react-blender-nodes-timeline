# react-blender-nodes-timeline

Timeline plugin for
[`@theclearsky/react-blender-nodes`](https://github.com/TheClearSky/react-blender-nodes)
— multipart named curves with per-side interpolation, a drag/play transport
that schedules curve values sample-accurately onto Web Audio `AudioParam`s,
and a per-curve node factory (live `signal` output + Run-time `number`
output).

## How these projects fit together

```text
                react-blender-nodes  ·  MIT  ·  published
                            T H E   E N G I N E
     ┌────────────────────────────────────────────────────────────┐
     │  A Blender-style node-graph editor for React.              │
     │  Typed handles · validate → plan → apply state · node      │
     │  groups · loops & switches · graph compiler + runner ·     │
     │  import / export                                           │
     └──────┬──────────────────────┬────────────────────────┬─────┘
            │                      │                        │
            │ peerDependency       │ peerDependency         │ file:
            │ >=0.0.14 <1          │ >=0.0.14 <1            │ dependency
            │  ◀── this package    │ (via /contract —       │
            ▼                      ▼  React-free)           │
  ┌──────────────────────┐  ┌──────────────────────┐        │
  │ …-timeline           │  │ …-codegen            │        │
  │ AGPL-3.0 · published │  │ AGPL-3.0 · published │        │
  ├──────────────────────┤  ├──────────────────────┤        │
  │ Keyframed CURVES and │  │ Compiles a graph into│        │
  │ a transport. A curve │  │ a standalone,        │        │
  │ becomes a live signal│  │ dependency-free      │        │
  │ the running graph    │  │ runGraph module.     │        │
  │ can read.            │  │ No React at runtime. │        │
  └──────────┬───────────┘  └──────────────────────┘        │
             │                                              │
             │ file: dependency                             │
             └───────────────────┬──────────────────────────┘
                                 ▼
     ┌────────────────────────────────────────────────────────────┐
     │  react-blender-nodes-sound  ·  AGPL-3.0  ·  app            │
     │                  T H E   A P P L I C A T I O N             │
     ├────────────────────────────────────────────────────────────┤
     │  Here the nodes ARE the audio graph (Tone.js / Web Audio): │
     │  draw a waveform and hear it · gate-driven envelopes ·     │
     │  16-key polyphony · timeline curves automating any         │
     │  parameter while it plays · a spectrally-modelled          │
     │  instrument library                                        │
     └────────────────────────────────────────────────────────────┘
```

An arrow points from a package **to the package that depends on it**. The
two plugins never import each other — the sound app is the only place they
meet, and it is the reference consumer this plugin is validated against.

## The model

A `TimelineDocument` is `{ version: 1, durationSec, loop, curves[] }`. Each
`TimelineCurve` is a named, colored `value(t)` defined by keyframe points
over the document duration; values are ABSOLUTE in the curve's own unit
(e.g. Hz). Each `CurvePoint` is `{ t, v, leftInterp, rightInterp }` — the
LEFT side shapes the segment arriving at the point, the RIGHT side the
segment leaving it:

- `step` on either facing side → the whole segment HOLDS the start value
  and jumps at its end (one rule, no half-steps);
- otherwise the segment is a cubic bezier in normalized segment space with
  `linear → P1=(1/3,1/3), P2=(2/3,2/3)` (exactly the straight line) and
  `ease → P1=(0.42,0), P2=(0.58,1)` (CSS ease-in-out), the start point's
  right side supplying P1 and the end point's left side P2.

`evaluateCurve(curve, t)` clamps: before the first point → first value,
after the last → last value, no points → `defaultValue`. Zod schemas
(`timelineDocumentSchema`, `parseTimelineDocument`) validate imports with
path-level errors: strictly increasing `t` (min Δ 1 ms), all-finite values,
`durationSec` ≥ every last point, unique curve ids, version gate.

## Transport semantics

`createTimelineTransport({ context, getDocument, registry })` runs a
stopped / playing / paused / ended machine on ONE clock — the audio
context's `currentTime`; the UI only reads the playhead.

- Scheduling is anchor-first (`setValueAtTime(curve(t₀), t₀)`), per
  segment: step → set, pure linear → set+ramp (exact endpoints), curved →
  one resampled `setValueCurveAtTime` (min(256, max(8, ceil(dur·200)))
  samples) — which also realizes partial mid-segment rescheduling. Every
  pass ends with a terminal `setValueAtTime(curve(end), end)`.
- The LOOP WRAP IS APPEND-ONLY: an interval keeps ≥ 2 s of automation
  written ahead (rAF-independent, so background tabs keep playing) and the
  next pass is appended — a clean wrap performs ZERO cancel calls
  (`cancelScheduledValues` deletes an in-flight curve event entirely per
  spec, which would glitch every loop).
- `pause()` = cancel + hold `curve(t)`; `stop()` = cancel + anchor
  `curve(0)`; natural end with loop off → `ended` (playhead parks, params
  hold the terminal value); `play()` from `ended` restarts at 0.
- `scrub(t, { preview })` clamps into `[0, durationSec]`; preview writes
  only a ~2 s window per call (drag storms), a plain scrub commits the full
  remainder. Scrubbing while `ended` re-parks as `paused`.
- Document edits arrive via `notifyDocumentChanged()` (call after every
  `store.setDocument`) and coalesce to one reschedule per frame; a playing
  transport re-anchors at the current time so edits are heard immediately.
- Every pass anchors `scheduleHeadroomSeconds` (default 0.08 s) in the
  future: large scores take longer to write than an audio render quantum,
  and Chrome shifts past-dated curve windows forward — headroom keeps every
  event ahead of the clock.

## Drivers and builds

`createTimelineDriverRegistry(context)` mints ONE `ConstantSourceNode` per
(curve, build) via the injected context's `createConstantSource()` factory
— never DOM constructors, so Tone.js 15's `rawContext`
(standardized-audio-context) works directly. `acquireDriver(curveId,
buildId)` returns `{ node, isNew }`: only the FIRST acquirer registers
disposal (shared curves fan out from one driver). `releaseBuild(buildId)`
only PRUNES registry entries — stopping/disconnecting nodes stays with the
app's own disposal, called AFTER releasing so the transport stops
scheduling first. The transport subscribes to the registry: new builds
reschedule while playing, parked drivers refresh to `curve(playhead)`.

## Integration sketch

```tsx
const store = createTimelineDocumentStore(demoTimelineDocument);
// after the audio context is running:
const registry = createTimelineDriverRegistry(audioContext);
const transport = createTimelineTransport({
  context: audioContext,
  registry,
  getDocument: store.getDocument,
});

<TimelineProvider store={store} transport={transport}>
  {/* the node graph — the picker needs this provider above it */}
  <CurveTimeline />
</TimelineProvider>;
```

Node integration: `makeTimelineCurveNodeType({ signalDataTypeId,
numberDataTypeId, curveRefDataTypeId })` returns a host-shaped node type
(picker-only `Curve` input; `Signal` = the live driver; `Value` = the curve
sampled at RUN time — it does not vary during playback). Register
`TimelineCurvePicker` under your `curveRef` dataType (schema:
`timelineCurveRefSchema`), and in the node's implementation call
`registry.acquireDriver(...)`, wrap `node` in your engine's signal value,
and register disposal when `isNew`. Import
`@theclearsky/react-blender-nodes-timeline/style.css` once.

Semantics worth knowing (plan §8):

- Multiple modulators on one target param SUM — a curve driver, an LFO, and
  a base value all add (Web Audio native behavior).
- Values beyond a target param's own range are clamped by Web Audio per the
  param's min/max — the plugin never clamps curve values.
- An unset or dangling curve reference runs safely: the picker shows a red
  missing state, the driver anchors to a constant 0, and a console warning
  names the reference.
- The picker's unset state commits `undefined` (the host drops it from
  exports; it round-trips as absent).
- `transport.notifyDocumentChanged(changedCurveIds?)` — the argument is
  currently IGNORED (reserved); every edit reschedules all live drivers.
- This library is client-only (canvas, Web Audio). The picker renders inside
  the HOST's tree: without a `<TimelineProvider>` above the graph it
  degrades to a disabled select plus one console error. TYPE-checking the
  package does not require the host peer (the picker's props are
  structural), so host-less transport/editor consumers stay fully typed.
- Curve editing is pointer-first; a selected point can also be nudged with
  the arrow keys (Shift = coarse). Full keyboard traversal is on the
  backlog.

## Run

```bash
npm install          # the host peer comes from the registry (>= 0.0.14)
npm run dev          # editor playground at http://localhost:5173
npm run type-check   # tsc -b
npm run test:unit    # vitest (interpolation oracles + transport pins — 82 tests)
npm run build        # tsc -b && vite build && dist type-check + load gates
```

## License

GNU Affero General Public License v3.0 (`AGPL-3.0-only`) — see
[LICENSE](./LICENSE). Copyright (C) 2026 Deepak Prasad.

Curves, automation, and audio you create with tools built on this plugin
are yours — the license covers the code, not your output.
Commercial/proprietary licensing is available separately — contact
[@TheClearSky](https://github.com/TheClearSky).
