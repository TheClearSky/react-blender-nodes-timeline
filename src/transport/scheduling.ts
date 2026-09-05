/**
 * Pure scheduling core (plan §5.1): turn a curve + a document-time window
 * into an ordered event list, then apply that list onto a SchedulableParam
 * through an affine document→context time mapping. Keeping the event list
 * as DATA makes every discipline rule unit-pinnable without any audio.
 *
 * Rules encoded here (review EM-15/EM-22.1/EM-22.2 + the overlap law):
 * - ANCHOR-FIRST: the first event always lands at the window start with
 *   value curve(start) — as a `set`, or as sample[0] of a curve event that
 *   starts exactly there (a separate set at a curve event's T0 would break
 *   the overlap law).
 * - Segments: step → set(v1 @ start); pure linear → set + ramp; anything
 *   curved → ONE setValueCurveAtTime resampled over the visible part of
 *   the segment, which also realizes the partial mid-segment reschedule.
 * - TERMINAL: every pass ends with set(curve(end) @ end), so a trailing
 *   step still lands its final value and the scheduled world agrees with
 *   evaluate()'s hold-last clamp.
 * - OVERLAP LAW: a curve event [T0, T0+D) contains no other event at or
 *   after T0 and strictly before T0+D; an event exactly AT T0+D is legal.
 */
import { evaluateCurve } from '../model/evaluate';
import type { TimelineCurve } from '../model/types';
import type { SchedulableParam } from './seamTypes';

export const CURVE_SAMPLES_PER_SECOND = 200;
export const CURVE_SAMPLE_COUNT_MIN = 8;
export const CURVE_SAMPLE_COUNT_MAX = 256;

export type ScheduleEvent =
  | { readonly kind: 'set'; readonly value: number; readonly atTime: number }
  | { readonly kind: 'ramp'; readonly value: number; readonly atTime: number }
  | {
      readonly kind: 'curve';
      readonly values: Float32Array;
      readonly startTime: number;
      readonly duration: number;
    };

/** Sample count for a curved span: min(256, max(8, ceil(duration · 200))). */
export function curveSampleCount(durationSeconds: number): number {
  return Math.min(
    CURVE_SAMPLE_COUNT_MAX,
    Math.max(
      CURVE_SAMPLE_COUNT_MIN,
      Math.ceil(durationSeconds * CURVE_SAMPLES_PER_SECOND),
    ),
  );
}

function sampleCurveSpan(
  curve: TimelineCurve,
  fromTimeSeconds: number,
  toTimeSeconds: number,
): Float32Array {
  const spanSeconds = toTimeSeconds - fromTimeSeconds;
  const sampleCount = curveSampleCount(spanSeconds);
  const values = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const sampleTime =
      fromTimeSeconds + (spanSeconds * index) / (sampleCount - 1);
    values[index] = evaluateCurve(curve, sampleTime);
  }
  return values;
}

/**
 * Build the ordered event list for one pass over [fromTimeSeconds,
 * toTimeSeconds] in DOCUMENT time. The window may start or end anywhere —
 * inside a segment (partial reschedule), inside a clamp region, or on a
 * keyframe.
 */
export function buildSchedulePass(
  curve: TimelineCurve,
  fromTimeSeconds: number,
  toTimeSeconds: number,
): ScheduleEvent[] {
  if (!(toTimeSeconds > fromTimeSeconds)) {
    return [
      {
        kind: 'set',
        value: evaluateCurve(curve, fromTimeSeconds),
        atTime: fromTimeSeconds,
      },
    ];
  }

  const events: ScheduleEvent[] = [];
  const points = curve.points;
  let anchorCovered = false;

  for (
    let segmentIndex = 0;
    segmentIndex + 1 < points.length;
    segmentIndex += 1
  ) {
    const startPoint = points[segmentIndex];
    const endPoint = points[segmentIndex + 1];
    if (endPoint.t <= fromTimeSeconds || startPoint.t >= toTimeSeconds) {
      continue;
    }
    const effectiveStart = Math.max(startPoint.t, fromTimeSeconds);
    const effectiveEnd = Math.min(endPoint.t, toTimeSeconds);
    if (!(effectiveEnd > effectiveStart)) {
      continue;
    }
    const isStep =
      startPoint.rightInterp === 'step' || endPoint.leftInterp === 'step';
    const isPureLinear =
      startPoint.rightInterp === 'linear' && endPoint.leftInterp === 'linear';
    if (isStep) {
      events.push({
        kind: 'set',
        value: startPoint.v,
        atTime: effectiveStart,
      });
    } else if (isPureLinear) {
      // Exact linear interpolation — a cut ramp target must not carry
      // bezier-solver noise when the segment IS the straight line.
      const valueSlope =
        (endPoint.v - startPoint.v) / (endPoint.t - startPoint.t);
      events.push({
        kind: 'set',
        value: startPoint.v + valueSlope * (effectiveStart - startPoint.t),
        atTime: effectiveStart,
      });
      events.push({
        kind: 'ramp',
        value: startPoint.v + valueSlope * (effectiveEnd - startPoint.t),
        atTime: effectiveEnd,
      });
    } else {
      events.push({
        kind: 'curve',
        values: sampleCurveSpan(curve, effectiveStart, effectiveEnd),
        startTime: effectiveStart,
        duration: effectiveEnd - effectiveStart,
      });
    }
    if (effectiveStart === fromTimeSeconds) {
      // A set/curve landing exactly at the window start IS the anchor
      // (curve events carry curve(start) as sample[0]).
      anchorCovered = true;
    }
  }

  if (!anchorCovered) {
    events.unshift({
      kind: 'set',
      value: evaluateCurve(curve, fromTimeSeconds),
      atTime: fromTimeSeconds,
    });
  }

  events.push({
    kind: 'set',
    value: evaluateCurve(curve, toTimeSeconds),
    atTime: toTimeSeconds,
  });
  return events;
}

