/**
 * Plan §9.1: zod round-trip plus the refines — strictly-increasing t (min
 * Δ 1 ms), all-finite values, durationSec ≥ last point t, unique curve ids,
 * version gate — with path-level errors (review EM-22.6).
 */
import { describe, expect, it } from 'vitest';
import { demoTimelineDocument } from '../../model/demoDocument';
import {
  parseTimelineDocument,
  timelineCurveSchema,
  timelineDocumentSchema,
} from '../../model/schemas';
import type { TimelineDocument } from '../../model/types';

/** The plan §3 demo document. */
const demoDocument: TimelineDocument = {
  version: 1,
  durationSec: 8,
  loop: true,
  curves: [
    {
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
    },
  ],
};

function documentWith(
  overrides: Partial<{ [Key in keyof TimelineDocument]: unknown }>,
): unknown {
  return { ...demoDocument, ...overrides };
}

function issuePaths(input: unknown): string[] {
  const result = timelineDocumentSchema.safeParse(input);
  if (result.success) {
    return [];
  }
  return result.error.issues.map((issue) => issue.path.join('.'));
}

describe('round-trip', () => {
  it('parses the demo document unchanged', () => {
    expect(parseTimelineDocument(demoDocument)).toEqual(demoDocument);
  });

  it('accepts empty curves, empty points, and a single point', () => {
    expect(issuePaths(documentWith({ curves: [] }))).toEqual([]);
    expect(
      issuePaths(
        documentWith({
          curves: [
            { id: 'a', name: '', color: '#fff', defaultValue: 0, points: [] },
            {
              id: 'b',
              name: 'one',
              color: '#fff',
              defaultValue: 0,
              points: [{ t: 3, v: 7, leftInterp: 'step', rightInterp: 'step' }],
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('accepts durationSec exactly equal to the last point t', () => {
    expect(issuePaths(documentWith({ durationSec: 8 }))).toEqual([]);
  });

  it('the exported demoTimelineDocument is schema-valid and matches §3', () => {
    expect(parseTimelineDocument(demoTimelineDocument)).toEqual(demoDocument);
  });
});

describe('point-ordering refine (min Δ 1 ms) with path-level errors', () => {
  function curveWithTimes(times: number[]): unknown {
    return {
      id: 'crv',
      name: 'c',
      color: '#fff',
      defaultValue: 0,
      points: times.map((time) => ({
        t: time,
        v: 0,
        leftInterp: 'linear',
        rightInterp: 'linear',
      })),
    };
  }

  it('rejects equal, decreasing, and sub-millisecond-spaced times', () => {
    for (const badTimes of [
      [0, 0],
      [2, 1],
      [0, 0.0005],
    ]) {
      const result = timelineCurveSchema.safeParse(curveWithTimes(badTimes));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.map((issue) => issue.path.join('.')),
        ).toContain('points.1.t');
      }
    }
  });

  it('accepts exactly 1 ms spacing', () => {
    expect(
      timelineCurveSchema.safeParse(curveWithTimes([0, 0.001])).success,
    ).toBe(true);
  });
});

describe('finiteness and range rejections', () => {
  it('rejects non-finite v / defaultValue and negative t', () => {
    expect(
      issuePaths(
        documentWith({
          curves: [
            {
              id: 'crv',
              name: 'c',
              color: '#fff',
              defaultValue: 0,
              points: [
                {
                  t: 0,
                  v: Infinity,
                  leftInterp: 'linear',
                  rightInterp: 'linear',
                },
              ],
            },
          ],
        }),
      ),
    ).toContain('curves.0.points.0.v');
    expect(
      issuePaths(
        documentWith({
          curves: [
            {
              id: 'crv',
              name: 'c',
              color: '#fff',
              defaultValue: -Infinity,
              points: [],
            },
          ],
        }),
      ),
    ).toContain('curves.0.defaultValue');
    expect(
      issuePaths(
        documentWith({
          curves: [
            {
              id: 'crv',
              name: 'c',
              color: '#fff',
              defaultValue: 0,
              points: [
                {
                  t: -1,
                  v: 0,
                  leftInterp: 'linear',
                  rightInterp: 'linear',
                },
              ],
            },
          ],
        }),
      ),
    ).toContain('curves.0.points.0.t');
  });

  it('rejects NaN t, zero/negative durationSec, and unknown interp', () => {
    expect(issuePaths(documentWith({ durationSec: 0 }))).toContain(
      'durationSec',
    );
    expect(issuePaths(documentWith({ durationSec: -3 }))).toContain(
      'durationSec',
    );
    // Floor/ceiling (EN-6 / UI-3): microscopic durations freeze the
    // top-up loop; unbounded ones hang the ruler/canvas paths.
    expect(issuePaths(documentWith({ durationSec: 0.005 }))).toContain(
      'durationSec',
    );
    expect(issuePaths(documentWith({ durationSec: 4000 }))).toContain(
      'durationSec',
    );
    const nanResult = timelineCurveSchema.safeParse({
      id: 'crv',
      name: 'c',
      color: '#fff',
      defaultValue: 0,
      points: [{ t: NaN, v: 0, leftInterp: 'linear', rightInterp: 'linear' }],
    });
    expect(nanResult.success).toBe(false);
    const badInterpResult = timelineCurveSchema.safeParse({
      id: 'crv',
      name: 'c',
      color: '#fff',
      defaultValue: 0,
      points: [{ t: 0, v: 0, leftInterp: 'bounce', rightInterp: 'linear' }],
    });
    expect(badInterpResult.success).toBe(false);
  });
});

describe('document-level refines', () => {
  it('rejects durationSec shorter than a curve’s last point', () => {
    expect(issuePaths(documentWith({ durationSec: 5 }))).toContain(
      'durationSec',
    );
  });

  it('rejects duplicate curve ids at the duplicate’s path', () => {
    const duplicated = documentWith({
      curves: [
        { id: 'crv_a', name: 'a', color: '#fff', defaultValue: 0, points: [] },
        { id: 'crv_a', name: 'b', color: '#fff', defaultValue: 0, points: [] },
      ],
    });
    expect(issuePaths(duplicated)).toContain('curves.1.id');
  });

  it('rejects non-hex colors; accepts 3-digit hex (UI-16)', () => {
    expect(
      issuePaths(
        documentWith({
          curves: [
            { id: 'crv', name: 'c', color: 'red', defaultValue: 0, points: [] },
          ],
        }),
      ),
    ).toContain('curves.0.color');
    expect(
      issuePaths(
        documentWith({
          curves: [
            {
              id: 'crv',
              name: 'c',
              color: '#f59',
              defaultValue: 0,
              points: [],
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('rejects unknown versions and empty ids', () => {
    expect(issuePaths(documentWith({ version: 2 }))).toContain('version');
    expect(
      issuePaths(
        documentWith({
          curves: [
            { id: '', name: 'c', color: '#fff', defaultValue: 0, points: [] },
          ],
        }),
      ),
    ).toContain('curves.0.id');
  });
});
