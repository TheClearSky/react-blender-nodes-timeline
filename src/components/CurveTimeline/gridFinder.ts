/**
 * The Grid finder (plan `timeline-grid-finder.md`, Q-F1 A / Q-F2 A). Pure.
 *
 * TIME — what the data shows is a PULSE: a gap many events land on. Every
 * pulse from 60 ms to 1.5 s is scored by how many events sit on it beyond
 * chance (a z-score, the best phase found by circular mean), then read as
 * tempos in quarters, 8ths, 16ths and triplets. A tempo is ranked by the
 * AGREEMENT of all pulses that read as it — measured on the demos, a
 * syncopated figure (bellClub's 3+3+2) makes single-pulse ranking pick an
 * alias (199 for 133), while the 75 ms, 227 ms and 902 ms pulses all agree
 * on 133.
 *
 * VALUES — a lane's distinct values fit either musical notes (12-tone equal
 * temperament around a found A4) or an evenly spaced "nice" step.
 *
 * Nothing here is certain; the modal shows the evidence and the user picks.
 */
import type { TimelineDocument } from '../../model/types';
import type { GridDivision } from './tempo';

// ── time ─────────────────────────────────────────────────────────────────

export type TempoCandidate = {
  readonly bpm: number;
  readonly division: GridDivision;
  /** Where the grid starts (a beat line), in [0, one beat). */
  readonly offsetSec: number;
  /** 0–1, relative to the best candidate. */
  readonly confidence: number;
  /** Events on this exact grid, of all events looked at. */
  readonly hits: number;
  readonly total: number;
};

const READINGS: readonly (readonly [GridDivision, number])[] = [
  ['1/4', 1],
  ['1/8', 2],
  ['1/16', 4],
  ['1/8T', 3],
  ['1/16T', 6],
];

const MIN_PULSE_SEC = 0.06;
const MAX_PULSE_SEC = 1.5;
const MAX_EVENTS = 4000;

/**
 * Gentle priors, as beat trackers use: with equal evidence a musician names
 * 133 over its dotted-quarter reading 88.65, and a straight division over a
 * triplet one. Both stay in the list; only the order changes.
 */
function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / 120) / 0.8;
  return Math.exp(-0.5 * octaves * octaves);
}
function divisionPrior(division: GridDivision): number {
  return division.endsWith('T') ? 0.85 : 1;
}

/** An event counts as "on the grid" within this many seconds of a line. */
export function hitTolerance(cellSec: number): number {
  return Math.min(0.01, cellSec * 0.06);
}

/** Points closer than this are one musical event (a note's pre-point, hit
 *  and attack peak sit 10–12 ms apart). */
export const ONSET_MERGE_SEC = 0.025;

/**
 * The note STARTS of the chosen lanes (all when `curveIds` is absent): every
 * point time, with points closer than ONSET_MERGE_SEC merged into one event
 * at the earliest. Counting each point separately let a tempo a hair off
 * (119.97 for 120) "win" by drifting across a note's sub-points over the
 * piece — measured on curveOrchestra.
 */
export function collectEventTimes(
  document: TimelineDocument,
  curveIds?: readonly string[],
): number[] {
  const wanted = curveIds === undefined ? null : new Set(curveIds);
  const times: number[] = [];
  for (const curve of document.curves) {
    if (wanted !== null && !wanted.has(curve.id)) continue;
    for (const point of curve.points) times.push(point.t);
  }
  return mergeIntoOnsets(times);
}

/** Sorted onsets: runs of times each within ONSET_MERGE_SEC of the run's
 *  first become that first time. */
export function mergeIntoOnsets(times: readonly number[]): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  const onsets: number[] = [];
  for (const t of sorted) {
    const last = onsets[onsets.length - 1];
    if (last === undefined || t - last > ONSET_MERGE_SEC) onsets.push(t);
  }
  return onsets;
}

