import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { TimelineTempo } from '../../model/types';
import { barSeconds, beatSeconds, gridOrigin } from './tempo';
import { pixelToTime, timeToPixel } from './timelineView';

export type TimeRulerProps = {
  durationSec: number;
  timeScale: number;
  /** Sorted keyframe times — scrubs snap to the nearest within ~8 px. */
  snapTimes?: readonly number[];
  /** The ruler reads in bars and beats (Q-M3 A). */
  tempo: TimelineTempo;
  onScrub(timeSeconds: number, phase: 'preview' | 'commit'): void;
};

const MAX_TICK_COUNT = 2400;
const SNAP_RADIUS_PX = 8;
/** Bar numbers closer than this skip to every 2nd, 4th, … bar. */
const MIN_BAR_LABEL_SPACING_PX = 36;
/** Beat ticks are drawn only when they are at least this far apart. */
const MIN_BEAT_TICK_SPACING_PX = 8;

/**
 * The ruler doubles as the scrub strip (plan §6): drag anywhere on it moves
 * the playhead — preview per move, commit on release (review EM-22.4), with
 * snap-to-point like the host's scrub (§6 inspiration mapping). Cancel
 * commits the LAST PREVIEWED time — pointercancel coordinates are
 * implementation-defined and can be zeroed (review UI-18). The tick count
 * is capped so absurd durations cannot freeze the tab (review UI-3).
 */
export function TimeRuler({
  durationSec,
  timeScale,
  snapTimes,
  tempo,
  onScrub,
}: TimeRulerProps) {
  const scrubbingRef = useRef(false);
  const lastPreviewTimeRef = useRef(0);

  function snappedTime(rawTime: number): number {
    if (snapTimes === undefined || snapTimes.length === 0) {
      return rawTime;
    }
    const snapRadiusSeconds = SNAP_RADIUS_PX / timeScale;
    let best = rawTime;
    let bestDistance = snapRadiusSeconds;
    for (const candidate of snapTimes) {
      const distance = Math.abs(candidate - rawTime);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  function emitScrub(
    event: ReactPointerEvent<HTMLDivElement>,
    phase: 'preview' | 'commit',
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    const rawTime = pixelToTime(event.clientX - rect.left, timeScale);
    const clamped = Math.min(Math.max(rawTime, 0), durationSec);
    const snapped = snappedTime(clamped);
    lastPreviewTimeRef.current = snapped;
    onScrub(snapped, phase);
  }

  // Bar numbers, thinned to every 2nd/4th/… bar when they would crowd.
  const bar = barSeconds(tempo);
  let barsPerLabel = 1;
  while (
    barsPerLabel * bar * timeScale < MIN_BAR_LABEL_SPACING_PX ||
    durationSec / (barsPerLabel * bar) > MAX_TICK_COUNT
  ) {
    barsPerLabel *= 2;
  }
  // Bars count from the grid origin; a pickup before it reads 0, −1, …
  const origin = gridOrigin(tempo);
  const barTicks: { t: number; label: number }[] = [];
  const firstBar =
    Math.ceil((0 - origin) / (bar * barsPerLabel) - 1e-9) * barsPerLabel;
  for (let barIndex = firstBar; ; barIndex += barsPerLabel) {
    const t = origin + barIndex * bar;
    if (t > durationSec + 1e-9) break;
    barTicks.push({ t, label: barIndex + 1 });
  }
  // Short beat ticks between them, when there is room.
  const beat = beatSeconds(tempo);
  const beatTicks: number[] = [];
  if (
    beat * timeScale >= MIN_BEAT_TICK_SPACING_PX &&
    durationSec / beat <= MAX_TICK_COUNT
  ) {
    const firstBeat = Math.ceil((0 - origin) / beat - 1e-9);
    for (let index = firstBeat; ; index += 1) {
      const t = origin + index * beat;
      if (t >= durationSec) break;
      if (
        t > 0 &&
        ((index % tempo.beatsPerBar) + tempo.beatsPerBar) %
          tempo.beatsPerBar !==
          0
      ) {
        beatTicks.push(t);
      }
    }
  }

  return (
    <div
      data-rbnt-ruler="true"
      className="rbnt:relative rbnt:box-border rbnt:h-[30px] rbnt:cursor-ew-resize rbnt:touch-none rbnt:border-b rbnt:border-secondary-dark-gray rbnt:bg-secondary-black rbnt:select-none"
      style={{ width: timeToPixel(durationSec, timeScale) }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        scrubbingRef.current = true;
        emitScrub(event, 'preview');
      }}
      onPointerMove={(event) => {
        if (scrubbingRef.current) {
          emitScrub(event, 'preview');
        }
      }}
      onPointerUp={(event) => {
        if (!scrubbingRef.current) {
          return;
        }
        scrubbingRef.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        emitScrub(event, 'commit');
      }}
      onPointerCancel={() => {
        if (scrubbingRef.current) {
          scrubbingRef.current = false;
          onScrub(lastPreviewTimeRef.current, 'commit');
        }
      }}
    >
      {barTicks.map((tick) => (
        <div
          key={`bar-${tick.label}`}
          className="rbnt:pointer-events-none rbnt:absolute rbnt:top-0 rbnt:bottom-0 rbnt:border-l rbnt:border-secondary-light-gray/50"
          style={{ left: timeToPixel(tick.t, timeScale) }}
        >
          <span className="rbnt:absolute rbnt:top-1 rbnt:left-1 rbnt:font-mono rbnt:text-[10px] rbnt:text-tl-dim">
            {tick.label}
          </span>
        </div>
      ))}
      {beatTicks.map((tickTime) => (
        <div
          key={`beat-${tickTime}`}
          className="rbnt:pointer-events-none rbnt:absolute rbnt:bottom-0 rbnt:h-2 rbnt:border-l rbnt:border-secondary-dark-gray"
          style={{ left: timeToPixel(tickTime, timeScale) }}
        />
      ))}
    </div>
  );
}
