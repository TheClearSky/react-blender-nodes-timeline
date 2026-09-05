import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { evaluateCurve } from '../../model/evaluate';
import type { TimelineCurve } from '../../model/types';
import {
  LANE_HEIGHT_PX,
  pixelToTime,
  rulerStepSeconds,
  timeToPixel,
  valueToY,
  yToValue,
  type LaneValueRange,
} from './timelineView';

export type CurveLaneProps = {
  curve: TimelineCurve;
  durationSec: number;
  timeScale: number;
  valueRange: LaneValueRange;
  showWrapMismatch: boolean;
  selectedPointIndex: number | null;
  onSelectPoint(pointIndex: number): void;
  /** Returns the new point's index so the press can keep dragging it. */
  onAddPoint(timeSeconds: number, value: number): number | null;
  onMovePoint(pointIndex: number, timeSeconds: number, value: number): void;
};

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
  valueRange,
  showWrapMismatch,
  selectedPointIndex,
  onSelectPoint,
  onAddPoint,
  onMovePoint,
}: CurveLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragPointIndexRef = useRef<number | null>(null);

  // Any structural change (delete mid-drag, external replace) invalidates
  // the dragged INDEX — cancel the drag instead of retargeting a neighbor
  // (review UI-9).
  useEffect(() => {
    dragPointIndexRef.current = null;
  }, [curve.points.length]);

  function pinnedHandleY(value: number): number {
    const rawY = valueToY(value, valueRange, LANE_HEIGHT_PX);
    return Math.min(
      Math.max(rawY, EDGE_PIN_MARGIN_PX),
      LANE_HEIGHT_PX - EDGE_PIN_MARGIN_PX,
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
    canvas.height = Math.round(LANE_HEIGHT_PX * devicePixelRatioValue);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${LANE_HEIGHT_PX}px`;
    context.setTransform(
      devicePixelRatioValue,
      0,
      0,
      devicePixelRatioValue,
      0,
      0,
    );
    context.clearRect(0, 0, cssWidth, LANE_HEIGHT_PX);

    // Vertical grid at the ruler step.
    const stepSeconds = rulerStepSeconds(timeScale);
    context.strokeStyle = '#2e2e2e';
    context.lineWidth = 1;
    for (
      let tickIndex = 1;
      tickIndex * stepSeconds < durationSec;
      tickIndex += 1
    ) {
      const x = Math.round(timeToPixel(tickIndex * stepSeconds, timeScale));
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, LANE_HEIGHT_PX);
      context.stroke();
    }

    if (curve.points.length === 0) {
      // Empty curve: dashed line at defaultValue.
      const y = valueToY(curve.defaultValue, valueRange, LANE_HEIGHT_PX);
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
        const y = valueToY(value, valueRange, LANE_HEIGHT_PX);
        if (x === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.stroke();

      for (const [pointIndex, point] of curve.points.entries()) {
        const x = timeToPixel(point.t, timeScale);
        const rawY = valueToY(point.v, valueRange, LANE_HEIGHT_PX);
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
    // stay exactly LANE_HEIGHT_PX tall (review UI-5).
    context.strokeStyle = '#383838';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, LANE_HEIGHT_PX - 0.5);
    context.lineTo(cssWidth, LANE_HEIGHT_PX - 0.5);
    context.stroke();

    if (showWrapMismatch) {
      context.fillStyle = '#f59e0b';
      context.font = '10px system-ui, sans-serif';
      context.textAlign = 'right';
      context.fillText('⚠ wrap', cssWidth - 6, 12);
    }
  }, [
    curve,
    durationSec,
    timeScale,
    valueRange,
    selectedPointIndex,
    showWrapMismatch,
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

  function clampedValueAt(y: number): number {
    const value = yToValue(y, valueRange, LANE_HEIGHT_PX);
    return Math.min(Math.max(value, valueRange.min), valueRange.max);
  }

  return (
    <div className="rbnt-tl-lane" style={{ height: LANE_HEIGHT_PX }}>
      <canvas
        ref={canvasRef}
        className="rbnt-tl-lane-canvas"
        role="img"
        aria-label={`Curve lane: ${curve.name || '(unnamed)'} — ${curve.points.length} points`}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          const { x, y } = pointerPosition(event);
          const hitIndex = hitTestPoint(x, y);
          if (hitIndex !== null) {
            dragPointIndexRef.current = hitIndex;
            onSelectPoint(hitIndex);
          } else {
            const timeSeconds = Math.min(
              Math.max(pixelToTime(x, timeScale), 0),
              durationSec,
            );
            dragPointIndexRef.current = onAddPoint(
              timeSeconds,
              clampedValueAt(y),
            );
          }
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragPointIndexRef.current === null) {
            return;
          }
          const { x, y } = pointerPosition(event);
          onMovePoint(
            dragPointIndexRef.current,
            pixelToTime(x, timeScale),
            clampedValueAt(y),
          );
        }}
        onPointerUp={(event) => {
          dragPointIndexRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragPointIndexRef.current = null;
        }}
      />
    </div>
  );
}
