/**
 * Pure document-edit helpers (plan §6/§8): every editor interaction maps to
 * one of these, each returning a NEW TimelineDocument that keeps the schema
 * invariants — strictly increasing t with min Δ 1 ms, t within
 * [0, durationSec], unique curve ids, durationSec ≥ every last point
 * (refuse-shrink, review EM-22.5). The editor calls
 * store.setDocument(next) + transport.notifyDocumentChanged() with the
 * results.
 */
import { MIN_POINT_DELTA_SECONDS } from '../../model/types';
import type {
  CurvePoint,
  SideInterp,
  TimelineCurve,
  TimelineDocument,
} from '../../model/types';

export const MIN_DURATION_SECONDS = 0.1;
/** Matches the schema ceiling — see timelineDocumentSchema (review UI-3). */
export const MAX_DURATION_SECONDS = 3600;

const CURVE_COLOR_PALETTE = [
  '#f59e0b',
  '#22d3ee',
  '#a3e635',
  '#f472b6',
  '#c084fc',
  '#fb7185',
  '#34d399',
  '#fbbf24',
] as const;

function replaceCurve(
  document: TimelineDocument,
  curveId: string,
  replace: (curve: TimelineCurve) => TimelineCurve,
): TimelineDocument {
  return {
    ...document,
    curves: document.curves.map((curve) =>
      curve.id === curveId ? replace(curve) : curve,
    ),
  };
}

/** Largest last-point time across all curves (0 when there are no points). */
export function lastPointTime(document: TimelineDocument): number {
  let last = 0;
  for (const curve of document.curves) {
    const lastPoint = curve.points[curve.points.length - 1];
    if (lastPoint !== undefined) {
      last = Math.max(last, lastPoint.t);
    }
  }
  return last;
}

export function addCurve(document: TimelineDocument): {
  document: TimelineDocument;
  curveId: string;
} {
  // Mint ABOVE every numeric id ever present, not just the live ones — id
  // reuse after a delete would silently re-bind stale node references and
  // stale y-range overrides to an unrelated new curve (review UI-7).
  let maxOrdinal = document.curves.length;
  for (const curve of document.curves) {
    const match = /^crv_(\d+)$/.exec(curve.id);
    if (match !== null) {
      maxOrdinal = Math.max(maxOrdinal, Number(match[1]));
    }
  }
  const ordinal = maxOrdinal + 1;
  const curveId = `crv_${ordinal}`;
  const usedColors = new Set(document.curves.map((curve) => curve.color));
  const color =
    CURVE_COLOR_PALETTE.find((candidate) => !usedColors.has(candidate)) ??
    CURVE_COLOR_PALETTE[document.curves.length % CURVE_COLOR_PALETTE.length];
  const nextCurve: TimelineCurve = {
    id: curveId,
    name: `curve ${ordinal}`,
    color,
    defaultValue: 0,
    points: [],
  };
  return {
    document: { ...document, curves: [...document.curves, nextCurve] },
    curveId,
  };
}

export function deleteCurve(
  document: TimelineDocument,
  curveId: string,
): TimelineDocument {
  return {
    ...document,
    curves: document.curves.filter((curve) => curve.id !== curveId),
  };
}

export function renameCurve(
  document: TimelineDocument,
  curveId: string,
  name: string,
): TimelineDocument {
  return replaceCurve(document, curveId, (curve) => ({ ...curve, name }));
}

export function recolorCurve(
  document: TimelineDocument,
  curveId: string,
  color: string,
): TimelineDocument {
  return replaceCurve(document, curveId, (curve) => ({ ...curve, color }));
}

/**
 * Insert a point at (t, v). t is clamped into [0, durationSec] and nudged
 * to keep ≥ 1 ms from both neighbors; if the surrounding gap is too tight
 * to fit a new point, returns null (no change).
 */
