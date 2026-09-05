/**
 * Timeline data model (plan §3) — a document of named multipart curves.
 * A point is a keyframe carrying its own LEFT and RIGHT interpolation, so
 * every segment's shape combines the leaving side of its start point with
 * the arriving side of its end point (plan §4).
 */

export const sideInterps = ['step', 'linear', 'ease'] as const;
export type SideInterp = (typeof sideInterps)[number];

/** Minimum spacing between neighboring points in a curve (1 ms). */
export const MIN_POINT_DELTA_SECONDS = 0.001;

export type CurvePoint = {
  /** Seconds; strictly increasing within a curve (≥ MIN_POINT_DELTA_SECONDS apart). */
  readonly t: number;
  /** Absolute value in the curve's own unit (Q-TL-5). */
  readonly v: number;
  /** Shapes the segment ARRIVING at this point. */
  readonly leftInterp: SideInterp;
  /** Shapes the segment LEAVING this point. */
  readonly rightInterp: SideInterp;
};

export type TimelineCurve = {
  /** Stable identity — nodes and drivers reference id, never name. */
  readonly id: string;
  /** Display name; rename-safe. */
  readonly name: string;
  readonly color: string;
  /** Output when the curve has no points. */
  readonly defaultValue: number;
  readonly points: readonly CurvePoint[];
};

export type TimelineDocument = {
  readonly version: 1;
  /** Total length in seconds; always ≥ every curve's last point t. */
  readonly durationSec: number;
  readonly loop: boolean;
  readonly curves: readonly TimelineCurve[];
};
