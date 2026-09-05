/**
 * The canonical demo document (plan §3) — the same curve the unit oracles
 * pin (t=1.065 s → 1000 on segment 1) and the §9.2 live pass drives into a
 * bandpass filter. Useful as a starting document and in docs/tests.
 */
import type { TimelineDocument } from './types';

export const demoTimelineDocument: TimelineDocument = {
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