/** Events within tolerance of the grid origin + k·cell. */
export function countHits(
  times: readonly number[],
  cellSec: number,
  origin: number,
): number {
  const tolerance = hitTolerance(cellSec);
  let hits = 0;
  for (const t of times) {
    const offset = t - origin;
    // The epsilon: the exact scorer centres the grid in a window exactly
    // 2·tolerance wide, so its edge events sit at exactly ±tolerance — and
    // float rounding dropped them (measured: 58 counted of 96 in the window).
    if (
      Math.abs(offset - Math.round(offset / cellSec) * cellSec) <=
      tolerance + 1e-9
    ) {
      hits += 1;
    }
  }
  return hits;
}

type Pulse = { cell: number; phase: number; z: number };

/**
 * How well a pulse of `cell` seconds explains the events, and where its lines
 * sit. The phase is the tolerance-wide window holding the MOST events (a fine
 * histogram of each event's position within the cell, swept once) — not the
 * circular mean, which the envelope points after every note dragged late
 * (0.3 s notes with points at +12/+90 ms → 0.334 s), so the lines missed the
 * very notes they should hold (measured).
 */
function scorePulse(times: readonly number[], cell: number): Pulse {
  const tolerance = hitTolerance(cell);
  const binsPerWindow = 4;
  const bins = Math.max(
    binsPerWindow * 2,
    Math.round((cell / (2 * tolerance)) * binsPerWindow),
  );
  const binWidth = cell / bins;
  const residues = new Float64Array(times.length);
  const counts = new Uint32Array(bins);
  times.forEach((t, index) => {
    let residue = t % cell;
    if (residue < 0) residue += cell;
    // Float wrap: an event exactly on a line can come out as 0.1249999…
    if (cell - residue < 1e-9) residue = 0;
    residues[index] = residue;
    counts[Math.min(bins - 1, Math.floor(residue / binWidth))] += 1;
  });
  let windowCount = 0;
  for (let bin = 0; bin < binsPerWindow; bin += 1) windowCount += counts[bin];
  let bestCount = windowCount;
  let bestStart = 0;
  for (let start = 1; start < bins; start += 1) {
    windowCount +=
      counts[(start + binsPerWindow - 1) % bins] - counts[start - 1];
    if (windowCount > bestCount) {
      bestCount = windowCount;
      bestStart = start;
    }
  }
  // Centre the lines between the earliest and latest event of the winning
  // window (circularly, from its start), so a note and its attack point 12 ms
  // later both sit inside the tolerance.
  const windowStart = bestStart * binWidth;
  const windowWidth = binsPerWindow * binWidth;
  let earliest = Infinity;
  let latest = -Infinity;
  for (const residue of residues) {
    let fromStart = residue - windowStart;
    if (fromStart < 0) fromStart += cell;
    if (fromStart < windowWidth) {
      earliest = Math.min(earliest, fromStart);
      latest = Math.max(latest, fromStart);
    }
  }
  const centre = Number.isFinite(earliest)
    ? (earliest + latest) / 2
    : windowWidth / 2;
  const phase = (windowStart + centre) % cell;
  const hits = countHits(times, cell, phase);
  const total = times.length;
  const chance = (2 * tolerance) / cell;
  const z = (hits - total * chance) / Math.sqrt(total * chance * (1 - chance));
  return { cell, phase, z };
}

/**
 * The same score, EXACT: the events' positions within the cell, sorted, with
 * a window 2·tolerance wide slid over them — the true best window, no bins.
 * The histogram's bin edges could split a note and its attack point exactly
 * on a round tempo (measured: curveOrchestra at exactly 120 lost its 1/16
 * rung to 119.97). Costs a sort, so it judges finalists, not the scan.
 */
