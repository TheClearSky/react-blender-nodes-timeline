import { describe, expect, it } from 'vitest';
import type { TimelineCurve, TimelineDocument } from '../../model/types';
import { parseTimelineDocument } from '../../model/schemas';
import { evaluateCurve } from '../../model/evaluate';
import {
  convertCurveToBars,
  isTempoRefusal,
  setTempoGrid,
  setValueGrid,
  setBarValue,
  setBeatsPerBar,
  setLockDuration,
  setTempoBpm,
} from '../../components/CurveTimeline/documentEdits';
import {
  cellSeconds,
  formatBarsBeats,
  snapToGrid,
  tempoOf,
} from '../../components/CurveTimeline/tempo';

/** The plan's worked example: 2 bars at 120 BPM, one step bar per beat. */
function stepBars(heights: number[], beatSec = 0.5): TimelineCurve {
  return {
    id: 'crv_1',
    name: 'pattern',
    color: '#f59e0b',
    defaultValue: 0,
    display: 'bars',
    points: heights.map((v, index) => ({
      t: index * beatSec,
      v,
      leftInterp: 'step',
      rightInterp: 'step',
    })),
  };
}

function documentWith(
  curve: TimelineCurve,
  extra: Partial<TimelineDocument> = {},
): TimelineDocument {
  return { version: 1, durationSec: 4, loop: true, curves: [curve], ...extra };
}

const PATTERN = [1, 2, 1, 3, 1, 2, 1, 3];

describe('tempo edits (Q-M2 A)', () => {
  it('a document without a tempo reads as 120 BPM 4/4', () => {
    const tempo = tempoOf(documentWith(stepBars(PATTERN)));
    expect(tempo).toEqual({ bpm: 120, beatsPerBar: 4 });
    expect(cellSeconds(tempo, '1/4')).toBe(0.5);
    expect(cellSeconds(tempo, 'bar')).toBe(2);
    expect(cellSeconds(tempo, '1/16')).toBe(0.125);
  });

  it('UNLOCKED 120 → 150: same beats, everything 0.8× — beat 5 at 1.6 s, 3.2 s long', () => {
    const result = setTempoBpm(documentWith(stepBars(PATTERN)), 150);
    if (isTempoRefusal(result)) throw new Error(result.refused);
    expect(result.tempo).toEqual({ bpm: 150, beatsPerBar: 4 });
    expect(result.durationSec).toBeCloseTo(3.2, 12);
    const times = result.curves[0].points.map((point) => point.t);
    expect(times[4]).toBeCloseTo(1.6, 12);
    expect(times[7]).toBeCloseTo(2.8, 12);
    // Values untouched, still on beats.
    expect(result.curves[0].points.map((point) => point.v)).toEqual(PATTERN);
    expect(formatBarsBeats(times[4], result.tempo!)).toBe('2.1');
    expect(() => parseTimelineDocument(result)).not.toThrow();
  });

  it('LOCKED 120 → 150: nothing moves or sounds different, only the grid', () => {
    const locked = setLockDuration(documentWith(stepBars(PATTERN)), true);
    const result = setTempoBpm(locked, 150);
    if (isTempoRefusal(result)) throw new Error(result.refused);
    expect(result.durationSec).toBe(4);
    expect(result.curves).toBe(locked.curves); // the very same curves
    expect(cellSeconds(result.tempo!, '1/4')).toBeCloseTo(0.4, 12);
    // The old beat-5 bar (2.0 s) now sits at beat 6 of the new grid.
    expect(formatBarsBeats(2.0, result.tempo!)).toBe('2.2');
  });

  it('refuses a rescale that would squeeze two points under 1 ms', () => {
    const tight: TimelineCurve = {
      ...stepBars([0, 1]),
      points: [
        { t: 1, v: 0, leftInterp: 'step', rightInterp: 'step' },
        { t: 1.0015, v: 1, leftInterp: 'step', rightInterp: 'step' },
      ],
    };
    const document = documentWith(tight);
    const result = setTempoBpm(document, 400); // factor 0.3 → 0.45 ms gap
    expect(isTempoRefusal(result)).toBe(true);
  });

  it('refuses a rescale past the 3600 s duration limit', () => {
    const long = documentWith(stepBars([1]), { durationSec: 3000 });
    const result = setTempoBpm(long, 60); // ×2 → 6000 s
    expect(isTempoRefusal(result)).toBe(true);
  });

  it('beats per bar only changes the grid', () => {
    const document = documentWith(stepBars(PATTERN));
    const next = setBeatsPerBar(document, 3);
    expect(next.tempo).toEqual({ bpm: 120, beatsPerBar: 3 });
    expect(next.curves).toBe(document.curves);
    expect(formatBarsBeats(2.0, next.tempo!)).toBe('2.2');
  });

  it('snaps to the nearest grid line', () => {
    expect(snapToGrid(1.26, 0.5)).toBe(1.5);
    expect(snapToGrid(1.24, 0.5)).toBe(1);
  });
});

