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
  /**
   * How the lane shows the curve. `bars` = MIDI-style step bars, one per
   * grid cell (every point a step), dragged up and down. Absent = `curve`.
   */
  readonly display?: CurveDisplay;
  /** Horizontal grid for this lane — lines at values, optionally snapped to.
   *  Absent = none (plan timeline-grid-finder.md, Q-F2 A). */
  readonly valueGrid?: ValueGrid;
};

/**
 * A lane's horizontal grid: evenly spaced values (`linear`: origin + k·step),
 * or musical notes (`pitch`: 12-tone equal temperament around `a4` Hz — for
 * lanes whose values are frequencies). `show` draws it; `snap` pulls edited
 * values onto it.
 */
export type ValueGrid =
  | {
      readonly kind: 'linear';
      readonly step: number;
      readonly origin: number;
      readonly show: boolean;
      readonly snap: boolean;
    }
  | {
      readonly kind: 'pitch';
      readonly a4: number;
      readonly show: boolean;
      readonly snap: boolean;
    };

export const curveDisplays = ['curve', 'bars'] as const;
export type CurveDisplay = (typeof curveDisplays)[number];

/**
 * Musical time. Point times stay in SECONDS (the transport never sees a
 * beat); the tempo draws the grid and the bars·beats ruler. A tempo change
 * with the duration UNLOCKED rescales every time (same beats, faster or
 * slower); LOCKED it moves only the grid (ruling Q-M2 A).
 */
export type TimelineTempo = {
  readonly bpm: number;
  /** Beats in one bar; a beat is a quarter note. */
  readonly beatsPerBar: number;
  /** Where the grid starts, in seconds (bar 1, beat 1). Absent = 0. Music
   *  that does not begin on a downbeat at 0 s lines up through this. */
  readonly offsetSec?: number;
};

export const DEFAULT_TEMPO: TimelineTempo = { bpm: 120, beatsPerBar: 4 };
export const MIN_BPM = 20;
export const MAX_BPM = 400;
export const MAX_BEATS_PER_BAR = 16;

export type TimelineDocument = {
  readonly version: 1;
  /** Total length in seconds; always ≥ every curve's last point t. */
  readonly durationSec: number;
  readonly loop: boolean;
  readonly curves: readonly TimelineCurve[];
  /** Absent = DEFAULT_TEMPO (120 BPM, 4/4). */
  readonly tempo?: TimelineTempo;
  /** Locked: a tempo change keeps every time (and the duration) in seconds
   *  and moves only the grid. Absent = unlocked. */
  readonly lockDuration?: boolean;
};