function scorePulseExact(times: readonly number[], cell: number): Pulse {
  const tolerance = hitTolerance(cell);
  const residues = times
    .map((t) => {
      let residue = t % cell;
      if (residue < 0) residue += cell;
      return cell - residue < 1e-9 ? 0 : residue;
    })
    .sort((a, b) => a - b);
  const count = residues.length;
  // Unrolled circle: every residue again at +cell, for windows that wrap.
  const unrolled = residues.concat(residues.map((residue) => residue + cell));
  let bestCount = 0;
  let bestStart = 0;
  let end = 0;
  for (let start = 0; start < count; start += 1) {
    if (end < start) end = start;
    while (
      end + 1 < start + count &&
      unrolled[end + 1] - unrolled[start] <= 2 * tolerance
    ) {
      end += 1;
    }
    if (end - start + 1 > bestCount) {
      bestCount = end - start + 1;
      bestStart = start;
    }
  }
  const earliest = unrolled[bestStart];
  const latest = unrolled[bestStart + bestCount - 1];
  const phase = ((earliest + latest) / 2) % cell;
  const hits = countHits(times, cell, phase);
  const chance = (2 * tolerance) / cell;
  const z = (hits - count * chance) / Math.sqrt(count * chance * (1 - chance));
  return { cell, phase, z };
}

/**
 * Scan pulse FREQUENCIES. A pulse only lines up across the whole piece if its
 * length is right to within tolerance ÷ duration — over 20 s a 600 ms pulse
 * must be within 0.05 % — so the step is a quarter of that peak width
 * (1 / 4·span in Hz). A fixed relative step (0.25 %) stepped straight over
 * the narrow peaks of long pulses (measured: a plain 100 BPM lost).
 */
function findPulses(times: readonly number[]): Pulse[] {
  const span = Math.max(times[times.length - 1] - times[0], MAX_PULSE_SEC);
  const frequencyStep = 1 / (4 * span);
  const coarse: Pulse[] = [];
  for (
    let frequency = 1 / MAX_PULSE_SEC;
    frequency <= 1 / MIN_PULSE_SEC;
    frequency += frequencyStep
  ) {
    coarse.push(scorePulse(times, 1 / frequency));
  }
  // Local maxima within ±1.5 % of the frequency, then refined between the
  // neighbouring coarse steps.
  const peaks = coarse.filter((pulse, index) => {
    if (pulse.z < 2) return false;
    const reach = Math.max(2, Math.round(0.015 / pulse.cell / frequencyStep));
    for (let other = index - reach; other <= index + reach; other += 1) {
      if (
        other !== index &&
        coarse[other] !== undefined &&
        coarse[other].z > pulse.z
      ) {
        return false;
      }
    }
    return true;
  });
  peaks.sort((a, b) => b.z - a.z);
  return peaks.slice(0, 16).map((peak) => {
    let best = peak;
    const frequency = 1 / peak.cell;
    for (let step = -10; step <= 10; step += 1) {
      const candidate = scorePulse(
        times,
        1 / (frequency + (step * frequencyStep) / 10),
      );
      if (candidate.z > best.z) best = candidate;
    }
    return best;
  });
}

function cellOf(bpm: number, perBeat: number): number {
  return 60 / bpm / perBeat;
}

/**
 * Put the grid's origin on the most likely BEAT: the pulse only fixes the
 * phase modulo one cell, so try each cell inside a beat and keep the one
 * with the most events on beat lines. Snapped to 0 when within tolerance.
 */
function beatOrigin(
  times: readonly number[],
  bpm: number,
  perBeat: number,
  phase: number,
): number {
  const beat = 60 / bpm;
  const cell = beat / perBeat;
  let best = phase % cell;
  let bestHits = -1;
  const shifts = Math.max(1, Math.round(perBeat));
  for (let shift = 0; shift < shifts; shift += 1) {
    const origin = ((phase % cell) + shift * cell) % beat;
    const hits = countHits(times, beat, origin);
    if (hits > bestHits) {
      bestHits = hits;
      best = origin;
    }
  }
  const tolerance = hitTolerance(cell);
  if (best < tolerance || beat - best < tolerance) return 0;
  return best;
}

