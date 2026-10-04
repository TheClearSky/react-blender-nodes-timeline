import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { TimelineDocument } from '../../model/types';
import { useTimelineContext } from '../../store/TimelineContext';
import { cn } from '@theclearsky/react-blender-nodes';
import { CurveLane } from './CurveLane';
import { CurveLaneHeader } from './CurveLaneHeader';
import { PointEditorPanel } from './PointEditorPanel';
import { TempoFinderModal, ValueGridFinderModal } from './GridFinderModal';
import { TimelineToolbar, type TimelineMode } from './TimelineToolbar';
import { TimeRuler } from './TimeRuler';
import {
  addCurve,
  addPoint,
  deleteCurve,
  deletePoint,
  hasWrapMismatch,
  movePoint,
  recolorCurve,
  renameCurve,
  setDuration,
  setPointInterp,
  toggleLoop,
  convertCurveToBars,
  isAllSteps,
  isTempoRefusal,
  MAX_BAR_CELLS,
  setBarValue,
  setBeatsPerBar,
  setCurveDisplay,
  setLockDuration,
  setTempoBpm,
  setTempoGrid,
  setValueGrid,
} from './documentEdits';
import { buildGridLines } from './gridLines';
import {
  barSeconds,
  cellSeconds,
  gridOrigin,
  GRID_DIVISION_LABELS,
  gridDivisions,
  snapToGrid,
  tempoOf,
  type GridDivision,
} from './tempo';
import {
  autoValueRange,
  LANE_HEIGHT_PX,
  clampTimeScale,
  fitTimeScale,
  RULER_HEIGHT_PX,
  timeToPixel,
  type LaneValueRange,
} from './timelineView';

type PointSelection = {
  readonly curveId: string;
  readonly pointIndex: number;
};

type PendingScrollAnchor = {
  readonly anchorTime: number;
  readonly viewportX: number;
};

/**
 * The curve timeline editor (plan §6). Document state comes from the
 * TimelineProvider's store; the (optional) transport supplies playback and
 * receives notifyDocumentChanged after every audio-relevant edit. All edit
 * handlers read store.getDocument() (never the render snapshot) so
 * pointer-drag streams can never apply against a stale document.
 *
 * Key handling (reviews UI-1/UI-2): while focus is inside the timeline,
 * Delete/Backspace/x are STOPPED from propagating — the graph host's
 * document-level delete listener (xyflow) ignores defaultPrevented, so
 * without this a point deletion would also delete selected graph nodes.
 * Escape is claimed only when it actually deselects, so an idle Escape
 * still reaches app-level handlers (panic-silence).
 */
export type CurveTimelineProps = {
  /**
   * Appended to the root element's classes, so a host application can fit the
   * timeline to its own surface (drop the border inside a drawer, set a
   * min-height, …) without a global stylesheet reaching into this package.
   * Merged with `cn`, so a conflicting Tailwind utility here wins.
   */
  className?: string;
};

type ViewPrefs = {
  readonly grid: boolean;
  readonly snap: boolean;
  readonly division: GridDivision;
};

const VIEW_PREFS_KEY = 'rbnt.timeline.view';
/** Grid on, snap OFF (existing curves keep dragging freely until asked). */
const DEFAULT_VIEW_PREFS: ViewPrefs = {
  grid: true,
  snap: false,
  division: '1/4',
};

/** Storage can be missing or throw (private windows, blocked site data). */
function readViewPrefs(): ViewPrefs {
  try {
    const raw = window.localStorage.getItem(VIEW_PREFS_KEY);
    if (raw === null) return DEFAULT_VIEW_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null)
      return DEFAULT_VIEW_PREFS;
    const record = parsed as Record<string, unknown>;
    const division = gridDivisions.find(
      (candidate) => candidate === record.division,
    );
    return {
      grid:
        typeof record.grid === 'boolean'
          ? record.grid
          : DEFAULT_VIEW_PREFS.grid,
      snap:
        typeof record.snap === 'boolean'
          ? record.snap
          : DEFAULT_VIEW_PREFS.snap,
      division: division ?? DEFAULT_VIEW_PREFS.division,
    };
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
}

function writeViewPrefs(prefs: ViewPrefs): void {
  try {
    window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered this time; the view still works.
  }
}

/** Empty space after the last second, in both scrollers. */
const END_GUTTER_PX = 32;

/** The lanes scroll sideways, but their own scrollbar is hidden: the strip
 *  pinned under the toolbar is the one the user drags. */
