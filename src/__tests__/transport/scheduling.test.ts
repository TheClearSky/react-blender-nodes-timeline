/**
 * §9.1 pins for the pure scheduling core: anchor-first, per-segment event
 * shapes, the partial mid-segment curve (EM-22.2), the terminal event
 * (EM-15), the sample-count law, the overlap law, and exact
 * method+args order through applyScheduleEvents.
 */
import { describe, expect, it } from 'vitest';
import { evaluateCurve } from '../../model/evaluate';
import type { TimelineCurve } from '../../model/types';
import {
  applyScheduleEvents,
  buildSchedulePass,
  createParamWriteGuard,
  curveSampleCount,
  type ScheduleEvent,
} from '../../transport/scheduling';
import { createFakeParam } from './fakes';

const demoCutoffCurve: TimelineCurve = {
  id: 'crv_cutoff',
  name: 'cutoff',
  color: '#f59e0b',
  defaultValue: 800,
  points: [
    { t: 0, v: 400, leftInterp: 'linear', rightInterp: 'ease' },
    { t: 2, v: 2000, leftInterp: 'linear', rightInterp: 'step' },
    { t: 5, v: 2000, leftInterp: 'linear', rightInterp: 'linear' },
    { t: 8, v: 400, leftInterp: 'ease', rightInterp: 'linear' },
  ],
};

function makeLinearCurve(): TimelineCurve {
  return {
    id: 'crv_linear',
    name: 'linear',
    color: '#fff',
    defaultValue: 0,
    points: [
      { t: 0, v: 0, leftInterp: 'linear', rightInterp: 'linear' },
      { t: 4, v: 40, leftInterp: 'linear', rightInterp: 'linear' },
    ],
  };
}

function assertOverlapLaw(events: readonly ScheduleEvent[]): void {
  for (const curveEvent of events) {
    if (curveEvent.kind !== 'curve') {
      continue;
    }
    for (const other of events) {
      if (other === curveEvent) {
        continue;
      }
      const otherTime = other.kind === 'curve' ? other.startTime : other.atTime;
      const insideWindow =
        otherTime >= curveEvent.startTime &&
        otherTime < curveEvent.startTime + curveEvent.duration;
      expect(insideWindow).toBe(false);
    }
  }
}

describe('buildSchedulePass — event shapes', () => {
  it('demo full pass [0,8]: curve, step-set, curve, terminal — in order', () => {
    const events = buildSchedulePass(demoCutoffCurve, 0, 8);
    expect(events.map((event) => event.kind)).toEqual([
      'curve',
      'set',
      'curve',
      'set',
    ]);
    const [easeSegment, stepSet, tailSegment, terminal] = events;
    if (easeSegment.kind !== 'curve' || tailSegment.kind !== 'curve') {
      throw new Error('expected curve events');
    }
    expect(easeSegment.startTime).toBe(0);
    expect(easeSegment.duration).toBe(2);
    expect(easeSegment.values.length).toBe(256);
    expect(easeSegment.values[0]).toBeCloseTo(400, 3);
    expect(easeSegment.values[easeSegment.values.length - 1]).toBeCloseTo(
      2000,
      2,
    );
    expect(stepSet).toEqual({ kind: 'set', value: 2000, atTime: 2 });
    expect(tailSegment.startTime).toBe(5);
    expect(tailSegment.duration).toBe(3);
    expect(tailSegment.values[0]).toBeCloseTo(2000, 2);
    expect(tailSegment.values[tailSegment.values.length - 1]).toBeCloseTo(
      400,
      2,
    );
    expect(terminal).toEqual({ kind: 'set', value: 400, atTime: 8 });
    assertOverlapLaw(events);
  });

  it('partial mid-segment reschedule from t=1 resamples only [1,2] (EM-22.2)', () => {
    const events = buildSchedulePass(demoCutoffCurve, 1, 8);
    const first = events[0];
    if (first.kind !== 'curve') {
      throw new Error('expected a curve event first');
    }
    expect(first.startTime).toBe(1);
    expect(first.duration).toBe(1);
    expect(first.values.length).toBe(200);
    // Float32Array quantization: ulp ≈ 6e−5 at magnitude ~930.
    expect(first.values[0]).toBeCloseTo(evaluateCurve(demoCutoffCurve, 1), 3);
    expect(first.values[first.values.length - 1]).toBeCloseTo(2000, 2);
    assertOverlapLaw(events);
  });

  it('window starting in the before-first clamp region gets an anchor set', () => {
    const lateCurve: TimelineCurve = {
      id: 'crv_late',
      name: 'late',
      color: '#fff',
      defaultValue: 0,
      points: [
        { t: 2, v: 10, leftInterp: 'linear', rightInterp: 'linear' },
        { t: 4, v: 20, leftInterp: 'linear', rightInterp: 'linear' },
      ],
    };
    const events = buildSchedulePass(lateCurve, 0, 4);
    expect(events).toEqual([
      { kind: 'set', value: 10, atTime: 0 },
      { kind: 'set', value: 10, atTime: 2 },
      { kind: 'ramp', value: 20, atTime: 4 },
      { kind: 'set', value: 20, atTime: 4 },
    ]);
  });

  it('trailing step lands its final value via the terminal event (EM-15)', () => {
    const stepCurve: TimelineCurve = {
      id: 'crv_step',
      name: 'step',
      color: '#fff',
      defaultValue: 0,
      points: [
        { t: 0, v: 10, leftInterp: 'linear', rightInterp: 'step' },
        { t: 2, v: 20, leftInterp: 'linear', rightInterp: 'linear' },
      ],
    };
    expect(buildSchedulePass(stepCurve, 0, 2)).toEqual([
      { kind: 'set', value: 10, atTime: 0 },
      { kind: 'set', value: 20, atTime: 2 },
    ]);
  });

  it('window cut mid-linear ramps to the EXACT cut value then terminals there', () => {
    const events = buildSchedulePass(makeLinearCurve(), 0, 2);
    expect(events.length).toBe(3);
    expect(events[0]).toEqual({ kind: 'set', value: 0, atTime: 0 });
    // Ramp target is exact linear arithmetic (no solver noise).
    expect(events[1]).toEqual({ kind: 'ramp', value: 20, atTime: 2 });
    // Terminal agrees with evaluate(), which routes through the solver.
    const terminal = events[2];
    if (terminal.kind !== 'set') {
      throw new Error('expected a terminal set');
    }
    expect(terminal.atTime).toBe(2);
    expect(terminal.value).toBeCloseTo(20, 7);
  });

  it('clamp-only windows are anchor + terminal', () => {
    const emptyCurve: TimelineCurve = {
      id: 'crv_empty',
      name: 'empty',
      color: '#fff',
      defaultValue: 800,
      points: [],
    };
    expect(buildSchedulePass(emptyCurve, 1, 3)).toEqual([
      { kind: 'set', value: 800, atTime: 1 },
      { kind: 'set', value: 800, atTime: 3 },
    ]);
    const afterLast = buildSchedulePass(demoCutoffCurve, 8, 10);
    expect(afterLast).toEqual([
      { kind: 'set', value: 400, atTime: 8 },
      { kind: 'set', value: 400, atTime: 10 },
    ]);
  });

  it('degenerate window emits a single anchor', () => {
    expect(buildSchedulePass(demoCutoffCurve, 3, 3)).toEqual([
      { kind: 'set', value: 2000, atTime: 3 },
    ]);
  });

  it('event times are non-decreasing in every generated pass', () => {
    for (const [from, to] of [
      [0, 8],
      [1, 8],
      [1.5, 6.5],
      [0, 2],
      [4.9, 8],
    ] as const) {
      let previousTime = -Infinity;
      for (const event of buildSchedulePass(demoCutoffCurve, from, to)) {
        const eventTime =
          event.kind === 'curve' ? event.startTime : event.atTime;
        expect(eventTime).toBeGreaterThanOrEqual(previousTime);
        previousTime = eventTime;
      }
    }
  });
});

