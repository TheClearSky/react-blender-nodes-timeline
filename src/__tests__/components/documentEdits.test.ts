/**
 * Pins for the pure editor edit helpers: neighbor/1 ms clamps, refuse-shrink
 * duration (EM-22.5), unique curve ids, sorted insertion, wrap-mismatch
 * detection.
 */
import { describe, expect, it } from 'vitest';
import type { TimelineDocument } from '../../model/types';
import { parseTimelineDocument } from '../../model/schemas';
import {
  addCurve,
  addPoint,
  deleteCurve,
  deletePoint,
  hasWrapMismatch,
  lastPointTime,
  movePoint,
  setDuration,
  setPointInterp,
  toggleLoop,
} from '../../components/CurveTimeline/documentEdits';

function makeDocument(): TimelineDocument {
  return {
    version: 1,
    durationSec: 8,
    loop: true,
    curves: [
      {
        id: 'crv_a',
        name: 'a',
        color: '#f59e0b',
        defaultValue: 0,
        points: [
          { t: 1, v: 10, leftInterp: 'linear', rightInterp: 'linear' },
          { t: 3, v: 30, leftInterp: 'linear', rightInterp: 'linear' },
          { t: 5, v: 20, leftInterp: 'linear', rightInterp: 'linear' },
        ],
      },
    ],
  };
}

describe('addPoint', () => {
  it('inserts sorted and returns the index', () => {
    const result = addPoint(makeDocument(), 'crv_a', 2, 99);
    expect(result).not.toBeNull();
    if (result === null) {
      return;
    }
    expect(result.pointIndex).toBe(1);
    const times = result.document.curves[0].points.map((point) => point.t);
    expect(times).toEqual([1, 2, 3, 5]);
    expect(parseTimelineDocument(result.document)).toEqual(result.document);
  });

  it('nudges to keep 1 ms from neighbors and clamps into [0, duration]', () => {
    const onNeighbor = addPoint(makeDocument(), 'crv_a', 3, 0);
    expect(onNeighbor).not.toBeNull();
    if (onNeighbor !== null) {
      const insertedTime =
        onNeighbor.document.curves[0].points[onNeighbor.pointIndex].t;
      expect(insertedTime).toBeCloseTo(3.001, 9);
    }
    const beyondEnd = addPoint(makeDocument(), 'crv_a', 99, 0);
    expect(beyondEnd).not.toBeNull();
    if (beyondEnd !== null) {
      expect(beyondEnd.document.curves[0].points[beyondEnd.pointIndex].t).toBe(
        8,
      );
    }
  });

  it('returns null when the gap cannot fit a new point', () => {
    const tight: TimelineDocument = {
      ...makeDocument(),
      curves: [
        {
          id: 'crv_a',
          name: 'a',
          color: '#fff',
          defaultValue: 0,
          points: [
            { t: 1, v: 0, leftInterp: 'linear', rightInterp: 'linear' },
            { t: 1.0015, v: 1, leftInterp: 'linear', rightInterp: 'linear' },
          ],
        },
      ],
    };
    expect(addPoint(tight, 'crv_a', 1.0007, 5)).toBeNull();
  });
});

describe('movePoint', () => {
  it('clamps between neighbors ± 1 ms; order never changes', () => {
    const moved = movePoint(makeDocument(), 'crv_a', 1, 99, 42);
    const points = moved.curves[0].points;
    expect(points[1].t).toBeCloseTo(4.999, 9);
    expect(points[1].v).toBe(42);
    expect(points.map((point) => point.t)).toEqual(
      [...points.map((point) => point.t)].sort((a, b) => a - b),
    );
    const movedLeft = movePoint(makeDocument(), 'crv_a', 0, -5, 10);
    expect(movedLeft.curves[0].points[0].t).toBe(0);
  });

  it('ignores unknown curve / index / non-finite values', () => {
    const document = makeDocument();
    expect(movePoint(document, 'crv_missing', 0, 2, 2)).toBe(document);
    expect(movePoint(document, 'crv_a', 99, 2, 2)).toBe(document);
    expect(movePoint(document, 'crv_a', 0, 2, NaN)).toBe(document);
  });

  it('ignores non-finite TIMES too (UI-10)', () => {
    const document = makeDocument();
    expect(movePoint(document, 'crv_a', 0, NaN, 2)).toBe(document);
    expect(movePoint(document, 'crv_a', 0, Infinity, 2)).toBe(document);
    expect(addPoint(document, 'crv_a', NaN, 2)).toBeNull();
  });
});

describe('curves and duration', () => {
  it('addCurve mints unique ids and unused palette colors', () => {
    const first = addCurve(makeDocument());
    expect(first.curveId).toBe('crv_2');
    const second = addCurve(first.document);
    expect(second.curveId).toBe('crv_3');
    const ids = second.document.curves.map((curve) => curve.id);
    expect(new Set(ids).size).toBe(ids.length);
    const colors = second.document.curves.map((curve) => curve.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(parseTimelineDocument(second.document)).toEqual(second.document);
  });

  it('deleteCurve removes exactly that curve', () => {
    const withTwo = addCurve(makeDocument()).document;
    const after = deleteCurve(withTwo, 'crv_a');
    expect(after.curves.map((curve) => curve.id)).toEqual(['crv_2']);
  });

  it('setDuration refuses to shrink below the last point (EM-22.5)', () => {
    expect(setDuration(makeDocument(), 3).durationSec).toBe(5);
    expect(setDuration(makeDocument(), 12).durationSec).toBe(12);
    expect(setDuration(makeDocument(), NaN)).toEqual(makeDocument());
    expect(lastPointTime(makeDocument())).toBe(5);
  });

  it('setDuration caps at the ceiling (UI-3)', () => {
    expect(setDuration(makeDocument(), 1e12).durationSec).toBe(3600);
  });

  it('addCurve never re-mints a DELETED numeric id (UI-7)', () => {
    let document: TimelineDocument = {
      ...makeDocument(),
      curves: ['crv_1', 'crv_2', 'crv_3'].map((id) => ({
        id,
        name: id,
        color: '#fff',
        defaultValue: 0,
        points: [],
      })),
    };
    document = deleteCurve(document, 'crv_2');
    const added = addCurve(document);
    expect(added.curveId).toBe('crv_4');
  });
});

describe('point edits and flags', () => {
  it('deletePoint and setPointInterp target exactly one point', () => {
    const afterDelete = deletePoint(makeDocument(), 'crv_a', 1);
    expect(afterDelete.curves[0].points.map((point) => point.t)).toEqual([
      1, 5,
    ]);
    const afterInterp = setPointInterp(
      makeDocument(),
      'crv_a',
      1,
      'left',
      'step',
    );
    expect(afterInterp.curves[0].points[1].leftInterp).toBe('step');
    expect(afterInterp.curves[0].points[1].rightInterp).toBe('linear');
    expect(afterInterp.curves[0].points[0].leftInterp).toBe('linear');
  });

  it('toggleLoop flips; hasWrapMismatch needs loop + differing ends', () => {
    const document = makeDocument();
    expect(toggleLoop(document).loop).toBe(false);
    expect(hasWrapMismatch(document, document.curves[0])).toBe(true);
    expect(hasWrapMismatch(toggleLoop(document), document.curves[0])).toBe(
      false,
    );
    const matched = movePoint(document, 'crv_a', 2, 5, 10);
    expect(hasWrapMismatch(matched, matched.curves[0])).toBe(false);
  });
});
