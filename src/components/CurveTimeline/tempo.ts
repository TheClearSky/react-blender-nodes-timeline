/**
 * Musical time for the editor (plan `timeline-midi-mode.md`, Q-M3 A): the
 * grid is always musical — a document without a tempo reads as 120 BPM 4/4
 * — and a beat is a quarter note. The grid starts at `tempo.offsetSec`
 * (plan `timeline-grid-finder.md`, Q-F1 A). Pure; the document keeps seconds.
 */
import { DEFAULT_TEMPO } from '../../model/types';
import type { TimelineDocument, TimelineTempo } from '../../model/types';

export const gridDivisions = [
  'bar',
  '1/2',
  '1/4',
  '1/8',
  '1/16',
  '1/8T',
  '1/16T',
] as const;
export type GridDivision = (typeof gridDivisions)[number];

export const GRID_DIVISION_LABELS: Record<GridDivision, string> = {
  bar: '1 bar',
  '1/2': '1/2',
  '1/4': '1/4',
  '1/8': '1/8',
  '1/16': '1/16',
  '1/8T': '1/8 triplet',
  '1/16T': '1/16 triplet',
};

/** Cells in one beat for each division below a beat. */
const CELLS_PER_BEAT: Partial<Record<GridDivision, number>> = {
  '1/4': 1,
  '1/8': 2,
  '1/16': 4,
  '1/8T': 3,
  '1/16T': 6,
};

export function tempoOf(document: TimelineDocument): TimelineTempo {
  return document.tempo ?? DEFAULT_TEMPO;
}

/** Where bar 1 beat 1 sits, in seconds. */
export function gridOrigin(tempo: TimelineTempo): number {
  return tempo.offsetSec ?? 0;
}

export function beatSeconds(tempo: TimelineTempo): number {
  return 60 / tempo.bpm;
}

export function barSeconds(tempo: TimelineTempo): number {
  return beatSeconds(tempo) * tempo.beatsPerBar;
}

/** Length of one grid cell in seconds. */
export function cellSeconds(
  tempo: TimelineTempo,
  division: GridDivision,
): number {
  const beat = beatSeconds(tempo);
  if (division === 'bar') return beat * tempo.beatsPerBar;
  if (division === '1/2') return beat * 2;
  return beat / (CELLS_PER_BEAT[division] ?? 1);
}

/** Cells per beat of a division (a bar or half note counts as < 1). */
export function cellsPerBeat(
  tempo: TimelineTempo,
  division: GridDivision,
): number {
  return beatSeconds(tempo) / cellSeconds(tempo, division);
}

/** Nearest grid line of a grid starting at `origin`. */
export function snapToGrid(
  timeSeconds: number,
  cellSec: number,
  origin = 0,
): number {
  if (!(cellSec > 0)) return timeSeconds;
  return origin + Math.round((timeSeconds - origin) / cellSec) * cellSec;
}

/** `bar.beat`, both 1-based, from the grid origin: 2.0 s at 120 BPM 4/4 →
 *  "2.1". Before the origin (a pickup) bars count 0, −1, … */
export function formatBarsBeats(
  timeSeconds: number,
  tempo: TimelineTempo,
): string {
  // A hair of tolerance so 1.9999999 (float) still reads as the next beat.
  const beats = Math.floor(
    (timeSeconds - gridOrigin(tempo)) / beatSeconds(tempo) + 1e-6,
  );
  const bar = Math.floor(beats / tempo.beatsPerBar) + 1;
  const beat =
    (((beats % tempo.beatsPerBar) + tempo.beatsPerBar) % tempo.beatsPerBar) + 1;
  return `${bar}.${beat}`;
}

export function barsInDuration(
  durationSec: number,
  tempo: TimelineTempo,
): number {
  return durationSec / barSeconds(tempo);
}

/**
 * The starts of the grid cells covering [0, durationSec): a partial first
 * cell from 0 when the grid starts later, then every line. For bars lanes.
 */
export function cellStarts(
  durationSec: number,
  cellSec: number,
  origin: number,
  minGap: number,
): number[] {
  const starts = [0];
  const first = Math.ceil((0 - origin) / cellSec - 1e-9);
  for (let index = first; ; index += 1) {
    const t = origin + index * cellSec;
    if (t > durationSec - minGap) break;
    if (t >= minGap) starts.push(t);
  }
  return starts;
}