describe('curveSampleCount law', () => {
  it('min(256, max(8, ceil(duration · 200)))', () => {
    expect(curveSampleCount(0.02)).toBe(8);
    expect(curveSampleCount(0.045)).toBe(9);
    expect(curveSampleCount(1)).toBe(200);
    expect(curveSampleCount(5)).toBe(256);
  });
});

describe('write guard (EN-1) — spec-faithful boundaries', () => {
  it('adjacent curve events under a non-representable mapping never violate windows, across appended passes', () => {
    const durationSec = 8.3;
    const wavyCurve: TimelineCurve = {
      id: 'crv_wavy',
      name: 'wavy',
      color: '#fff',
      defaultValue: 0,
      points: [
        { t: 0, v: 0, leftInterp: 'ease', rightInterp: 'ease' },
        {
          t: durationSec * 0.37,
          v: 10,
          leftInterp: 'ease',
          rightInterp: 'ease',
        },
        { t: durationSec, v: 0, leftInterp: 'ease', rightInterp: 'ease' },
      ],
    };
    const events = buildSchedulePass(wavyCurve, 0, durationSec);
    expect(events.filter((event) => event.kind === 'curve').length).toBe(2);

    const param = createFakeParam(); // throws on any spec violation
    const guard = createParamWriteGuard();
    const anchorOffset = 0.1 + 0.2; // 0.30000000000000004
    // 40 appended cycles sharing ONE guard — the wrap seam included.
    for (let cycle = 0; cycle < 40; cycle += 1) {
      applyScheduleEvents(
        param,
        events,
        (documentTime) => anchorOffset + cycle * durationSec + documentTime,
        guard,
      );
    }
    expect(
      param.calls.filter((call) => call.method === 'setValueCurveAtTime')
        .length,
    ).toBe(80);
  });
});

describe('applyScheduleEvents — exact call order and mapped times', () => {
  it('applies the demo pass with an affine +100 mapping', () => {
    const param = createFakeParam();
    applyScheduleEvents(
      param,
      buildSchedulePass(demoCutoffCurve, 0, 8),
      (documentTime) => documentTime + 100,
    );
    expect(param.calls.map((call) => call.method)).toEqual([
      'setValueCurveAtTime',
      'setValueAtTime',
      'setValueCurveAtTime',
      'setValueAtTime',
    ]);
    const [firstCurve, stepSet, secondCurve, terminal] = param.calls;
    expect(firstCurve.args[0]).toBeInstanceOf(Float32Array);
    expect(firstCurve.args[1]).toBe(100);
    expect(firstCurve.args[2]).toBe(2);
    // Post-curve boundary events sit ONE ULP after the engine-computed
    // curve end (the wrapper's closed-boundary rule) — times are
    // tolerance-pinned, values exact.
    expect(stepSet.args[0]).toBe(2000);
    expect(stepSet.args[1] as number).toBeGreaterThan(102);
    expect(stepSet.args[1] as number).toBeCloseTo(102, 9);
    expect(secondCurve.args[1] as number).toBeCloseTo(105, 9);
    expect(secondCurve.args[2]).toBe(3);
    expect(terminal.args[0]).toBe(400);
    expect(terminal.args[1] as number).toBeCloseTo(108, 9);
  });
});