export function findTempoCandidates(
  allTimes: readonly number[],
  options: { minBpm?: number; maxBpm?: number; limit?: number } = {},
): TempoCandidate[] {
  const minBpm = options.minBpm ?? 40;
  const maxBpm = options.maxBpm ?? 240;
  const limit = options.limit ?? 8;
  // Note starts, whoever calls (merging is idempotent), then evenly thinned
  // past MAX_EVENTS: the score is statistical, the cost is not.
  const onsets = mergeIntoOnsets(allTimes);
  const stride = Math.ceil(onsets.length / MAX_EVENTS);
  const times =
    stride > 1 ? onsets.filter((_, index) => index % stride === 0) : onsets;
  if (times.length < 4) return [];

  type Reading = {
    bpm: number;
    division: GridDivision;
    perBeat: number;
    pulse: Pulse;
  };
  const readings: Reading[] = [];
  findPulses(times).forEach((pulse) => {
    for (const [division, perBeat] of READINGS) {
      const bpm = 60 / (pulse.cell * perBeat);
      if (bpm >= minBpm && bpm <= maxBpm)
        readings.push({ bpm, division, perBeat, pulse });
    }
  });
  if (readings.length === 0) return [];

  // Candidate tempos: every reading, clustered within 0.5 %.
  readings.sort((a, b) => a.bpm - b.bpm);
  const clusters: Reading[][] = [];
  for (const reading of readings) {
    const current = clusters[clusters.length - 1];
    if (current !== undefined && reading.bpm / current[0].bpm < 1.005)
      current.push(reading);
    else clusters.push([reading]);
  }
  const seeds = clusters.map((cluster) => {
    const lead = cluster.reduce((a, b) => (b.pulse.z > a.pulse.z ? b : a));
    return lead.bpm;
  });

  // Rank each by its whole ladder, keep the best dozen, then refine those.
  const first = seeds
    .map((bpm) => ladderAt(times, bpm))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const refined = first.map((seed) => {
    let fast = seed;
    for (let step = -10; step <= 10; step += 1) {
      const candidate = ladderAt(times, seed.bpm * (1 + step * 0.0003));
      if (candidate.score > fast.score) fast = candidate;
    }
    let best = ladderAt(times, fast.bpm, true);
    // A round tempo wins when it holds nearly as many events ON THE SAME RUNG.
    // Near-round tempos can "win" by drifting across clustered events (a note
    // with points 10 ms before and 12 ms after it: over 16 s, 119.97 caught
    // one pair early and the other late) — an artifact, and real music is
    // almost always at a round tempo. So within 0.1 % the bar is lower.
    for (const nice of [
      Math.round(best.bpm),
      Math.round(best.bpm * 2) / 2,
      Math.round(best.bpm * 10) / 10,
    ]) {
      const distance = Math.abs(nice - best.bpm) / best.bpm;
      if (distance > 0.004) continue;
      const same = rungHits(times, nice, best.perBeat);
      const needed = distance <= 0.001 ? 0.8 : 0.95;
      if (same.hits >= best.hits * needed) {
        best = { ...best, bpm: nice, phase: same.phase, hits: same.hits };
        break;
      }
    }
    return best;
  });
  // Refining can land two seeds on one tempo: keep the better.
  refined.sort((a, b) => b.score - a.score);
  const distinct: Ladder[] = [];
  for (const ladder of refined) {
    if (
      distinct.every(
        (kept) => Math.abs(kept.bpm - ladder.bpm) / ladder.bpm > 0.003,
      )
    ) {
      distinct.push(ladder);
    }
  }
  const bestScore = distinct[0]?.score ?? 0;
  if (!(bestScore > 0)) return [];
  const results: TempoCandidate[] = [];
  const offered = (bpm: number) =>
    results.some((result) => Math.abs(result.bpm - bpm) < 1e-6);
  for (const [rank, ladder] of distinct.slice(0, limit).entries()) {
    results.push({
      bpm: ladder.bpm,
      division: ladder.division,
      offsetSec: beatOrigin(times, ladder.bpm, ladder.perBeat, ladder.phase),
      confidence: ladder.score / bestScore,
      hits: ladder.hits,
      total: times.length,
    });
    // A near-round tempo the round check turned down still gets its round
    // neighbour offered right after it — same rung, its own count — so the
    // user can compare them in the preview (curveOrchestra: 119.97 vs 120).
    const round = Math.round(ladder.bpm);
    if (
      rank < 3 &&
      round !== ladder.bpm &&
      Math.abs(round - ladder.bpm) / ladder.bpm <= 0.002 &&
      !offered(round)
    ) {
      const same = rungHits(times, round, ladder.perBeat);
      results.push({
        bpm: round,
        division: ladder.division,
        offsetSec: beatOrigin(times, round, ladder.perBeat, same.phase),
        confidence:
          (ladder.score / bestScore) * (same.hits / Math.max(1, ladder.hits)),
        hits: same.hits,
        total: times.length,
      });
    }
  }
  return results.slice(0, limit);
}

