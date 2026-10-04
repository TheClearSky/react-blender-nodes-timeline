import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { evaluateCurve } from '../../model/evaluate';
import type { TimelineCurve } from '../../model/types';
import { buildValueLines, snapValue, type GridLine } from './gridLines';
import {
  pixelToTime,
  timeToPixel,
  valueToY,
  yToValue,
  type LaneValueRange,
} from './timelineView';

export type CurveLaneProps = {
  curve: TimelineCurve;
  durationSec: number;
  timeScale: number;
  /** This lane's height in CSS px — the default, or the fullscreen height. */
  laneHeight: number;
  /** `pan` leaves every pointer gesture to the scroll container. */
  mode: 'pan' | 'edit';
  valueRange: LaneValueRange;
  showWrapMismatch: boolean;
  selectedPointIndex: number | null;
  onSelectPoint(pointIndex: number): void;
  /** Returns the new point's index so the press can keep dragging it. */
  onAddPoint(timeSeconds: number, value: number): number | null;
  onMovePoint(pointIndex: number, timeSeconds: number, value: number): void;
  /** Vertical grid lines to paint (empty when the grid is hidden). */
  gridLines: readonly GridLine[];
  /** Snaps a time to the grid — absent while snapping is off. Holding Alt
   *  during the gesture bypasses it. */
  snapTime?: (timeSeconds: number) => number;
  /** Bars lanes: set the bar under this time to this value (press and drag
   *  across bars to paint). */
  onPaintBar(timeSeconds: number, value: number): void;
};

/** Grid line colours by strength: subdivision, beat, bar. */
const GRID_COLORS = ['#262626', '#303030', '#474747'] as const;

const POINT_HIT_RADIUS_PX = 7;
/** Backing-store cap: browser canvases fail SILENTLY past ~16k–32k device
 *  px; painting stops at the cap rather than blanking the lane
 *  (review UI-3; windowed rendering stays backlog). */
const MAX_CANVAS_CSS_WIDTH_PX = 16000;
/** Handles for points outside the view range pin to the lane edge so they
 *  stay visible and clickable (review UI-15). */
const EDGE_PIN_MARGIN_PX = 5;

/**
 * One lane: a canvas painting the sampled curve + point handles (plan §6).
 * Click empty space = add a point (and keep dragging it); drag a point =
 * move it — neighbor/1 ms clamping lives in documentEdits, values clamp to
 * the lane's view range.
 */
