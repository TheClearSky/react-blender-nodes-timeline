/**
 * Pure document-edit helpers (plan §6/§8): every editor interaction maps to
 * one of these, each returning a NEW TimelineDocument that keeps the schema
 * invariants — strictly increasing t with min Δ 1 ms, t within
 * [0, durationSec], unique curve ids, durationSec ≥ every last point
 * (refuse-shrink, review EM-22.5). The editor calls
 * store.setDocument(next) + transport.notifyDocumentChanged() with the
 * results.
 */
import { evaluateCurve } from '../../model/evaluate';
import {
  DEFAULT_TEMPO,
  MAX_BEATS_PER_BAR,
  MAX_BPM,
  MIN_BPM,
  MIN_POINT_DELTA_SECONDS,
} from '../../model/types';
import type {
  CurveDisplay,
  CurvePoint,
  SideInterp,
  TimelineCurve,
  TimelineDocument,
  ValueGrid,
} from '../../model/types';
import { cellStarts } from './tempo';

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

// ── tempo (plan timeline-midi-mode.md, Q-M2 A) ──────────────────────────

/** Why a tempo edit was refused — shown to the user as is. */
export type TempoRefusal = { readonly refused: string };

/**
 * Change the BPM.
 *
 * - LOCKED duration: only the tempo changes. Every point and the duration
 *   keep their seconds, so the sound is identical; the grid moves.
 * - UNLOCKED: the music keeps its BEATS — every time and the duration are
 *   multiplied by old/new — so it plays faster or slower.
 *
 * Refused (nothing changes) when the rescale would break the document: two
 * points closer than 1 ms, or a duration outside the editor's limits.
 */
export function setTempoBpm(
  document: TimelineDocument,
  requestedBpm: number,
): TimelineDocument | TempoRefusal {
  if (!Number.isFinite(requestedBpm)) return document;
  const bpm = Math.min(
    Math.max(Math.round(requestedBpm * 10) / 10, MIN_BPM),
    MAX_BPM,
  );
  const tempo = document.tempo ?? DEFAULT_TEMPO;
  if (bpm === tempo.bpm) return document;
  const nextTempo = { ...tempo, bpm };
  if (document.lockDuration === true) {
    return { ...document, tempo: nextTempo };
  }
  const factor = tempo.bpm / bpm;
  const durationSec = document.durationSec * factor;
  if (durationSec > MAX_DURATION_SECONDS) {
    return {
      refused: `At ${bpm} BPM the timeline would last ${Math.round(durationSec)} s — longer than the ${MAX_DURATION_SECONDS} s limit. Lock the duration to change only the grid.`,
    };
  }
  if (durationSec < MIN_DURATION_SECONDS) {
    return {
      refused: `At ${bpm} BPM the timeline would be shorter than ${MIN_DURATION_SECONDS} s.`,
    };
  }
  for (const curve of document.curves) {
    for (let index = 1; index < curve.points.length; index += 1) {
      const gap = (curve.points[index].t - curve.points[index - 1].t) * factor;
      if (gap < MIN_POINT_DELTA_SECONDS) {
        return {
          refused: `At ${bpm} BPM two points of "${curve.name}" would be closer than 1 ms.`,
        };
      }
    }
  }
  return {
    ...document,
    // The grid's start moves with the music it marks.
    tempo:
      tempo.offsetSec === undefined
        ? nextTempo
        : { ...nextTempo, offsetSec: tempo.offsetSec * factor },
    durationSec,
    curves: document.curves.map((curve) => ({
      ...curve,
      points: curve.points.map((point) => ({ ...point, t: point.t * factor })),
    })),
  };
}

export function isTempoRefusal(
  result: TimelineDocument | TempoRefusal,
): result is TempoRefusal {
  return 'refused' in result;
}

/** Beats in a bar — only the grid and the ruler change. */
export function setBeatsPerBar(
  document: TimelineDocument,
  requested: number,
): TimelineDocument {
  if (!Number.isFinite(requested)) return document;
  const beatsPerBar = Math.min(
    Math.max(Math.round(requested), 1),
    MAX_BEATS_PER_BAR,
  );
  const tempo = document.tempo ?? DEFAULT_TEMPO;
  if (beatsPerBar === tempo.beatsPerBar) return document;
  return { ...document, tempo: { ...tempo, beatsPerBar } };
}

export function setLockDuration(
  document: TimelineDocument,
  lockDuration: boolean,
): TimelineDocument {
  return { ...document, lockDuration };
}

// ── bars (plan timeline-midi-mode.md, Q-M1 A) ───────────────────────────

/** More cells than this and a lane is not a bar editor any more. */
export const MAX_BAR_CELLS = 2048;

/** True when every segment holds its value (so bars show it faithfully). */
export function isAllSteps(curve: TimelineCurve): boolean {
  return curve.points.every(
    (point, index) =>
      index === curve.points.length - 1 || point.rightInterp === 'step',
  );
}