/**
 * Per-param write guard (review EN-1). Document times on the two sides of a
 * boundary are mapped through DIFFERENT floating-point expression trees
 * (curve end = engine's `mappedStart + duration` vs the next event's own
 * mapping), so with non-representable anchors/durations they can disagree
 * by ±1–2 ulp — and the Web Audio spec throws NotSupportedError for any
 * event landing strictly inside a curve's [T, T+D). The guard makes every
 * boundary bit-consistent by construction: it tracks the ENGINE's own
 * arithmetic for the last curve end plus the last written time, clamps
 * every subsequent time up to them, and bumps a curve start by one ulp when
 * clamping would land it exactly ON an earlier event (a curve window
 * INCLUDES its own start). Reset it after every cancelScheduledValues —
 * cancel removes in-flight curves whole, so no window survives.
 */
export type ParamWriteGuard = {
  lastWrittenContextTime: number;
  curveEndContextTime: number;
  /** Whether any curve was EVER written — a cancel only needs to keep a
   *  closed-edge constraint when curve windows could survive it. */
  wroteCurve: boolean;
};

export function createParamWriteGuard(): ParamWriteGuard {
  return {
    lastWrittenContextTime: -Infinity,
    curveEndContextTime: -Infinity,
    wroteCurve: false,
  };
}

export function nextRepresentableAfter(value: number): number {
  if (value === 0) {
    return Number.MIN_VALUE;
  }
  const bumped = value + Math.abs(value) * Number.EPSILON;
  return bumped > value ? bumped : value + Number.MIN_VALUE;
}

/**
 * Apply an event list onto a param. documentTimeToContextTime must be
 * AFFINE with slope 1 (a pure offset), so durations pass through unchanged.
 * The guard must be the one continuous per-param guard across appended
 * passes (the loop wrap shares boundaries across writeCycle calls).
 */
export function applyScheduleEvents(
  param: SchedulableParam,
  events: readonly ScheduleEvent[],
  documentTimeToContextTime: (documentTimeSeconds: number) => number,
  guard: ParamWriteGuard = createParamWriteGuard(),
): void {
  for (const event of events) {
    if (event.kind === 'curve') {
      let startTime = documentTimeToContextTime(event.startTime);
      if (startTime <= guard.curveEndContextTime) {
        // STRICTLY after: Tone's standardized-audio-context wrapper (our
        // primary target) treats curve windows as CLOSED on the right —
        // an event bit-equal to T+D throws there even though the Web
        // Audio spec allows it (found live by the Curve Orchestra demo).
        startTime = nextRepresentableAfter(guard.curveEndContextTime);
      }
      if (startTime <= guard.lastWrittenContextTime) {
        // A curve starting exactly ON an existing event contains it.
        startTime = nextRepresentableAfter(guard.lastWrittenContextTime);
      }
      param.setValueCurveAtTime(event.values, startTime, event.duration);
      // The engine computes the window end from the passed doubles — track
      // exactly that.
      guard.curveEndContextTime = startTime + event.duration;
      guard.lastWrittenContextTime = guard.curveEndContextTime;
      guard.wroteCurve = true;
    } else {
      let atTime = documentTimeToContextTime(event.atTime);
      if (atTime <= guard.curveEndContextTime) {
        // Same closed-boundary rule as above.
        atTime = nextRepresentableAfter(guard.curveEndContextTime);
      }
      if (event.kind === 'set') {
        param.setValueAtTime(event.value, atTime);
      } else {
        param.linearRampToValueAtTime(event.value, atTime);
      }
      if (atTime > guard.lastWrittenContextTime) {
        guard.lastWrittenContextTime = atTime;
      }
    }
  }
}
