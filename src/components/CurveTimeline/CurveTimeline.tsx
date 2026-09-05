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
import { CurveLane } from './CurveLane';
import { CurveLaneHeader } from './CurveLaneHeader';
import { PointEditorPanel } from './PointEditorPanel';
import { TimelineToolbar } from './TimelineToolbar';
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
} from './documentEdits';
import {
  autoValueRange,
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
export function CurveTimeline() {
  const { store, transport } = useTimelineContext();
  const document = useSyncExternalStore(
    store.subscribe,
    store.getDocument,
    store.getDocument,
  );
  const [timeScale, setTimeScale] = useState(80);
  const [yRangeOverrides, setYRangeOverrides] = useState<
    Record<string, LaneValueRange>
  >({});
  const [selection, setSelection] = useState<PointSelection | null>(null);
  const [fallbackPlayheadTime, setFallbackPlayheadTime] = useState(0);
  const [displayPlayheadTime, setDisplayPlayheadTime] = useState(0);
  const [, setTransportRevision] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
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

  const contentWidth = timeToPixel(document.durationSec, timeScale);

  return (
    <div
      className="rbnt-timeline"
      tabIndex={0}
      onKeyDown={(event) => {
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
          if (selection !== null) {
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
            const step =
              (largeStep ? 0.1 : 0.01) * (key === 'ArrowLeft' ? -1 : 1);
            nudgeActivePoint(step, 0);
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
      <TimelineToolbar
        document={document}
        transportState={transportState}
        playheadTime={playheadTime}
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
      />
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
      <div className="rbnt-tl-body">
        <div className="rbnt-tl-headers">
          <div
            className="rbnt-tl-ruler-spacer"
            style={{ height: RULER_HEIGHT_PX }}
          />
          {document.curves.map((curve) => {
            const valueRange = valueRanges[curve.id] ?? autoValueRange(curve);
            return (
              <CurveLaneHeader
                key={curve.id}
                curve={curve}
                valueRange={valueRange}
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
        <div className="rbnt-tl-scroll" ref={scrollRef}>
          <div
            className="rbnt-tl-content"
            style={{ width: Math.max(contentWidth, 1) }}
          >
            <TimeRuler
              durationSec={document.durationSec}
              timeScale={timeScale}
              snapTimes={snapTimes}
              onScrub={handleScrub}
            />
            {document.curves.map((curve) => {
              const valueRange = valueRanges[curve.id] ?? autoValueRange(curve);
              return (
                <CurveLane
                  key={curve.id}
                  curve={curve}
                  durationSec={document.durationSec}
                  timeScale={timeScale}
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
                />
              );
            })}
            {document.curves.length === 0 && (
              <div className="rbnt-tl-empty">
                No curves yet — add one with “+ curve”.
              </div>
            )}
            <div
              className="rbnt-tl-playhead"
              style={{ left: timeToPixel(playheadTime, timeScale) }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