const LANES_SCROLLER =
  'rbnt:relative rbnt:flex-1 rbnt:overflow-x-auto rbnt:overflow-y-hidden rbnt:bg-primary-black ' +
  'rbnt:[scrollbar-width:none] rbnt:[&::-webkit-scrollbar]:hidden';

export function CurveTimeline({ className }: CurveTimelineProps = {}) {
  const { store, transport } = useTimelineContext();
  const document = useSyncExternalStore(
    store.subscribe,
    store.getDocument,
    store.getDocument,
  );
  const [timeScale, setTimeScale] = useState(80);
  // Pointer behaviour over the lanes. PAN is the default: dragging to move
  // through time is the gesture people reach for first, and it cannot damage
  // a curve by accident. Editing is one click away.
  const [mode, setMode] = useState<TimelineMode>('pan');
  // When set, only this curve renders, at the full height of the body.
  const [fullscreenCurveId, setFullscreenCurveId] = useState<string | null>(
    null,
  );
  // Space a fullscreen lane may fill. Measured from the ROOT, not from the
  // lane container: the container sizes to its content, so measuring it and
  // then sizing the content from that measurement is circular — it is why the
  // first attempt left a fullscreen lane at its normal height.
  const [laneSpaceHeight, setLaneSpaceHeight] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [yRangeOverrides, setYRangeOverrides] = useState<
    Record<string, LaneValueRange>
  >({});
  const [selection, setSelection] = useState<PointSelection | null>(null);
  // Grid, snap and division are the VIEWER's preferences, remembered in this
  // browser — not part of the document (plan timeline-midi-mode.md, Q-M3 A).
  const [viewPrefs, setViewPrefs] = useState<ViewPrefs>(readViewPrefs);
  useEffect(() => {
    writeViewPrefs(viewPrefs);
  }, [viewPrefs]);
  // A refused edit's reason, shown in the toolbar for a few seconds.
  const [notice, setNotice] = useState<string | null>(null);
  // Which Grid finder is open: time (tempo), or one lane's values.
  const [finder, setFinder] = useState<
    { kind: 'time' } | { kind: 'values'; curveId: string } | null
  >(null);
  useEffect(() => {
    if (notice === null) return;
    const handle = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(handle);
  }, [notice]);
  const [fallbackPlayheadTime, setFallbackPlayheadTime] = useState(0);
  const [displayPlayheadTime, setDisplayPlayheadTime] = useState(0);
  const [, setTransportRevision] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The horizontal scrollbar, pinned under the toolbar: the lanes' own
  // scrollbar sat below the LAST lane, so with a few curves it was out of
  // reach until the whole drawer was scrolled to the bottom.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const timeScaleRef = useRef(timeScale);
  timeScaleRef.current = timeScale;
  const pendingScrollAnchorRef = useRef<PendingScrollAnchor | null>(null);
  const applyingEditRef = useRef(false);
  const previousTransportRef = useRef(transport);

  useEffect(() => {
    if (transport === null) {
      return;
    }
    return transport.subscribe(() => {
      setTransportRevision((revision) => revision + 1);
    });
  }, [transport]);

  // A document replaced from OUTSIDE the editor (import, dev handles) can
  // reshuffle points arbitrarily — an index-based selection would silently
  // retarget (review UI-9).
  useEffect(() => {
    return store.subscribe(() => {
      if (!applyingEditRef.current) {
        setSelection(null);
      }
    });
  }, [store]);

  // Hand a pre-transport scrub position to the transport when it arrives
  // (review UI-24).
  useEffect(() => {
    if (
      previousTransportRef.current === null &&
      transport !== null &&
      fallbackPlayheadTime > 0
    ) {
      transport.scrub(fallbackPlayheadTime);
    }
    previousTransportRef.current = transport;
  }, [transport, fallbackPlayheadTime]);

  // A fullscreen lane fills whatever the surrounding panel gives the timeline
  // (the host's drawer is resizable). The measurement is the root's box minus
  // the chrome above the lanes — toolbar, the point editor when it is open,
  // and the ruler — which the body's offset from the root already accounts for.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (root === null || body === null) {
      return;
    }
    function measure() {
      if (root === null || body === null) return;
      // The PARENT's box, not the root's: the root grows with its content (its
      // `min-height` only sets a floor), so measuring the root and then sizing
      // its content from that measurement is circular — measured, and the
      // reason a fullscreen lane first stayed at its normal height. The parent
      // is what `min-h-full` resolves against, i.e. the space this timeline has
      // been given.
      const host = root.parentElement;
      if (host === null) return;
      const chromeAbove =
        body.getBoundingClientRect().top - root.getBoundingClientRect().top;
      setLaneSpaceHeight(host.clientHeight - chromeAbove - RULER_HEIGHT_PX);
    }
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    if (root.parentElement !== null) observer.observe(root.parentElement);
    observer.observe(body);
    return () => observer.disconnect();
    // Re-measured when the chrome above the lanes changes height: entering
    // fullscreen, and opening or closing the point editor.
  }, [fullscreenCurveId, selection !== null]);

  const transportState = transport?.getState() ?? null;

  useEffect(() => {
    if (transport === null || transportState !== 'playing') {
      return;
    }
    let frameHandle = 0;
    function frame() {
      if (transport !== null) {
        setDisplayPlayheadTime(transport.getPlayheadTime());
      }
      frameHandle = requestAnimationFrame(frame);
    }
    frameHandle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameHandle);
  }, [transport, transportState]);

  const playheadTime =
    transport === null
      ? fallbackPlayheadTime
      : transportState === 'playing'
        ? displayPlayheadTime
        : transport.getPlayheadTime();

  const applyEdit = useCallback(
    (
      nextDocument: TimelineDocument,
      changedCurveIds?: readonly string[],
      notifyTransport = true,
    ) => {
      applyingEditRef.current = true;
      try {
        store.setDocument(nextDocument);
      } finally {
        applyingEditRef.current = false;
      }
      if (notifyTransport) {
        transport?.notifyDocumentChanged(changedCurveIds);
      }
    },
    [store, transport],
  );

  const handleScrub = useCallback(
    (timeSeconds: number, phase: 'preview' | 'commit') => {
      if (transport !== null) {
        transport.scrub(timeSeconds, { preview: phase === 'preview' });
      } else {
        const durationSec = store.getDocument().durationSec;
        setFallbackPlayheadTime(
          Math.min(Math.max(timeSeconds, 0), durationSec),
        );
      }
    },
    [transport, store],
  );

  const activeSelection = useMemo(() => {
    if (selection === null) {
      return null;
    }
    const curve = document.curves.find(
      (candidate) => candidate.id === selection.curveId,
    );
    const point = curve?.points[selection.pointIndex];
    if (curve === undefined || point === undefined) {
      return null;
    }
    return { curve, pointIndex: selection.pointIndex, point };
  }, [selection, document]);

  // Stable per-curve range objects: a fresh object per render would defeat
  // every CurveLane's effect deps and force full canvas repaints at the rAF
  // rate while playing (review UI-4).
  const valueRanges = useMemo(() => {
    const ranges: Record<string, LaneValueRange> = {};
    for (const curve of document.curves) {
      ranges[curve.id] = yRangeOverrides[curve.id] ?? autoValueRange(curve);
    }
    return ranges;
  }, [document, yRangeOverrides]);

  // Snap targets for ruler scrubbing (§6 inspiration: snap-to-point).
  const snapTimes = useMemo(() => {
    const times = new Set<number>();
    for (const curve of document.curves) {
      for (const point of curve.points) {
        times.add(point.t);
      }
    }
    return [...times].sort((a, b) => a - b);
  }, [document]);

  function zoomAroundViewportX(nextScale: number, viewportX: number) {
    const container = scrollRef.current;
    const clamped = clampTimeScale(nextScale);
    if (clamped === timeScaleRef.current) {
      // React bails out on same-value setState, so the layout effect would
      // never consume a written anchor — don't arm one (review UI-6).
      pendingScrollAnchorRef.current = null;
      return;
    }
    if (container !== null) {
      const anchorTime =
        (container.scrollLeft + viewportX) / timeScaleRef.current;
      pendingScrollAnchorRef.current = { anchorTime, viewportX };
    }
    setTimeScale(clamped);
  }

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const anchor = pendingScrollAnchorRef.current;
    if (container === null || anchor === null) {
      return;
    }
    pendingScrollAnchorRef.current = null;
    container.scrollLeft = Math.max(
      0,
      anchor.anchorTime * timeScale - anchor.viewportX,
    );
  }, [timeScale]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) {
      return;
    }
    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey || container === null) {
        return;
      }
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      const rect = container.getBoundingClientRect();
      zoomAroundViewportXRef.current(
        timeScaleRef.current * factor,
        event.clientX - rect.left,
      );
    }
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);
  const zoomAroundViewportXRef = useRef(zoomAroundViewportX);
  zoomAroundViewportXRef.current = zoomAroundViewportX;

  function handleFit() {
    const container = scrollRef.current;
    if (container === null) {
      return;
    }
    const fitted = fitTimeScale(
      container.clientWidth,
      store.getDocument().durationSec,
    );
    if (fitted === timeScaleRef.current) {
      pendingScrollAnchorRef.current = null;
      container.scrollLeft = 0;
      return;
    }
    // Route through the anchor so the layout effect lands scroll at 0
    // instead of consuming a stale anchor (review UI-6).
    pendingScrollAnchorRef.current = { anchorTime: 0, viewportX: 0 };
    setTimeScale(fitted);
  }

  function deleteActivePoint() {
    if (activeSelection === null) {
      return;
    }
    applyEdit(
      deletePoint(
        store.getDocument(),
        activeSelection.curve.id,
        activeSelection.pointIndex,
      ),
      [activeSelection.curve.id],
    );
    setSelection(null);
  }

  function nudgeActivePoint(
    deltaTimeSeconds: number,
    deltaValueFraction: number,
  ) {
    if (activeSelection === null) {
      return;
    }
    const range = valueRanges[activeSelection.curve.id];
    const valueSpan = range === undefined ? 1 : range.max - range.min;
    applyEdit(
      movePoint(
        store.getDocument(),
        activeSelection.curve.id,
        activeSelection.pointIndex,
        activeSelection.point.t + deltaTimeSeconds,
        activeSelection.point.v + deltaValueFraction * valueSpan,
      ),
      [activeSelection.curve.id],
    );
  }

  /**
   * Mirror one scroller's position onto the other (the strip and the lanes).
   *
   * The write fires a scroll event on the target, and mirroring THAT back
   * would write the source mid-flight — which cancels a smooth scroll (the
   * start/end/playhead jumps stopped after a few pixels, measured). So each
   * write is remembered, and the target's event carrying that exact position
   * is recognised as our own echo and dropped.
   */
  const scrollEchoRef = useRef(new Map<HTMLElement, number>());
  function mirrorScroll(from: HTMLElement | null, to: HTMLElement | null) {
    if (from === null || to === null) return;
    const echoes = scrollEchoRef.current;
    const echo = echoes.get(from);
    if (echo !== undefined) {
      echoes.delete(from);
      if (Math.abs(from.scrollLeft - echo) < 1) return;
    }
    if (Math.abs(to.scrollLeft - from.scrollLeft) > 0.5) {
      echoes.set(to, from.scrollLeft);
      to.scrollLeft = from.scrollLeft;
    }
  }

  /** Move the VIEW (not the playhead) so `left` px of content is at its left
   *  edge, clamped to the content. */
  function scrollViewTo(left: number) {
    const container = scrollRef.current;
    if (container === null) return;
    const target = Math.min(
      Math.max(0, left),
      Math.max(0, container.scrollWidth - container.clientWidth),
    );
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
        left: target,
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    } else {
      container.scrollLeft = target;
    }
  }

  const contentWidth = timeToPixel(document.durationSec, timeScale);
  const tempo = tempoOf(document);
  const cellSec = cellSeconds(tempo, viewPrefs.division);
  const gridStart = gridOrigin(tempo);
  const gridLines = useMemo(
    () =>
      viewPrefs.grid
        ? buildGridLines(document.durationSec, tempo, cellSec, timeScale)
        : [],
    [viewPrefs.grid, document.durationSec, tempo, cellSec, timeScale],
  );
  const snapTime = useCallback(
    (timeSeconds: number) => snapToGrid(timeSeconds, cellSec, gridStart),
    [cellSec, gridStart],
  );
  // What BOTH scrollers scroll through: the timeline plus a gutter, so the
  // last ruler label is readable. The lanes' content is clipped to it — a label
  // hanging past the end made the lanes 21px longer than the strip, the two
  // clamped each other, and the start/end jumps stalled (measured).
  const scrollExtent = Math.max(contentWidth, 1) + END_GUTTER_PX;
  // A fullscreen id whose curve has since been deleted must not blank the
  // editor — resolve it against the document on every render.
  const fullscreenCurve =
    fullscreenCurveId === null
      ? null
      : (document.curves.find((curve) => curve.id === fullscreenCurveId) ??
        null);
  const isFullscreen = fullscreenCurve !== null;
  const visibleCurves = isFullscreen ? [fullscreenCurve] : document.curves;
  const laneHeight =
    isFullscreen && laneSpaceHeight > 0
      ? Math.max(LANE_HEIGHT_PX, laneSpaceHeight)
      : LANE_HEIGHT_PX;

  /** Drag-to-pan, active in `pan` mode everywhere except the ruler (which
   *  scrubs in both modes — it is the transport, not the canvas). */
  const panOriginRef = useRef<{ x: number; scrollLeft: number } | null>(null);
  function handlePanPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (mode !== 'pan' || event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest('[data-rbnt-ruler]') !== null
    ) {
      return;
    }
    const container = scrollRef.current;
    if (container === null) return;
    panOriginRef.current = {
      x: event.clientX,
      scrollLeft: container.scrollLeft,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already-released pointer ids (tests, some pens) cannot be
      // captured. The drag still tracks through the move handler; only the
      // release-outside-the-element case degrades.
    }
  }
  function handlePanPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = panOriginRef.current;
    const container = scrollRef.current;
    if (origin === null || container === null) return;
    container.scrollLeft = origin.scrollLeft - (event.clientX - origin.x);
  }
  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (panOriginRef.current === null) return;
    panOriginRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Same tolerance as the capture above.
    }
  }

  return (
    <div
      // `rbnt-timeline` carries NO styling — it is the identity hook this
      // component and its children look up with `closest()`, and the handle a
      // host application targets.
      ref={rootRef}
      className={cn(
        'rbnt-timeline rbnt:flex rbnt:flex-col rbnt:overflow-hidden rbnt:rounded-md rbnt:border',
        'rbnt:border-secondary-dark-gray rbnt:bg-primary-black rbnt:text-xs',
        'rbnt:text-primary-white rbnt:outline-none',
        'rbnt:focus-visible:border-secondary-light-gray',
        'rbnt:font-[system-ui,sans-serif]',
        className,
      )}
      tabIndex={0}
      onKeyDown={(event) => {
        // A portalled dialog (the Grid finder) is a React child, so its keys
        // bubble here too — but it is not inside this element. Its Delete
        // must never delete a selected point.
        if (
          !(event.target instanceof Node) ||
          !event.currentTarget.contains(event.target)
        ) {
          return;
        }
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement ||
          event.target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        const key = event.key;
        if (key === 'Delete' || key === 'Backspace' || key === 'x') {
          // Never let the graph's delete keys fire from timeline focus
          // (review UI-1).
          event.stopPropagation();
          if (
            (key === 'Delete' || key === 'Backspace') &&
            activeSelection !== null
          ) {
            event.preventDefault();
            deleteActivePoint();
          }
        } else if (key === 'Escape') {
          if (fullscreenCurveId !== null) {
            // Leaving fullscreen is the more urgent Escape: it is the state
            // that hides the rest of the document.
            event.preventDefault();
            event.stopPropagation();
            setFullscreenCurveId(null);
          } else if (selection !== null) {
            // Claim the key so app-level Escape handlers that honor
            // defaultPrevented (panic-silence) skip a mere deselect
            // (review UI-2).
            event.preventDefault();
            event.stopPropagation();
            setSelection(null);
          }
        } else if (activeSelection !== null) {
          const largeStep = event.shiftKey;
          if (key === 'ArrowLeft' || key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            const direction = key === 'ArrowLeft' ? -1 : 1;
            if (viewPrefs.snap) {
              // One grid cell (Shift: one bar), landing on a grid line.
              const step = largeStep ? barSeconds(tempo) : cellSec;
              const target = snapToGrid(
                activeSelection.point.t + direction * step,
                step,
                gridStart,
              );
              nudgeActivePoint(target - activeSelection.point.t, 0);
            } else {
              nudgeActivePoint((largeStep ? 0.1 : 0.01) * direction, 0);
            }
          } else if (key === 'ArrowUp' || key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            const step =
              (largeStep ? 0.1 : 0.01) * (key === 'ArrowDown' ? -1 : 1);
            nudgeActivePoint(0, step);
          }
        }
      }}
    >
      {/* ONE sticky block: the toolbar and the scroll strip pin together. */}
      <div className="rbnt:sticky rbnt:top-0 rbnt:z-5 rbnt:bg-secondary-black">
        <TimelineToolbar
          document={document}
          transportState={transportState}
          playheadTime={playheadTime}
          mode={mode}
          onModeChange={setMode}
          isFullscreen={isFullscreen}
          onExitFullscreen={() => setFullscreenCurveId(null)}
          onRewindToStart={() => {
            // Not `stop()` — scrubbing while playing reschedules from the new
            // position and keeps playing (transport.scrub).
            if (transport !== null) transport.scrub(0);
            else setFallbackPlayheadTime(0);
          }}
          onPlay={() => transport?.play()}
          onPause={() => transport?.pause()}
          onStop={() => transport?.stop()}
          onToggleLoop={() => applyEdit(toggleLoop(store.getDocument()))}
          onSetDuration={(nextDurationSec) =>
            applyEdit(setDuration(store.getDocument(), nextDurationSec))
          }
          onAddCurve={() => {
            const result = addCurve(store.getDocument());
            applyEdit(result.document);
          }}
          onZoomIn={() => {
            const container = scrollRef.current;
            zoomAroundViewportX(
              timeScaleRef.current * 1.25,
              container === null ? 0 : container.clientWidth / 2,
            );
          }}
          onZoomOut={() => {
            const container = scrollRef.current;
            zoomAroundViewportX(
              timeScaleRef.current * 0.8,
              container === null ? 0 : container.clientWidth / 2,
            );
          }}
          onFit={handleFit}
          tempo={tempo}
          lockDuration={document.lockDuration === true}
          onSetBpm={(bpm) => {
            const result = setTempoBpm(store.getDocument(), bpm);
            if (isTempoRefusal(result)) setNotice(result.refused);
            else applyEdit(result);
          }}
          onSetBeatsPerBar={(beatsPerBar) =>
            // The grid only — nothing audible changes.
            applyEdit(
              setBeatsPerBar(store.getDocument(), beatsPerBar),
              undefined,
              false,
            )
          }
          onToggleLockDuration={() => {
            const current = store.getDocument();
            applyEdit(
              setLockDuration(current, current.lockDuration !== true),
              undefined,
              false,
            );
          }}
          gridVisible={viewPrefs.grid}
          snapEnabled={viewPrefs.snap}
          division={viewPrefs.division}
          onToggleGrid={() =>
            setViewPrefs((prefs) => ({ ...prefs, grid: !prefs.grid }))
          }
          onToggleSnap={() =>
            setViewPrefs((prefs) => ({ ...prefs, snap: !prefs.snap }))
          }
          onDivisionChange={(division) =>
            setViewPrefs((prefs) => ({ ...prefs, division }))
          }
          notice={notice}
          onFindGrid={() => setFinder({ kind: 'time' })}
          onViewStart={() => scrollViewTo(0)}
          onViewPlayhead={() => {
            const container = scrollRef.current;
            if (container === null) return;
            scrollViewTo(
              timeToPixel(playheadTime, timeScale) - container.clientWidth / 2,
            );
          }}
          onViewEnd={() => scrollViewTo(Number.POSITIVE_INFINITY)}
        />
        <div className="rbnt:flex rbnt:border-b rbnt:border-secondary-dark-gray">
          <div className="rbnt:w-60 rbnt:flex-shrink-0 rbnt:border-r rbnt:border-secondary-dark-gray" />
          <div
            ref={stripRef}
            data-rbnt-scroll-strip=""
            aria-hidden="true"
            className="rbnt:flex-1 rbnt:overflow-x-auto rbnt:overflow-y-hidden rbnt:[scrollbar-color:var(--color-secondary-light-gray)_transparent] rbnt:[scrollbar-width:thin]"
            onScroll={() => mirrorScroll(stripRef.current, scrollRef.current)}
          >
            <div style={{ width: scrollExtent, height: 1 }} />
          </div>
        </div>
      </div>
      {activeSelection !== null && (
        <PointEditorPanel
          curveName={activeSelection.curve.name}
          pointIndex={activeSelection.pointIndex}
          point={activeSelection.point}
          onSetTime={(timeSeconds) =>
            applyEdit(
              movePoint(
                store.getDocument(),
                activeSelection.curve.id,
                activeSelection.pointIndex,
                timeSeconds,
                activeSelection.point.v,
              ),
              [activeSelection.curve.id],
            )
          }
          onSetValue={(value) =>
            applyEdit(
              movePoint(
                store.getDocument(),
                activeSelection.curve.id,
                activeSelection.pointIndex,
                activeSelection.point.t,
                value,
              ),
              [activeSelection.curve.id],
            )
          }
          onSetInterp={(side, interp) =>
            applyEdit(
              setPointInterp(
                store.getDocument(),
                activeSelection.curve.id,
                activeSelection.pointIndex,
                side,
                interp,
              ),
              [activeSelection.curve.id],
            )
          }
          onDeletePoint={deleteActivePoint}
        />
      )}
      <div
        ref={bodyRef}
        className="rbnt:flex rbnt:min-h-[60px] rbnt:items-stretch"
      >
        <div className="rbnt:w-60 rbnt:flex-shrink-0 rbnt:border-r rbnt:border-secondary-dark-gray rbnt:bg-tl-header-bg">
          <div
            className="rbnt:box-border rbnt:border-b rbnt:border-secondary-dark-gray"
            style={{ height: RULER_HEIGHT_PX }}
          />
          {visibleCurves.map((curve) => {
            const valueRange = valueRanges[curve.id] ?? autoValueRange(curve);
            return (
              <CurveLaneHeader
                key={curve.id}
                curve={curve}
                valueRange={valueRange}
                laneHeight={laneHeight}
                isFullscreen={isFullscreen}
                onToggleFullscreen={() =>
                  setFullscreenCurveId((current) =>
                    current === curve.id ? null : curve.id,
                  )
                }
                isAutoRange={yRangeOverrides[curve.id] === undefined}
                onRename={(name) =>
                  // Names never affect audio — skip the transport
                  // reschedule (review UI-12).
                  applyEdit(
                    renameCurve(store.getDocument(), curve.id, name),
                    [curve.id],
                    false,
                  )
                }
                onRecolor={(color) =>
                  applyEdit(
                    recolorCurve(store.getDocument(), curve.id, color),
                    [curve.id],
                    false,
                  )
                }
                onSetRange={(min, max) =>
                  setYRangeOverrides((overrides) => ({
                    ...overrides,
                    [curve.id]: { min, max },
                  }))
                }
                onResetRange={() =>
                  setYRangeOverrides((overrides) => {
                    const next = { ...overrides };
                    delete next[curve.id];
                    return next;
                  })
                }
                onToggleValueLines={() => {
                  const grid = curve.valueGrid;
                  if (grid === undefined) return;
                  applyEdit(
                    setValueGrid(store.getDocument(), curve.id, {
                      ...grid,
                      show: !grid.show,
                    }),
                    [curve.id],
                    false,
                  );
                }}
                onToggleValueSnap={() => {
                  const grid = curve.valueGrid;
                  if (grid === undefined) return;
                  applyEdit(
                    setValueGrid(store.getDocument(), curve.id, {
                      ...grid,
                      snap: !grid.snap,
                    }),
                    [curve.id],
                    false,
                  );
                }}
                onFindValueGrid={() =>
                  setFinder({ kind: 'values', curveId: curve.id })
                }
                onSetDisplay={(display) => {
                  const current = store.getDocument();
                  const target = current.curves.find(
                    (candidate) => candidate.id === curve.id,
                  );
                  if (target === undefined) return;
                  if (display === 'curve') {
                    // Nothing audible changes: the points stay as they are.
                    applyEdit(
                      setCurveDisplay(current, curve.id, 'curve'),
                      [curve.id],
                      false,
                    );
                    return;
                  }
                  if (
                    target.points.length > 0 &&
                    !isAllSteps(target) &&
                    !window.confirm(
                      `Show "${target.name}" as bars?\n\nIts smooth shape becomes one step per ${GRID_DIVISION_LABELS[viewPrefs.division]} (its value at the start of each), and it will sound stepped.`,
                    )
                  ) {
                    return;
                  }
                  const result = convertCurveToBars(
                    current,
                    curve.id,
                    cellSec,
                    gridStart,
                  );
                  if (result === null) {
                    setNotice(
                      `That grid would make more than ${MAX_BAR_CELLS} bars — pick a coarser division first.`,
                    );
                    return;
                  }
                  setSelection(null);
                  applyEdit(result, [curve.id]);
                }}
                onDeleteCurve={() => {
                  applyEdit(deleteCurve(store.getDocument(), curve.id), [
                    curve.id,
                  ]);
                  setSelection(null);
                  // Stale overrides must not survive to a future curve
                  // (review UI-7).
                  setYRangeOverrides((overrides) => {
                    const next = { ...overrides };
                    delete next[curve.id];
                    return next;
                  });
                }}
              />
            );
          })}
        </div>
        <div
          className={
            mode === 'pan'
              ? `${LANES_SCROLLER} rbnt:cursor-grab rbnt:active:cursor-grabbing`
              : LANES_SCROLLER
          }
          ref={scrollRef}
          onScroll={() => mirrorScroll(scrollRef.current, stripRef.current)}
          onPointerDown={handlePanPointerDown}
          onPointerMove={handlePanPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          <div
            className="rbnt:relative rbnt:overflow-hidden"
            style={{ width: scrollExtent }}
          >
            <TimeRuler
              durationSec={document.durationSec}
              timeScale={timeScale}
              snapTimes={snapTimes}
              tempo={tempo}
              onScrub={handleScrub}
            />
            {visibleCurves.map((curve) => {
              const valueRange = valueRanges[curve.id] ?? autoValueRange(curve);
              return (
                <CurveLane
                  key={curve.id}
                  curve={curve}
                  durationSec={document.durationSec}
                  timeScale={timeScale}
                  laneHeight={laneHeight}
                  mode={mode}
                  valueRange={valueRange}
                  showWrapMismatch={hasWrapMismatch(document, curve)}
                  selectedPointIndex={
                    selection !== null && selection.curveId === curve.id
                      ? selection.pointIndex
                      : null
                  }
                  onSelectPoint={(pointIndex) =>
                    setSelection({ curveId: curve.id, pointIndex })
                  }
                  onAddPoint={(timeSeconds, value) => {
                    const result = addPoint(
                      store.getDocument(),
                      curve.id,
                      timeSeconds,
                      value,
                    );
                    if (result === null) {
                      return null;
                    }
                    applyEdit(result.document, [curve.id]);
                    setSelection({
                      curveId: curve.id,
                      pointIndex: result.pointIndex,
                    });
                    return result.pointIndex;
                  }}
                  onMovePoint={(pointIndex, timeSeconds, value) =>
                    applyEdit(
                      movePoint(
                        store.getDocument(),
                        curve.id,
                        pointIndex,
                        timeSeconds,
                        value,
                      ),
                      [curve.id],
                    )
                  }
                  gridLines={gridLines}
                  snapTime={viewPrefs.snap ? snapTime : undefined}
                  onPaintBar={(timeSeconds, value) =>
                    applyEdit(
                      setBarValue(
                        store.getDocument(),
                        curve.id,
                        timeSeconds,
                        value,
                        cellSec,
                        gridStart,
                      ),
                      [curve.id],
                    )
                  }
                />
              );
            })}
            {document.curves.length === 0 && (
              <div className="rbnt:p-6 rbnt:text-primary-light-gray">
                No curves yet — add one with “+ curve”.
              </div>
            )}
            <div
              className="rbnt:pointer-events-none rbnt:absolute rbnt:top-0 rbnt:bottom-0 rbnt:w-0 rbnt:border-l rbnt:border-tl-accent"
              style={{ left: timeToPixel(playheadTime, timeScale) }}
            />
          </div>
        </div>
      </div>
      {finder?.kind === 'time' && (
        <TempoFinderModal
          open
          onOpenChange={(open) => {
            if (!open) setFinder(null);
          }}
          document={document}
          tempo={tempo}
          onApply={(choice) => {
            // The grid only: points and duration keep their seconds (Q-F1 A).
            applyEdit(
              setTempoGrid(store.getDocument(), choice),
              undefined,
              false,
            );
            setViewPrefs((prefs) => ({
              ...prefs,
              grid: true,
              division: choice.division,
            }));
          }}
        />
      )}
      {finder?.kind === 'values' &&
        (() => {
          const target = document.curves.find(
            (curve) => curve.id === finder.curveId,
          );
          if (target === undefined) return null;
          return (
            <ValueGridFinderModal
              open
              onOpenChange={(open) => {
                if (!open) setFinder(null);
              }}
              curve={target}
              durationSec={document.durationSec}
              valueRange={valueRanges[target.id] ?? autoValueRange(target)}
              onApply={(shape) =>
                applyEdit(
                  setValueGrid(store.getDocument(), target.id, {
                    ...shape,
                    show: true,
                    snap: target.valueGrid?.snap ?? false,
                  }),
                  [target.id],
                  false,
                )
              }
            />
          );
        })()}
    </div>
  );
}
