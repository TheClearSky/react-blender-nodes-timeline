import { describe, expect, it } from 'vitest';
import {
  findTempoCandidates,
  findValueGridCandidates,
} from '../../components/CurveTimeline/gridFinder';
import { buildValueLines, snapValue } from '../../components/CurveTimeline/gridLines';

/** Note starts on a grid, each followed by the envelope points a real lane
 *  carries (+12 ms attack peak, +90 ms decay) — the noise the demos have. */
function withEnvelopes(starts: number[]): number[] {
  const times = new Set<number>();
  for (const start of starts) {
    for (const t of [start, start + 0.012, start + 0.09]) {
      times.add(Math.round(t * 1000) / 1000);
    }
  }
  return [...times].sort((a, b) => a - b);
}

function repeatBars(
  bpm: number,
  sixteenths: number[],
  bars: number,
  origin = 0,
): number[] {
  const sixteenth = 60 / bpm / 4;
  const starts: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    for (const index of sixteenths) starts.push(origin + (bar * 16 + index) * sixteenth);
  }
  return starts;
}

describe('tempo finder', () => {
  it('finds 120 BPM under envelope noise (curveOrchestra-like)', () => {
    const times = withEnvelopes(repeatBars(120, [0, 3, 6, 8, 11, 14], 8));
    const [best] = findTempoCandidates(times);
    expect(best.bpm).toBe(120);
    expect(best.offsetSec).toBe(0);
    expect(best.confidence).toBe(1);
  });

  it('finds 133 for a 3+3+2 figure — not its 3/2 alias (bellClub)', () => {
    // bellClub's first bar: note starts on 16ths 0, 3, 6, 10, decay +0.21 s.
    const starts = repeatBars(133, [0, 3, 6, 10], 12);
    const times = [...new Set(starts.flatMap((t) => [t, t + 0.21]))]
      .map((t) => Math.round(t * 1000) / 1000)
      .sort((a, b) => a - b);
    const candidates = findTempoCandidates(times);
    expect(candidates[0].bpm).toBe(133);
    // The alias is still offered, lower down — the modal shows both.
    expect(candidates.length).toBeGreaterThan(1);
  });

  it('finds where the grid starts (a pickup of 0.3 s)', () => {
    const times = withEnvelopes(repeatBars(100, [0, 4, 8, 12], 8, 0.3));
    const [best] = findTempoCandidates(times);
    expect(best.bpm).toBe(100);
    expect(Math.abs(best.offsetSec - 0.3)).toBeLessThan(0.01); // within the hit tolerance
  });

  it('finds the grid of a triplet feel, and offers its triplet reading', () => {
    const beat = 0.5; // 120 BPM, swung: notes on triplet 8ths 1 and 3
    const starts: number[] = [];
    for (let index = 0; index < 48; index += 1) {
      if (index % 3 !== 1) starts.push((index * beat) / 3);
    }
    const candidates = findTempoCandidates(withEnvelopes(starts));
    const perBeat: Record<string, number> = { '1/4': 1, '1/8': 2, '1/16': 4, '1/8T': 3, '1/16T': 6 };
    const cellOf = (candidate: (typeof candidates)[number]) =>
      60 / candidate.bpm / perBeat[candidate.division];
    // 120 swung = 180 straight 8ths: the SAME lines, 1/6 s apart. The top
    // grid must hold those lines (it may be finer — every other line),
    // under either name…
    const cell = cellOf(candidates[0]);
    const ratio = 1 / 6 / cell;
    expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-3);
    expect([120, 180]).toContain(candidates[0].bpm);
    // …and the 120 BPM triplet reading is offered.
    expect(
      candidates.some((c) => c.bpm === 120 && c.division.endsWith('T')),
    ).toBe(true);
  });

  it('returns nothing for too few events', () => {
    expect(findTempoCandidates([0, 1])).toEqual([]);
  });
});

describe('value grid finder', () => {
  it('reads a melody in Hz as notes, A4 = 440', () => {
    const [best] = findValueGridCandidates([220, 261.63, 293.66, 329.63, 392, 440]);
    expect(best.grid).toEqual({ kind: 'pitch', a4: 440 });
    expect(best.hits).toBe(6);
  });

  it('prefers the coarser of two steps that both fit (gate → 0.05)', () => {
    const [best] = findValueGridCandidates([0, 0.7, 0.85, 0.7, 0]);
    expect(best.grid).toEqual({ kind: 'linear', step: 0.05, origin: 0 });
  });

  it('pad cutoff {250, 1150, 1800} → a step of 50', () => {
    const [best] = findValueGridCandidates([250, 1800, 1150]);
    expect(best.grid).toEqual({ kind: 'linear', step: 50, origin: 0 });
  });

  it('snaps to the nearest note and to the nearest step', () => {
    const pitch = { kind: 'pitch', a4: 440, show: true, snap: true } as const;
    // 452 Hz is 0.47 semitones above A4 → A4; 455 Hz is 0.58 → A♯4.
    expect(snapValue(452, pitch)).toBeCloseTo(440, 9);
    expect(snapValue(455, pitch)).toBeCloseTo(440 * 2 ** (1 / 12), 9);
    const linear = { kind: 'linear', step: 0.05, origin: 0, show: true, snap: true } as const;
    expect(snapValue(0.73, linear)).toBeCloseTo(0.75, 12);
  });
});

describe('value lines', () => {
  it('draws note lines with names and keeps the Cs when thinning', () => {
    const pitch = { kind: 'pitch', a4: 440, show: true, snap: false } as const;
    const lines = buildValueLines(pitch, 200, 900, 160);
    expect(lines.some((line) => line.label === 'C5')).toBe(true);
    expect(lines.every((line, index) => index === 0 || line.v > lines[index - 1].v)).toBe(true);
  });

  it('thins a linear grid that would crowd', () => {
    const linear = { kind: 'linear', step: 1, origin: 0, show: true, snap: false } as const;
    const lines = buildValueLines(linear, 0, 1000, 160);
    const gapPx = ((lines[1].v - lines[0].v) / 1000) * 160;
    expect(gapPx).toBeGreaterThanOrEqual(6);
  });
});