/**
 * A tempo's evidence is its whole metrical LADDER, not one pulse: at the true
 * tempo, quarters, 8ths and 16ths (or the triplet ladder) are all populated;
 * at an alias one rung carries everything and the rest are near empty.
 * Measured on synthetic 120 BPM material with envelope points: judged by one
 * pulse, a 1/16-triplet reading (56/144 events) edged out 120's own 16ths
 * (48/144); by the ladder, 120 wins clearly.
 */
type Ladder = {
  bpm: number;
  score: number;
  /** The rung that fits best — the division offered to the user. */
  division: GridDivision;
  perBeat: number;
  phase: number;
  hits: number;
};

const LADDERS: readonly (readonly (readonly [GridDivision, number])[])[] = [
  [
    ['1/4', 1],
    ['1/8', 2],
    ['1/16', 4],
  ],
  [
    ['1/4', 1],
    ['1/8T', 3],
    ['1/16T', 6],
  ],
];

function ladderAt(
  times: readonly number[],
  bpm: number,
  exact = false,
): Ladder {
  const score = exact ? scorePulseExact : scorePulse;
  let best: Ladder | null = null;
  for (const rungs of LADDERS) {
    let sum = 0;
    const scored = rungs.map(([division, perBeat]) => {
      const pulse = score(times, cellOf(bpm, perBeat));
      sum += Math.max(0, pulse.z);
      return {
        division,
        perBeat,
        pulse,
        hits: countHits(times, cellOf(bpm, perBeat), pulse.phase),
      };
    });
    // Offer the rung the user would snap to: the one holding the most events
    // among the clearly significant rungs (ties → the coarser); the z-best
    // rung favoured sparse coarse grids (measured: a swing feel read as 1/8).
    const significant = scored.filter((rung) => rung.pulse.z >= 3);
    const pool = significant.length > 0 ? significant : scored;
    const top = pool.reduce((a, b) => (b.hits > a.hits ? b : a));
    const total = sum * tempoPrior(bpm) * divisionPrior(top.division);
    if (best === null || total > best.score) {
      best = {
        bpm,
        score: total,
        division: top.division,
        perBeat: top.perBeat,
        phase: top.pulse.phase,
        hits: top.hits,
      };
    }
  }
  return best as Ladder;
}

/** Events on one rung of a tempo, judged exactly. */
function rungHits(times: readonly number[], bpm: number, perBeat: number) {
  const cell = cellOf(bpm, perBeat);
  const pulse = scorePulseExact(times, cell);
  return { phase: pulse.phase, hits: countHits(times, cell, pulse.phase) };
}

// ── values ───────────────────────────────────────────────────────────────

export type ValueGridShape =
  | { readonly kind: 'linear'; readonly step: number; readonly origin: number }
  | { readonly kind: 'pitch'; readonly a4: number };

export type ValueGridCandidate = {
  readonly grid: ValueGridShape;
  readonly confidence: number;
  readonly hits: number;
  readonly total: number;
};

/** A value is on a note within this many cents. */
const PITCH_TOLERANCE_CENTS = 8;
/** …and on a linear step within this fraction of the step. */
const LINEAR_TOLERANCE = 0.04;