export function addPoint(
  document: TimelineDocument,
  curveId: string,
  timeSeconds: number,
  value: number,
): { document: TimelineDocument; pointIndex: number } | null {
  const curve = document.curves.find((candidate) => candidate.id === curveId);
  if (
    curve === undefined ||
    !Number.isFinite(value) ||
    !Number.isFinite(timeSeconds)
  ) {
    return null;
  }
  let insertTime = Math.min(Math.max(timeSeconds, 0), document.durationSec);
  let insertIndex = curve.points.findIndex((point) => point.t > insertTime);
  if (insertIndex === -1) {
    insertIndex = curve.points.length;
  }
  const previousPoint = curve.points[insertIndex - 1];
  const nextPoint = curve.points[insertIndex];
  const lowerBound =
    previousPoint === undefined ? 0 : previousPoint.t + MIN_POINT_DELTA_SECONDS;
  const upperBound =
    nextPoint === undefined
      ? document.durationSec
      : nextPoint.t - MIN_POINT_DELTA_SECONDS;
  if (lowerBound > upperBound) {
    return null;
  }
  insertTime = Math.min(Math.max(insertTime, lowerBound), upperBound);
  const nextPoints: CurvePoint[] = [
    ...curve.points.slice(0, insertIndex),
    { t: insertTime, v: value, leftInterp: 'linear', rightInterp: 'linear' },
    ...curve.points.slice(insertIndex),
  ];
  return {
    document: replaceCurve(document, curveId, (target) => ({
      ...target,
      points: nextPoints,
    })),
    pointIndex: insertIndex,
  };
}

/**
 * Move a point to (t, v); t clamps between its neighbors (± 1 ms) and into
 * [0, durationSec] — points never reorder by dragging.
 */
export function movePoint(
  document: TimelineDocument,
  curveId: string,
  pointIndex: number,
  timeSeconds: number,
  value: number,
): TimelineDocument {
  const curve = document.curves.find((candidate) => candidate.id === curveId);
  const point = curve?.points[pointIndex];
  if (
    curve === undefined ||
    point === undefined ||
    !Number.isFinite(value) ||
    !Number.isFinite(timeSeconds)
  ) {
    return document;
  }
  const previousPoint = curve.points[pointIndex - 1];
  const nextPoint = curve.points[pointIndex + 1];
  const lowerBound = Math.max(
    0,
    previousPoint === undefined ? 0 : previousPoint.t + MIN_POINT_DELTA_SECONDS,
  );
  const upperBound = Math.min(
    document.durationSec,
    nextPoint === undefined
      ? document.durationSec
      : nextPoint.t - MIN_POINT_DELTA_SECONDS,
  );
  const clampedTime =
    lowerBound > upperBound
      ? point.t
      : Math.min(Math.max(timeSeconds, lowerBound), upperBound);
  return replaceCurve(document, curveId, (target) => ({
    ...target,
    points: target.points.map((candidate, index) =>
      index === pointIndex
        ? { ...candidate, t: clampedTime, v: value }
        : candidate,
    ),
  }));
}

export function deletePoint(
  document: TimelineDocument,
  curveId: string,
  pointIndex: number,
): TimelineDocument {
  return replaceCurve(document, curveId, (curve) => ({
    ...curve,
    points: curve.points.filter((_, index) => index !== pointIndex),
  }));
}

export function setPointInterp(
  document: TimelineDocument,
  curveId: string,
  pointIndex: number,
  side: 'left' | 'right',
  interp: SideInterp,
): TimelineDocument {
  return replaceCurve(document, curveId, (curve) => ({
    ...curve,
    points: curve.points.map((point, index) =>
      index === pointIndex
        ? side === 'left'
          ? { ...point, leftInterp: interp }
          : { ...point, rightInterp: interp }
        : point,
    ),
  }));
}

/**
 * Duration edits REFUSE to shrink below the last point (review EM-22.5) and
 * floor at MIN_DURATION_SECONDS.
 */
export function setDuration(
  document: TimelineDocument,
  requestedDurationSec: number,
): TimelineDocument {
  if (!Number.isFinite(requestedDurationSec)) {
    return document;
  }
  // Ceiling first (UI-3), then never below the last point (EM-22.5) or the
  // floor — points always win over the ceiling.
  const durationSec = Math.max(
    Math.min(requestedDurationSec, MAX_DURATION_SECONDS),
    lastPointTime(document),
    MIN_DURATION_SECONDS,
  );
  return { ...document, durationSec };
}

export function toggleLoop(document: TimelineDocument): TimelineDocument {
  return { ...document, loop: !document.loop };
}

/** §8: loop wrap is audibly discontinuous when first and last values differ. */
export function hasWrapMismatch(
  document: TimelineDocument,
  curve: TimelineCurve,
): boolean {
  if (!document.loop || curve.points.length < 2) {
    return false;
  }
  return curve.points[0].v !== curve.points[curve.points.length - 1].v;
}
