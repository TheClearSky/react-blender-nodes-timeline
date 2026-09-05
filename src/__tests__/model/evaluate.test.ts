/**
 * Plan §9.1 unit oracles for the §4 interpolation math: linear identity
 * (Oracle 1), the 0.5325/0.375 bezier pin and the demo's t=1.065 → 1000 pin
 * (Oracle 2), the step rule, all clamps, and solver convergence +
 * monotonicity.
 */
import { describe, expect, it } from 'vitest';
import { bezierPoint, evaluateCurve, solveBezierU } from '../../model/evaluate';
import type { TimelineCurve } from '../../model/types';

function curveWithPoints(
  points: TimelineCurve['points'],
  defaultValue = 0,
): TimelineCurve {
  return {
    id: 'crv_test',
    name: 'test',
    color: '#ffffff',
    defaultValue,
    points,
  };
}

/** The plan §3 demo document's cutoff curve — the Oracle 2 fixture. */
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

describe('Oracle 1 — linear/linear is exactly the straight line', () => {
  it('reduces to the identity on a unit segment', () => {
    const unitCurve = curveWithPoints([
      { t: 0, v: 0, leftInterp: 'linear', rightInterp: 'linear' },
      { t: 1, v: 1, leftInterp: 'linear', rightInterp: 'linear' },
    ]);
    for (const time of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
      expect(evaluateCurve(unitCurve, time)).toBeCloseTo(time, 6);
    }
  });

  it('is the straight line on a scaled segment (0s→2s, 400→2000)', () => {
    const scaledCurve = curveWithPoints([
      { t: 0, v: 400, leftInterp: 'linear', rightInterp: 'linear' },
      { t: 2, v: 2000, leftInterp: 'linear', rightInterp: 'linear' },
    ]);
    expect(evaluateCurve(scaledCurve, 0.5)).toBeCloseTo(800, 4);
    expect(evaluateCurve(scaledCurve, 1)).toBeCloseTo(1200, 4);
    expect(evaluateCurve(scaledCurve, 1.5)).toBeCloseTo(1600, 4);
  });
});

describe('Oracle 2 — mixed ease/linear segment', () => {
  it('bezierPoint(0.5) === {x: 0.5325, y: 0.375} for ease→linear controls', () => {
    const point = bezierPoint({ x: 0.42, y: 0 }, { x: 2 / 3, y: 2 / 3 }, 0.5);
    expect(point.x).toBeCloseTo(0.5325, 12);
    expect(point.y).toBeCloseTo(0.375, 12);
  });

  it('demo segment 1 (ease→linear, 400→2000) gives 1000 at t=1.065s', () => {
    expect(evaluateCurve(demoCutoffCurve, 1.065)).toBeCloseTo(1000, 4);
  });
});

describe('step rule — either facing side holds the whole segment', () => {
  it('rightInterp step holds v1 until the jump at t2', () => {
    const stepCurve = curveWithPoints([
      { t: 0, v: 10, leftInterp: 'linear', rightInterp: 'step' },
      { t: 2, v: 20, leftInterp: 'linear', rightInterp: 'linear' },
    ]);
    expect(evaluateCurve(stepCurve, 0)).toBe(10);
    expect(evaluateCurve(stepCurve, 1)).toBe(10);
    expect(evaluateCurve(stepCurve, 1.999)).toBe(10);
    expect(evaluateCurve(stepCurve, 2)).toBe(20);
  });

  it('leftInterp step on the END point also holds the segment', () => {
    const stepCurve = curveWithPoints([
      { t: 0, v: 10, leftInterp: 'linear', rightInterp: 'linear' },
      { t: 2, v: 20, leftInterp: 'step', rightInterp: 'linear' },
    ]);
    expect(evaluateCurve(stepCurve, 1)).toBe(10);
    expect(evaluateCurve(stepCurve, 1.999)).toBe(10);
    expect(evaluateCurve(stepCurve, 2)).toBe(20);
  });
});

describe('clamps (plan §4 / §8 rows)', () => {
  it('no points → defaultValue', () => {
    expect(evaluateCurve(curveWithPoints([], 800), 3.7)).toBe(800);
  });

  it('single point → constant everywhere', () => {
    const singlePointCurve = curveWithPoints([
      { t: 1, v: 42, leftInterp: 'ease', rightInterp: 'ease' },
    ]);
    for (const time of [-5, 0, 1, 2.5, 99]) {
      expect(evaluateCurve(singlePointCurve, time)).toBe(42);
    }
  });

  it('before first / after last → first / last value', () => {
    expect(evaluateCurve(demoCutoffCurve, -1)).toBe(400);
    expect(evaluateCurve(demoCutoffCurve, 9)).toBe(400);
  });

  it('exact keyframe times return the keyframe values', () => {
    expect(evaluateCurve(demoCutoffCurve, 0)).toBe(400);
    expect(evaluateCurve(demoCutoffCurve, 2)).toBe(2000);
    expect(evaluateCurve(demoCutoffCurve, 5)).toBe(2000);
    expect(evaluateCurve(demoCutoffCurve, 8)).toBe(400);
  });
});

describe('solver — convergence and monotonicity', () => {
  const controlPairs: Array<[number, number]> = [
    [1 / 3, 2 / 3],
    [0.42, 0.58],
    [0, 1],
    [1, 0], // x'(u) = 3(1−2u)² — flat at u=0.5, worst case for bisection
  ];

  it('|x(solveBezierU(xTarget)) − xTarget| ≤ 1e−6 across control pairs', () => {
    for (const [controlX1, controlX2] of controlPairs) {
      for (let tenth = 0; tenth <= 10; tenth += 1) {
        const xTarget = tenth / 10;
        const solved = solveBezierU(controlX1, controlX2, xTarget);
        const xAtSolved = bezierPoint(
          { x: controlX1, y: 0 },
          { x: controlX2, y: 1 },
          solved,
        ).x;
        expect(Math.abs(xAtSolved - xTarget)).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it('solved u is non-decreasing in xTarget', () => {
    for (const [controlX1, controlX2] of controlPairs) {
      let previousSolved = 0;
      for (let hundredth = 0; hundredth <= 100; hundredth += 1) {
        const solved = solveBezierU(controlX1, controlX2, hundredth / 100);
        expect(solved).toBeGreaterThanOrEqual(previousSolved);
        previousSolved = solved;
      }
    }
  });

  it('hits the endpoints exactly', () => {
    expect(solveBezierU(0.42, 0.58, 0)).toBe(0);
    expect(solveBezierU(0.42, 0.58, 1)).toBe(1);
  });
});

describe('ease shape sanity', () => {
  it('full ease/ease is symmetric: midpoint maps to midpoint, start is slow', () => {
    const easeCurve = curveWithPoints([
      { t: 0, v: 0, leftInterp: 'ease', rightInterp: 'ease' },
      { t: 1, v: 1, leftInterp: 'ease', rightInterp: 'ease' },
    ]);
    // Solver interval 1e−9 × midpoint value slope y'(0.5)=1.5 bounds the
    // error at 7.5e−10, so precision 8 (5e−9) is the tightest safe pin.
    expect(evaluateCurve(easeCurve, 0.5)).toBeCloseTo(0.5, 8);
    const earlyValue = evaluateCurve(easeCurve, 0.1);
    expect(earlyValue).toBeGreaterThanOrEqual(0);
    expect(earlyValue).toBeLessThan(0.05);
  });
});
