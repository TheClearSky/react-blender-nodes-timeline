/**
 * Pure view math for the editor (plan §6): px-per-second time scale with
 * the §8 clamp [10, 2000], fit-to-view, time↔pixel mapping, and per-lane
 * value↔y mapping with auto-fit ranges (y-range is a VIEW property —
 * Q-TL-5 keeps document values absolute). The ruler and grid are musical:
 * see tempo.ts and gridLines.ts.
 */
import type { TimelineCurve } from '../../model/types';

export const MIN_TIME_SCALE_PX_PER_SECOND = 10;
export const MAX_TIME_SCALE_PX_PER_SECOND = 2000;
/** Default lane height. Was 110; the user asked for 1.5x (2026-09-18).
 *  A lane can be taller still — fullscreen passes its own height. */
export const LANE_HEIGHT_PX = 165;
export const RULER_HEIGHT_PX = 30;

export function clampTimeScale(pxPerSecond: number): number {
  return Math.min(
    Math.max(pxPerSecond, MIN_TIME_SCALE_PX_PER_SECOND),
    MAX_TIME_SCALE_PX_PER_SECOND,
  );
}

export function fitTimeScale(
  containerWidthPx: number,
  durationSec: number,
): number {
  if (!(durationSec > 0) || !(containerWidthPx > 0)) {
    return MIN_TIME_SCALE_PX_PER_SECOND;
  }
  return clampTimeScale(containerWidthPx / durationSec);
}

export function timeToPixel(timeSeconds: number, pxPerSecond: number): number {
  return timeSeconds * pxPerSecond;
}

export function pixelToTime(pixelX: number, pxPerSecond: number): number {
  return pixelX / pxPerSecond;
}

export type LaneValueRange = {
  readonly min: number;
  readonly max: number;
};

/**
 * Auto-fit range: padded 10% beyond the point extremes; a flat or empty
 * curve gets ±1 around its value so it stays visible and draggable.
 */
export function autoValueRange(curve: TimelineCurve): LaneValueRange {
  if (curve.points.length === 0) {
    return { min: curve.defaultValue - 1, max: curve.defaultValue + 1 };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const point of curve.points) {
    min = Math.min(min, point.v);
    max = Math.max(max, point.v);
  }
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  const padding = (max - min) * 0.1;
  return { min: min - padding, max: max + padding };
}

export function valueToY(
  value: number,
  range: LaneValueRange,
  laneHeightPx: number,
): number {
  const span = range.max - range.min;
  if (!(span > 0)) {
    return laneHeightPx / 2;
  }
  return laneHeightPx - ((value - range.min) / span) * laneHeightPx;
}

export function yToValue(
  yPx: number,
  range: LaneValueRange,
  laneHeightPx: number,
): number {
  const span = range.max - range.min;
  if (!(span > 0)) {
    return range.min;
  }
  return range.min + ((laneHeightPx - yPx) / laneHeightPx) * span;
}