describe('bars (Q-M1 A)', () => {
  const smooth: TimelineCurve = {
    id: 'crv_2',
    name: 'cutoff',
    color: '#22d3ee',
    defaultValue: 0,
    points: [
      { t: 0, v: 0, leftInterp: 'linear', rightInterp: 'linear' },
      { t: 4, v: 400, leftInterp: 'linear', rightInterp: 'linear' },
    ],
  };

  it('converts a smooth curve to one step per cell, sampled at the cell start', () => {
    const result = convertCurveToBars(documentWith(smooth), 'crv_2', 0.5);
    expect(result).not.toBeNull();
    const curve = result!.curves[0];
    expect(curve.display).toBe('bars');
    expect(curve.points.map((point) => point.t)).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5,
    ]);
    // Sampled through evaluate(), whose bezier solver is exact to ~1e-9.
    const expected = [0, 50, 100, 150, 200, 250, 300, 350];
    curve.points.forEach((point, index) =>
      expect(point.v).toBeCloseTo(expected[index], 5),
    );
    expect(curve.points.every((point) => point.rightInterp === 'step')).toBe(
      true,
    );
    expect(() => parseTimelineDocument(result)).not.toThrow();
  });

  it('keeps an all-step curve as it is', () => {
    const document = documentWith({ ...stepBars(PATTERN), display: undefined });
    const result = convertCurveToBars(document, 'crv_1', 0.25);
    expect(result!.curves[0].points).toBe(document.curves[0].points);
    expect(result!.curves[0].display).toBe('bars');
  });

  it('refuses a grid with too many cells', () => {
    const long = documentWith(smooth, { durationSec: 3600 });
    expect(convertCurveToBars(long, 'crv_2', 0.125)).toBeNull();
  });

  it('dragging bar 4 (1.5–2.0 s) up changes only that bar', () => {
    const document = documentWith(stepBars(PATTERN));
    const next = setBarValue(document, 'crv_1', 1.7, 9, 0.5);
    const curve = next.curves[0];
    expect(curve.points.map((point) => point.v)).toEqual([
      1, 2, 1, 9, 1, 2, 1, 3,
    ]);
    expect(evaluateCurve(curve, 1.99)).toBe(9);
    expect(evaluateCurve(curve, 2.0)).toBe(1);
  });

  it('painting a half-beat cell splits the bar and keeps what followed', () => {
    const document = documentWith(stepBars(PATTERN));
    // 1/8 grid: the cell 1.0–1.25 s inside bar 3 (value 1).
    const next = setBarValue(document, 'crv_1', 1.1, 7, 0.25);
    const curve = next.curves[0];
    expect(evaluateCurve(curve, 1.1)).toBe(7);
    expect(evaluateCurve(curve, 1.3)).toBe(1); // rest of bar 3 unchanged
    expect(evaluateCurve(curve, 1.6)).toBe(3); // bar 4 unchanged
    expect(() => parseTimelineDocument(next)).not.toThrow();
  });

  it('paints the last cell without a point past the end', () => {
    const document = documentWith(stepBars(PATTERN));
    const next = setBarValue(document, 'crv_1', 3.9, 5, 0.5);
    const curve = next.curves[0];
    expect(curve.points[curve.points.length - 1]).toMatchObject({ t: 3.5, v: 5 });
    expect(() => parseTimelineDocument(next)).not.toThrow();
  });

  it('the schema accepts tempo, lock and display, and still accepts old files', () => {
    const withTempo = setLockDuration(
      setBeatsPerBar(documentWith(stepBars(PATTERN)), 3),
      true,
    );
    expect(parseTimelineDocument(withTempo).tempo).toEqual({
      bpm: 120,
      beatsPerBar: 3,
    });
    const old = { version: 1, durationSec: 4, loop: false, curves: [] };
    expect(parseTimelineDocument(old).tempo).toBeUndefined();
    expect(() =>
      parseTimelineDocument({ ...old, tempo: { bpm: 5, beatsPerBar: 4 } }),
    ).toThrow();
  });
});

