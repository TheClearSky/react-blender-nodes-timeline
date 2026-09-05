/**
 * Pins for the pure view math: the §8 timeScale clamp [10, 2000], fit,
 * nice ruler steps, and value↔y round-trips.
 */
import { describe, expect, it } from 'vitest';
import {
  autoValueRange,
  clampTimeScale,
  fitTimeScale,
  rulerStepSeconds,
  valueToY,
  yToValue,
} from '../../components/CurveTimeline/timelineView';
import type { TimelineCurve } from '../../model/types';

describe('time scale', () => {
  it('clamps into [10, 2000] px/s (§8)', () => {
    expect(clampTimeScale(1)).toBe(10);
    expect(clampTimeScale(80)).toBe(80);
    expect(clampTimeScale(99999)).toBe(2000);
  });

  it('fit divides width by duration, clamped', () => {
    expect(fitTimeScale(800, 8)).toBe(100);
    expect(fitTimeScale(800, 0.1)).toBe(2000);
    expect(fitTimeScale(0, 8)).toBe(10);
  });

  it('ruler steps keep labels ≥ ~70 px apart', () => {
    expect(rulerStepSeconds(80)).toBe(1);
    expect(rulerStepSeconds(2000)).toBe(0.05);
    expect(rulerStepSeconds(10)).toBe(10);
  });
});

describe('value ↔ y mapping', () => {
  const range = { min: 0, max: 100 };

  it('maps range ends to lane edges and round-trips', () => {
    expect(valueToY(0, range, 110)).toBe(110);
    expect(valueToY(100, range, 110)).toBe(0);
    expect(yToValue(valueToY(37, range, 110), range, 110)).toBeCloseTo(37, 9);
  });

  it('autoValueRange pads 10%, and gives flat/empty curves ±1', () => {
    const curve: TimelineCurve = {
      id: 'crv',
      name: 'c',
      color: '#fff',
      defaultValue: 5,
      points: [
        { t: 0, v: 100, leftInterp: 'linear', rightInterp: 'linear' },
        { t: 1, v: 200, leftInterp: 'linear', rightInterp: 'linear' },
      ],
    };
    expect(autoValueRange(curve)).toEqual({ min: 90, max: 210 });
    expect(autoValueRange({ ...curve, points: [] })).toEqual({
      min: 4,
      max: 6,
    });
    expect(
      autoValueRange({
        ...curve,
        points: [curve.points[0], { ...curve.points[1], v: 100 }],
      }),
    ).toEqual({ min: 99, max: 101 });
  });
});