export function CurveLane({
  curve,
  durationSec,
  timeScale,
  laneHeight,
  mode,
  valueRange,
  showWrapMismatch,
  selectedPointIndex,
  onSelectPoint,
  onAddPoint,
  onMovePoint,
  gridLines,
  snapTime,
  onPaintBar,
}: CurveLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragPointIndexRef = useRef<number | null>(null);
  const paintingRef = useRef(false);
  const isBars = curve.display === 'bars';

  // Any structural change (delete mid-drag, external replace) invalidates
  // the dragged INDEX — cancel the drag instead of retargeting a neighbor
  // (review UI-9).
  useEffect(() => {
    dragPointIndexRef.current = null;
  }, [curve.points.length]);

  function pinnedHandleY(value: number): number {
    const rawY = valueToY(value, valueRange, laneHeight);
    return Math.min(
      Math.max(rawY, EDGE_PIN_MARGIN_PX),
      laneHeight - EDGE_PIN_MARGIN_PX,
    );
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const context = canvas.getContext('2d');
    if (context === null) {
      return;
    }
    const devicePixelRatioValue = window.devicePixelRatio || 1;
    const cssWidth = Math.max(
      1,
      Math.min(
        Math.round(timeToPixel(durationSec, timeScale)),
        MAX_CANVAS_CSS_WIDTH_PX,
      ),
    );
    canvas.width = Math.round(cssWidth * devicePixelRatioValue);
    canvas.height = Math.round(laneHeight * devicePixelRatioValue);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${laneHeight}px`;
    context.setTransform(
      devicePixelRatioValue,
      0,
      0,
      devicePixelRatioValue,
      0,
      0,
    );
    context.clearRect(0, 0, cssWidth, laneHeight);

    // The musical grid (bars strongest, then beats, then subdivisions).
    context.lineWidth = 1;
    for (const line of gridLines) {
      if (line.t <= 0 || line.t >= durationSec) continue;
      const x = Math.round(timeToPixel(line.t, timeScale));
      context.strokeStyle = GRID_COLORS[line.strength];
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, laneHeight);
      context.stroke();
    }

    // The lane's own horizontal grid (Q-F2 A), labelled with note names on a
    // pitch grid wherever a label has room.
    const valueGrid = curve.valueGrid;
    if (valueGrid?.show === true) {
      const lines = buildValueLines(
        valueGrid,
        valueRange.min,
        valueRange.max,
        laneHeight,
      );
      let lastLabelY = Infinity;
      context.font = '10px system-ui, sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'bottom';
      for (const line of lines) {
        const y = Math.round(valueToY(line.v, valueRange, laneHeight));
        context.strokeStyle = line.strength === 1 ? '#3b3651' : '#2a2833';
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(cssWidth, y + 0.5);
        context.stroke();
        if (line.label !== undefined && lastLabelY - y >= 12) {
          context.fillStyle = line.strength === 1 ? '#9a8fd0' : '#6f6a86';
          context.fillText(line.label, 4, y - 1);
          lastLabelY = y;
        }
      }
    }

    if (isBars && curve.points.length > 0) {
      // One bar per held segment, from the lane floor up to its value, with
      // a bright top edge — the part you drag.
      const floorY = laneHeight;
      const points = curve.points;
      for (let index = -1; index < points.length; index += 1) {
        const start = index === -1 ? 0 : points[index].t;
        const end =
          index + 1 < points.length ? points[index + 1].t : durationSec;
        if (end <= start) continue;
        const value = points[Math.max(index, 0)].v;
        const x0 = timeToPixel(start, timeScale);
        const x1 = Math.min(timeToPixel(end, timeScale), cssWidth);
        const width = Math.max(1, x1 - x0 - 1);
        const topY = pinnedHandleY(value);
        context.globalAlpha = 0.32;
        context.fillStyle = curve.color;
        context.fillRect(x0 + 0.5, topY, width, floorY - topY);
        context.globalAlpha = 1;
        context.fillRect(x0 + 0.5, topY - 1, width, 3);
      }
    } else if (curve.points.length === 0) {
      // Empty curve: dashed line at defaultValue.
      const y = valueToY(curve.defaultValue, valueRange, laneHeight);
      context.strokeStyle = curve.color;
      context.setLineDash([4, 4]);
      context.globalAlpha = 0.5;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(cssWidth, y);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
    } else {
      // Sampled polyline (evaluate() is the single source of shape truth).
      context.strokeStyle = curve.color;
      context.lineWidth = 2;
      context.lineJoin = 'round';
      context.beginPath();
      for (let x = 0; x <= cssWidth; x += 2) {
        const value = evaluateCurve(curve, pixelToTime(x, timeScale));
        const y = valueToY(value, valueRange, laneHeight);
        if (x === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.stroke();

      for (const [pointIndex, point] of curve.points.entries()) {
        const x = timeToPixel(point.t, timeScale);
        const rawY = valueToY(point.v, valueRange, laneHeight);
        const y = pinnedHandleY(point.v);
        const isOffRange = y !== rawY;
        context.fillStyle = curve.color;
        if (isOffRange) {
          // Edge-pinned marker for a point outside the view range (UI-15).
          context.globalAlpha = 0.6;
          context.strokeStyle = curve.color;
          context.lineWidth = 2;
          context.strokeRect(x - 3.5, y - 3.5, 7, 7);
          context.globalAlpha = 1;
        } else {
          context.fillRect(x - 3.5, y - 3.5, 7, 7);
        }
        if (pointIndex === selectedPointIndex) {
          context.strokeStyle = '#e6e6e6';
          context.lineWidth = 2;
          context.strokeRect(x - 5.5, y - 5.5, 11, 11);
        }
      }
    }

    // Row separator drawn in-canvas so header (border-box) and lane rows
    // stay exactly laneHeight tall (review UI-5).
    context.strokeStyle = '#383838';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, laneHeight - 0.5);
    context.lineTo(cssWidth, laneHeight - 0.5);
    context.stroke();

    if (showWrapMismatch) {
      context.fillStyle = '#f59e0b';
      context.font = '10px system-ui, sans-serif';
      context.textAlign = 'right';
      context.fillText('⚠ wrap', cssWidth - 6, 12);
    }
    // `laneHeight` belongs here: it sizes the backing store and every y
    // coordinate. Without it the canvas kept its previous height, which is why
    // a fullscreen lane first stayed at the default size while the container
    // around it grew.
  }, [
    curve,
    durationSec,
    timeScale,
    valueRange,
    selectedPointIndex,
    showWrapMismatch,
    laneHeight,
    gridLines,
    isBars,
  ]);

  function pointerPosition(event: ReactPointerEvent<HTMLCanvasElement>): {
    x: number;
    y: number;
  } {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function hitTestPoint(x: number, y: number): number | null {
    let bestIndex: number | null = null;
    let bestDistanceSquared = Infinity;
    for (const [pointIndex, point] of curve.points.entries()) {
      const deltaX = timeToPixel(point.t, timeScale) - x;
      // Same pinning as the draw path — off-range points stay clickable at
      // the lane edge (review UI-15).
      const deltaY = pinnedHandleY(point.v) - y;
      if (
        Math.abs(deltaX) <= POINT_HIT_RADIUS_PX &&
        Math.abs(deltaY) <= POINT_HIT_RADIUS_PX
      ) {
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;
        if (distanceSquared < bestDistanceSquared) {
          bestDistanceSquared = distanceSquared;
          bestIndex = pointIndex;
        }
      }
    }
    return bestIndex;
  }

  /** The grid-snapped time, unless snapping is off or Alt is held. */
  function snapped(
    timeSeconds: number,
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): number {
    return snapTime === undefined || event.altKey
      ? timeSeconds
      : snapTime(timeSeconds);
  }

  /** The value under `y`, kept inside the view and — while the lane's grid
   *  snaps, unless Alt is held — pulled onto the nearest line. */
  function clampedValueAt(
    y: number,
    event?: ReactPointerEvent<HTMLCanvasElement>,
  ): number {
    const raw = yToValue(y, valueRange, laneHeight);
    const value = Math.min(Math.max(raw, valueRange.min), valueRange.max);
    const grid = curve.valueGrid;
    if (grid === undefined || !grid.snap || event?.altKey === true)
      return value;
    return snapValue(value, grid);
  }

  return (
    <div
      className="rbnt:relative rbnt:box-border"
      style={{ height: laneHeight }}
    >
      <canvas
        ref={canvasRef}
        className={
          mode === 'pan'
            ? 'rbnt:block rbnt:cursor-grab rbnt:touch-none rbnt:bg-tl-lane-bg rbnt:active:cursor-grabbing'
            : 'rbnt:block rbnt:cursor-crosshair rbnt:touch-none rbnt:bg-tl-lane-bg'
        }
        role="img"
        aria-label={
          isBars
            ? `Bars lane: ${curve.name || '(unnamed)'} — ${curve.points.length} bars`
            : `Curve lane: ${curve.name || '(unnamed)'} — ${curve.points.length} points`
        }
        onPointerDown={(event) => {
          // In pan mode the lane owns no gesture: the event bubbles to the
          // scroll container, which drags the view through time.
          if (mode === 'pan' || event.button !== 0) {
            return;
          }
          const { x, y } = pointerPosition(event);
          if (isBars) {
            paintingRef.current = true;
            onPaintBar(pixelToTime(x, timeScale), clampedValueAt(y, event));
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }
          const hitIndex = hitTestPoint(x, y);
          if (hitIndex !== null) {
            dragPointIndexRef.current = hitIndex;
            onSelectPoint(hitIndex);
          } else {
            const timeSeconds = Math.min(
              Math.max(snapped(pixelToTime(x, timeScale), event), 0),
              durationSec,
            );
            dragPointIndexRef.current = onAddPoint(
              timeSeconds,
              clampedValueAt(y, event),
            );
          }
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (mode === 'pan') return;
          if (paintingRef.current) {
            const { x, y } = pointerPosition(event);
            onPaintBar(pixelToTime(x, timeScale), clampedValueAt(y, event));
            return;
          }
          if (dragPointIndexRef.current === null) {
            return;
          }
          const { x, y } = pointerPosition(event);
          onMovePoint(
            dragPointIndexRef.current,
            snapped(pixelToTime(x, timeScale), event),
            clampedValueAt(y, event),
          );
        }}
        onPointerUp={(event) => {
          dragPointIndexRef.current = null;
          paintingRef.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragPointIndexRef.current = null;
          paintingRef.current = false;
        }}
      />
    </div>
  );
}