describe('grid finder edits (Q-F1 A / Q-F2 A)', () => {
  it('applying a found tempo grid moves nothing, even unlocked', () => {
    const document = documentWith(stepBars(PATTERN));
    const next = setTempoGrid(document, { bpm: 133, beatsPerBar: 4, offsetSec: 0.25 });
    expect(next.tempo).toEqual({ bpm: 133, beatsPerBar: 4, offsetSec: 0.25 });
    expect(next.curves).toBe(document.curves);
    expect(next.durationSec).toBe(document.durationSec);
    expect(() => parseTimelineDocument(next)).not.toThrow();
  });

  it('an unlocked tempo change carries the grid start with the music', () => {
    const document = setTempoGrid(documentWith(stepBars(PATTERN)), {
      bpm: 120,
      beatsPerBar: 4,
      offsetSec: 0.5,
    });
    const result = setTempoBpm(document, 150);
    if (isTempoRefusal(result)) throw new Error(result.refused);
    expect(result.tempo?.offsetSec).toBeCloseTo(0.4, 12);
  });

  it('bars follow a grid that starts late: a partial first cell from 0', () => {
    const smooth: TimelineCurve = {
      ...stepBars([0, 1]),
      display: undefined,
      points: [
        { t: 0, v: 0, leftInterp: 'linear', rightInterp: 'linear' },
        { t: 4, v: 4, leftInterp: 'linear', rightInterp: 'linear' },
      ],
    };
    const result = convertCurveToBars(documentWith(smooth), 'crv_1', 1, 0.25);
    expect(result!.curves[0].points.map((point) => point.t)).toEqual([
      0, 0.25, 1.25, 2.25, 3.25,
    ]);
    // Painting inside the partial first cell sets [0, 0.25).
    const painted = setBarValue(result!, 'crv_1', 0.1, 9, 1, 0.25);
    expect(evaluateCurve(painted.curves[0], 0.2)).toBe(9);
    expect(evaluateCurve(painted.curves[0], 0.3)).toBeCloseTo(0.25, 5);
  });

  it('a pickup before the grid start reads as bar 0', () => {
    const tempo = { bpm: 120, beatsPerBar: 4, offsetSec: 0.5 };
    expect(formatBarsBeats(0.5, tempo)).toBe('1.1');
    expect(formatBarsBeats(0.0, tempo)).toBe('0.4');
    expect(snapToGrid(0.74, 0.5, 0.5)).toBe(0.5);
    expect(snapToGrid(0.76, 0.5, 0.5)).toBe(1.0);
  });

  it('a lane value grid is stored, validated, and can be cleared', () => {
    const document = documentWith(stepBars(PATTERN));
    const withGrid = setValueGrid(document, 'crv_1', {
      kind: 'pitch',
      a4: 440,
      show: true,
      snap: true,
    });
    expect(parseTimelineDocument(withGrid).curves[0].valueGrid).toEqual({
      kind: 'pitch',
      a4: 440,
      show: true,
      snap: true,
    });
    const cleared = setValueGrid(withGrid, 'crv_1', undefined);
    expect('valueGrid' in cleared.curves[0]).toBe(false);
    expect(() =>
      parseTimelineDocument(
        setValueGrid(document, 'crv_1', { kind: 'linear', step: 0, origin: 0, show: true, snap: false }),
      ),
    ).toThrow();
  });
});
