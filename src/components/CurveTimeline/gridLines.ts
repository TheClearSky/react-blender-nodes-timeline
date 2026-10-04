/**
 * Grid lines, pure. Lines too close to read are thinned level by level, so a
 * zoomed-out view never turns into a grey wash (and counts stay bounded).
 *
 * - Time (Q-M3 A): subdivisions, beats, bars — from the tempo's origin.
 * - Values (Q-F2 A): a lane's horizontal grid — evenly spaced, or musical
 *   notes (12-tone equal temperament) for lanes of frequencies.
 */
import type { TimelineTempo, ValueGrid } from '../../model/types';
import { barSeconds, beatSeconds, gridOrigin } from './tempo';

export type GridLine = {
  readonly t: number;
  /** 0 subdivision, 1 beat, 2 bar. */
  readonly strength: 0 | 1 | 2;
};

/** Lines closer than this (CSS px) are dropped. */
export const MIN_GRID_SPACING_PX = 6;
const MAX_GRID_LINES = 4000;

export function buildGridLines(
  durationSec: number,
  tempo: TimelineTempo,
  cellSec: number,
  pxPerSecond: number,
): GridLine[] {
  const beat = beatSeconds(tempo);
  const bar = barSeconds(tempo);
  const origin = gridOrigin(tempo);
  // The finest level that is still readable.
  let step = cellSec;
  if (step * pxPerSecond < MIN_GRID_SPACING_PX) step = Math.max(step, beat);
  if (step * pxPerSecond < MIN_GRID_SPACING_PX) step = Math.max(step, bar);
  while (
    step * pxPerSecond < MIN_GRID_SPACING_PX ||
    durationSec / step > MAX_GRID_LINES
  ) {
    step *= 2;
  }
  const lines: GridLine[] = [];
  const first = Math.ceil((0 - origin) / step - 1e-9);
  for (let index = first; ; index += 1) {
    const t = origin + index * step;
    if (t > durationSec + 1e-9) break;
    const fromOrigin = t - origin;
    const onBar = isMultiple(fromOrigin, bar);
    const onBeat = onBar || isMultiple(fromOrigin, beat);
    lines.push({ t, strength: onBar ? 2 : onBeat ? 1 : 0 });
  }
  return lines;
}

function isMultiple(value: number, unit: number): boolean {
  const ratio = value / unit;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}

// ── values ───────────────────────────────────────────────────────────────

export type ValueLine = {
  readonly v: number;
  /** 0 minor, 1 major (every 5th step / every C). */
  readonly strength: 0 | 1;
  /** Shown at the lane's left edge when there is room (note names). */
  readonly label?: string;
};

const MAX_VALUE_LINES = 400;
const NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
];

/** MIDI note number → frequency around `a4` (A4 = MIDI 69). */
export function noteFrequency(midi: number, a4: number): number {
  return a4 * 2 ** ((midi - 69) / 12);
}

export function noteName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${Math.floor(midi / 12) - 1}`;
}

/** The nearest value on a lane's grid. */
export function snapValue(value: number, grid: ValueGrid): number {
  if (grid.kind === 'linear') {
    return (
      grid.origin + Math.round((value - grid.origin) / grid.step) * grid.step
    );
  }
  if (!(value > 0)) return value;
  const midi = Math.round(69 + 12 * Math.log2(value / grid.a4));
  return noteFrequency(midi, grid.a4);
}

/**
 * Horizontal lines inside [min, max], thinned so neighbours stay at least
 * MIN_GRID_SPACING_PX apart on a lane `laneHeightPx` tall.
 */
export function buildValueLines(
  grid: ValueGrid,
  min: number,
  max: number,
  laneHeightPx: number,
): ValueLine[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const pxPerUnit = laneHeightPx / span;
  if (grid.kind === 'linear') {
    let every = 1;
    while (
      grid.step * every * pxPerUnit < MIN_GRID_SPACING_PX ||
      span / (grid.step * every) > MAX_VALUE_LINES
    ) {
      every *= 2;
    }
    const step = grid.step * every;
    const lines: ValueLine[] = [];
    const first = Math.ceil((min - grid.origin) / step - 1e-9);
    for (let index = first; ; index += 1) {
      const v = grid.origin + index * step;
      if (v > max + 1e-9) break;
      const unitIndex = Math.round((v - grid.origin) / grid.step);
      lines.push({ v, strength: unitIndex % 5 === 0 ? 1 : 0 });
    }
    return lines;
  }
  // Pitch: every semitone, or only the Cs when semitones would crowd.
  const low = Math.max(min, 1e-3);
  if (!(max > low)) return [];
  const firstMidi = Math.ceil(69 + 12 * Math.log2(low / grid.a4) - 1e-9);
  const lastMidi = Math.floor(69 + 12 * Math.log2(max / grid.a4) + 1e-9);
  const lines: ValueLine[] = [];
  for (
    let midi = firstMidi;
    midi <= lastMidi && lines.length < MAX_VALUE_LINES;
    midi += 1
  ) {
    lines.push({
      v: noteFrequency(midi, grid.a4),
      strength: ((midi % 12) + 12) % 12 === 0 ? 1 : 0,
      label: noteName(midi),
    });
  }
  // Semitones crowd at the low end (their Hz spacing grows with pitch), so
  // thin line by line from the bottom up; the Cs always stay.
  const kept: ValueLine[] = [];
  let lastPx = -Infinity;
  for (const line of lines) {
    const px = (line.v - min) * pxPerUnit;
    if (line.strength === 1 || px - lastPx >= MIN_GRID_SPACING_PX) {
      kept.push(line);
      lastPx = px;
    }
  }
  return kept;
}
