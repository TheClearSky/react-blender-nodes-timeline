/**
 * Interpolation math (plan §4). Each non-step segment K1→K2 is a cubic
 * bezier in normalized segment space (u ∈ [0,1], P0=(0,0), P3=(1,1)); the
 * start point's RIGHT side supplies P1, the end point's LEFT side supplies
 * P2. Pinned by the §4 oracles: linear reduces exactly to the straight
 * line; the ease/linear mixed segment passes through (0.5325, 0.375) at
 * u=0.5.
 */
import type { CurvePoint, SideInterp, TimelineCurve } from './types';

export type BezierControlPoint = { readonly x: number; readonly y: number };

type CurvedSideInterp = Exclude<SideInterp, 'step'>;

// Preset → control point (plan §4). 'step' never reaches the bezier path —
// it overrides the whole segment to a hold. 'ease' = CSS ease-in-out
// (0.42,0 / 0.58,1); CSS "ease" proper is a different curve (review EM-24).
const controlPoint1BySide: Record<CurvedSideInterp, BezierControlPoint> = {
  linear: { x: 1 / 3, y: 1 / 3 },
  ease: { x: 0.42, y: 0 },
};
const controlPoint2BySide: Record<CurvedSideInterp, BezierControlPoint> = {
  linear: { x: 2 / 3, y: 2 / 3 },
  ease: { x: 0.58, y: 1 },
};

/**
 * Bisection interval width at which the solver stops — far tighter than the
 * plan's 1e−6 x-tolerance so value pins hold to ~1e−6 even on steep
 * segments.
 */
export const BEZIER_SOLVER_INTERVAL = 1e-9;
const BEZIER_SOLVER_MAX_ITERATIONS = 64;

/** Cubic bezier with implicit P0=(0,0) and P3=(1,1), sampled at parameter u. */
export function bezierPoint(
  controlPoint1: BezierControlPoint,
  controlPoint2: BezierControlPoint,
  bezierParameter: number,
): { x: number; y: number } {
  const oneMinus = 1 - bezierParameter;
  const basis1 = 3 * oneMinus * oneMinus * bezierParameter;
  const basis2 = 3 * oneMinus * bezierParameter * bezierParameter;
  const basis3 = bezierParameter * bezierParameter * bezierParameter;
  return {
    x: basis1 * controlPoint1.x + basis2 * controlPoint2.x + basis3,
    y: basis1 * controlPoint1.y + basis2 * controlPoint2.y + basis3,
  };
}

/**
 * Solve u for x(u) = xTarget by bisection. x(u) is monotone non-decreasing
 * whenever both control x-coordinates stay inside [0,1] — the preset table
 * guarantees that, and the future draggable-handle UI must clamp handle x
 * the same way or this solver breaks (review EM-24).
 */
export function solveBezierU(
  controlPoint1X: number,
  controlPoint2X: number,
  xTarget: number,
): number {
  if (xTarget <= 0) {
    return 0;
  }
  if (xTarget >= 1) {
    return 1;
  }
  let lowerBound = 0;
  let upperBound = 1;
  for (
    let iteration = 0;
    iteration < BEZIER_SOLVER_MAX_ITERATIONS &&
    upperBound - lowerBound > BEZIER_SOLVER_INTERVAL;
    iteration += 1
  ) {
    const midpoint = (lowerBound + upperBound) / 2;
    const oneMinus = 1 - midpoint;
    const xAtMidpoint =
      3 * oneMinus * oneMinus * midpoint * controlPoint1X +
      3 * oneMinus * midpoint * midpoint * controlPoint2X +
      midpoint * midpoint * midpoint;
    if (xAtMidpoint < xTarget) {
      lowerBound = midpoint;
    } else {
      upperBound = midpoint;
    }
  }
  return (lowerBound + upperBound) / 2;
}

/**
 * Value of the segment startPoint→endPoint at timeSeconds (plan §4). Step
 * rule: if EITHER facing side is 'step', the segment holds startPoint.v on
 * [t1, t2) and jumps at t2 — one rule, no half-steps. Callers guarantee
 * startPoint.t ≤ timeSeconds < endPoint.t.
 */
export function evaluateSegment(
  startPoint: CurvePoint,
  endPoint: CurvePoint,
  timeSeconds: number,
): number {
  if (startPoint.rightInterp === 'step' || endPoint.leftInterp === 'step') {
    return startPoint.v;
  }
  const xTarget = (timeSeconds - startPoint.t) / (endPoint.t - startPoint.t);
  const controlPoint1 = controlPoint1BySide[startPoint.rightInterp];
  const controlPoint2 = controlPoint2BySide[endPoint.leftInterp];
  const solvedParameter = solveBezierU(
    controlPoint1.x,
    controlPoint2.x,
    xTarget,
  );
  const valueFraction = bezierPoint(
    controlPoint1,
    controlPoint2,
    solvedParameter,
  ).y;
  return startPoint.v + (endPoint.v - startPoint.v) * valueFraction;
}

/**
 * Curve value at any time (plan §4 clamps): no points → defaultValue;
 * t ≤ first point → first v; t ≥ last point → last v; otherwise the
 * containing segment. Assumes points strictly increasing in t
 * (schema-enforced; the editor clamps drags the same way).
 */
export function evaluateCurve(
  curve: TimelineCurve,
  timeSeconds: number,
): number {
  const points = curve.points;
  if (points.length === 0) {
    return curve.defaultValue;
  }
  const firstPoint = points[0];
  if (timeSeconds <= firstPoint.t) {
    return firstPoint.v;
  }
  const lastPoint = points[points.length - 1];
  if (timeSeconds >= lastPoint.t) {
    return lastPoint.v;
  }
  let lowerIndex = 0;
  let upperIndex = points.length - 1;
  while (upperIndex - lowerIndex > 1) {
    const middleIndex = (lowerIndex + upperIndex) >> 1;
    if (points[middleIndex].t <= timeSeconds) {
      lowerIndex = middleIndex;
    } else {
      upperIndex = middleIndex;
    }
  }
  return evaluateSegment(points[lowerIndex], points[upperIndex], timeSeconds);
}