export function setCurveDisplay(
  document: TimelineDocument,
  curveId: string,
  display: CurveDisplay,
): TimelineDocument {
  return replaceCurve(document, curveId, (curve) => ({ ...curve, display }));
}

/**
 * Show a curve as bars. An all-step curve keeps its points; any other curve
 * is RESAMPLED to one step per grid cell (its value at the cell start) — the
 * caller asks first, because the smooth shape is replaced. Returns null when
 * the grid would make more than MAX_BAR_CELLS cells.
 */
export function convertCurveToBars(
  document: TimelineDocument,
  curveId: string,
  cellSec: number,
  originSec = 0,
): TimelineDocument | null {
  const curve = document.curves.find((candidate) => candidate.id === curveId);
  if (curve === undefined || !(cellSec > 0)) return null;
  if (isAllSteps(curve)) {
    return setCurveDisplay(document, curveId, 'bars');
  }
  if (document.durationSec / cellSec > MAX_BAR_CELLS) return null;
  const points: CurvePoint[] = cellStarts(
    document.durationSec,
    cellSec,
    originSec,
    MIN_POINT_DELTA_SECONDS,
  ).map((t) => ({
    t,
    v: evaluateCurve(curve, t),
    leftInterp: 'step',
    rightInterp: 'step',
  }));
  return replaceCurve(document, curveId, (target) => ({
    ...target,
    points,
    display: 'bars',
  }));
}

/**
 * Set the bar under `timeSeconds` to `value`: the grid cell containing it
 * holds `value` from its start to its end, and what came after the cell is
 * kept (a point at the cell's end carries the old value on). Points inside
 * the cell — left by a finer grid — are absorbed.
 */
export function setBarValue(
  document: TimelineDocument,
  curveId: string,
  timeSeconds: number,
  value: number,
  cellSec: number,
  originSec = 0,
): TimelineDocument {
  const curve = document.curves.find((candidate) => candidate.id === curveId);
  if (
    curve === undefined ||
    !(cellSec > 0) ||
    !Number.isFinite(value) ||
    !Number.isFinite(timeSeconds)
  ) {
    return document;
  }
  const duration = document.durationSec;
  const time = Math.min(Math.max(timeSeconds, 0), duration);
  // Cells run from the grid origin; before it, a partial cell starts at 0.
  let cellIndex = Math.floor((time - originSec) / cellSec + 1e-9);
  if (originSec + cellIndex * cellSec >= duration - MIN_POINT_DELTA_SECONDS) {
    cellIndex -= 1;
  }
  const cellStart = Math.max(0, originSec + cellIndex * cellSec);
  const cellEnd = Math.min(originSec + (cellIndex + 1) * cellSec, duration);
  const gap = MIN_POINT_DELTA_SECONDS;
  const before = curve.points.filter((point) => point.t <= cellStart - gap);
  // Never within 1 ms of the new cell-start point, even in a sliver of a
  // last cell.
  const after = curve.points.filter(
    (point) => point.t >= Math.max(cellEnd - gap, cellStart + gap),
  );
  const points: CurvePoint[] = [
    ...before,
    { t: cellStart, v: value, leftInterp: 'step', rightInterp: 'step' },
  ];
  const nextAfter = after[0];
  const endsAtDuration = cellEnd >= duration - gap;
  if (
    !endsAtDuration &&
    (nextAfter === undefined || nextAfter.t > cellEnd + gap)
  ) {
    // Keep what played after this cell.
    points.push({
      t: cellEnd,
      v: evaluateCurve(curve, cellEnd),
      leftInterp: 'step',
      rightInterp: 'step',
    });
  }
  points.push(...after);
  return replaceCurve(document, curveId, (target) => ({ ...target, points }));
}

// ── grid finder results (plan timeline-grid-finder.md) ──────────────────

/**
 * Apply a found tempo grid. GRID ONLY: every point and the duration keep
 * their seconds whatever the lock says — the music is the reference the grid
 * was fitted to (ruling Q-F1 A).
 */
export function setTempoGrid(
  document: TimelineDocument,
  grid: { bpm: number; beatsPerBar: number; offsetSec: number },
): TimelineDocument {
  const bpm = Math.min(Math.max(grid.bpm, MIN_BPM), MAX_BPM);
  const beatsPerBar = Math.min(
    Math.max(Math.round(grid.beatsPerBar), 1),
    MAX_BEATS_PER_BAR,
  );
  const offsetSec = Math.max(0, grid.offsetSec);
  return {
    ...document,
    tempo:
      offsetSec > 0 ? { bpm, beatsPerBar, offsetSec } : { bpm, beatsPerBar },
  };
}

/** Set (or clear, with `undefined`) a lane's horizontal grid. */
export function setValueGrid(
  document: TimelineDocument,
  curveId: string,
  valueGrid: ValueGrid | undefined,
): TimelineDocument {
  return replaceCurve(document, curveId, (curve) => {
    if (valueGrid !== undefined) return { ...curve, valueGrid };
    const { valueGrid: _dropped, ...rest } = curve;
    return rest;
  });
}
