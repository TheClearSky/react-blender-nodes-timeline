import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { pixelToTime, rulerStepSeconds, timeToPixel } from './timelineView';

export type TimeRulerProps = {
  durationSec: number;
  timeScale: number;
  /** Sorted keyframe times — scrubs snap to the nearest within ~8 px. */
  snapTimes?: readonly number[];
  onScrub(timeSeconds: number, phase: 'preview' | 'commit'): void;
};

const MAX_TICK_COUNT = 2400;
const SNAP_RADIUS_PX = 8;

function formatTickLabel(timeSeconds: number): string {
  return `${Number(timeSeconds.toFixed(2))}s`;
}

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

  let stepSeconds = rulerStepSeconds(timeScale);
  while (durationSec / stepSeconds > MAX_TICK_COUNT) {
    stepSeconds *= 2;
  }
  const ticks: number[] = [];
  for (
    let tickIndex = 0;
    tickIndex * stepSeconds <= durationSec + 1e-9;
    tickIndex += 1
  ) {
    ticks.push(tickIndex * stepSeconds);
  }

  return (
    <div
      className="rbnt-tl-ruler"
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
      {ticks.map((tickTime) => (
        <div
          key={tickTime}
          className="rbnt-tl-tick"
          style={{ left: timeToPixel(tickTime, timeScale) }}
        >
          <span>{formatTickLabel(tickTime)}</span>
        </div>
      ))}
    </div>
  );
}