export function isOnValueGrid(value: number, grid: ValueGridShape): boolean {
  if (grid.kind === 'pitch') {
    if (!(value > 0)) return false;
    const semitones = 12 * Math.log2(value / grid.a4);
    return (
      Math.abs(semitones - Math.round(semitones)) * 100 <= PITCH_TOLERANCE_CENTS
    );
  }
  const offset = value - grid.origin;
  return (
    Math.abs(offset - Math.round(offset / grid.step) * grid.step) <=
    grid.step * LINEAR_TOLERANCE
  );
}

function zScore(hits: number, total: number, chance: number): number {
  return (hits - total * chance) / Math.sqrt(total * chance * (1 - chance));
}

export function findValueGridCandidates(
  allValues: readonly number[],
  options: { limit?: number } = {},
): ValueGridCandidate[] {
  const values = [...new Set(allValues.map((v) => Math.round(v * 1e6) / 1e6))];
  if (values.length < 2) return [];
  const found: { grid: ValueGridShape; hits: number; z: number }[] = [];

  // Notes: find the tuning (A4 within ±50 cents of 440) that fits most values;
  // among equal fits, the one nearest 440.
  const positive = values.filter((v) => v > 0);
  if (positive.length >= 2) {
    let best = { hits: -1, cents: 0 };
    for (let cents = -50; cents < 50; cents += 1) {
      const a4 = 440 * 2 ** (cents / 1200);
      const hits = positive.filter((v) =>
        isOnValueGrid(v, { kind: 'pitch', a4 }),
      ).length;
      if (
        hits > best.hits ||
        (hits === best.hits && Math.abs(cents) < Math.abs(best.cents))
      ) {
        best = { hits, cents };
      }
    }
    const a4 = Math.round(440 * 2 ** (best.cents / 1200) * 10) / 10;
    const hits = values.filter((v) =>
      isOnValueGrid(v, { kind: 'pitch', a4 }),
    ).length;
    found.push({
      grid: { kind: 'pitch', a4 },
      hits,
      z: zScore(hits, values.length, (2 * PITCH_TOLERANCE_CENTS) / 100),
    });
  }

  // Evenly spaced: "nice" steps (1, 2, 2.5, 5 × 10^k) between span/64 and span/1.5.
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  for (let exponent = -6; exponent <= 6 && span > 0; exponent += 1) {
    for (const mantissa of [1, 2, 2.5, 5]) {
      const step = mantissa * 10 ** exponent;
      if (step < span / 64 || step > span / 1.5) continue;
      let cosSum = 0;
      let sinSum = 0;
      for (const v of values) {
        const angle = (2 * Math.PI * v) / step;
        cosSum += Math.cos(angle);
        sinSum += Math.sin(angle);
      }
      let origin = (Math.atan2(sinSum, cosSum) / (2 * Math.PI)) * step;
      if (origin < 0) origin += step;
      // A grid through 0 when that is as good as the fitted phase.
      if (
        origin < step * LINEAR_TOLERANCE ||
        step - origin < step * LINEAR_TOLERANCE
      ) {
        origin = 0;
      }
      origin = Number(origin.toPrecision(6));
      const grid: ValueGridShape = { kind: 'linear', step, origin };
      const hits = values.filter((v) => isOnValueGrid(v, grid)).length;
      found.push({
        grid,
        hits,
        z: zScore(hits, values.length, 2 * LINEAR_TOLERANCE),
      });
    }
  }
  // Best first; equal fits prefer notes, then the COARSER step (0.05 over
  // 0.025 when both fit every value).
  found.sort((a, b) => {
    if (b.z !== a.z) return b.z - a.z;
    if (a.grid.kind !== b.grid.kind) return a.grid.kind === 'pitch' ? -1 : 1;
    const stepA = a.grid.kind === 'linear' ? a.grid.step : 0;
    const stepB = b.grid.kind === 'linear' ? b.grid.step : 0;
    return stepB - stepA;
  });
  const useful = found.filter((entry) => entry.z > 0);
  if (useful.length === 0) return [];
  const bestZ = useful[0].z;
  return useful.slice(0, options.limit ?? 6).map((entry) => ({
    grid: entry.grid,
    confidence: entry.z / bestZ,
    hits: entry.hits,
    total: values.length,
  }));
}
