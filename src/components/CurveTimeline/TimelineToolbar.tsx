import type { TimelineDocument } from '../../model/types';
import type { TransportState } from '../../transport/transport';
import { NumberField } from './NumberField';

export type TimelineToolbarProps = {
  document: TimelineDocument;
  transportState: TransportState | null;
  playheadTime: number;
  onPlay(): void;
  onPause(): void;
  onStop(): void;
  onToggleLoop(): void;
  onSetDuration(nextDurationSec: number): void;
  onAddCurve(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
};

export function TimelineToolbar({
  document,
  transportState,
  playheadTime,
  onPlay,
  onPause,
  onStop,
  onToggleLoop,
  onSetDuration,
  onAddCurve,
  onZoomIn,
  onZoomOut,
  onFit,
}: TimelineToolbarProps) {
  const hasTransport = transportState !== null;
  return (
    <div className="rbnt-tl-toolbar">
      <button
        type="button"
        className="rbnt-tl-button"
        aria-label="Play"
        title="Play"
        disabled={!hasTransport || transportState === 'playing'}
        onClick={onPlay}
      >
        ▶
      </button>
      <button
        type="button"
        className="rbnt-tl-button"
        aria-label="Pause"
        title="Pause"
        disabled={transportState !== 'playing'}
        onClick={onPause}
      >
        ⏸
      </button>
      <button
        type="button"
        className="rbnt-tl-button"
        aria-label="Stop"
        title="Stop"
        disabled={!hasTransport}
        onClick={onStop}
      >
        ■
      </button>
      <button
        type="button"
        className="rbnt-tl-button"
        aria-label="Toggle loop"
        title="Toggle loop"
        data-active={document.loop ? 'true' : undefined}
        onClick={onToggleLoop}
      >
        ⟲ loop
      </button>
      <span className="rbnt-tl-readout">
        t = {playheadTime.toFixed(3)} s
        {hasTransport ? ` · ${transportState}` : ' · no transport'}
      </span>
      <label className="rbnt-tl-field">
        dur
        <NumberField
          value={document.durationSec}
          onCommit={onSetDuration}
          step={0.1}
          decimals={2}
          ariaLabel="Duration in seconds"
          widthPx={64}
        />
        s
      </label>
      <button
        type="button"
        className="rbnt-tl-button"
        aria-label="Add curve"
        title="Add curve"
        onClick={onAddCurve}
      >
        + curve
      </button>
      <span className="rbnt-tl-toolbar-spacer" />
      <button
        type="button"
        className="rbnt-tl-button"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={onZoomOut}
      >
        −
      </button>
      <button
        type="button"
        className="rbnt-tl-button"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={onZoomIn}
      >
        +
      </button>
      <button
        type="button"
        className="rbnt-tl-button"
        aria-label="Fit to view"
        title="Fit to view"
        onClick={onFit}
      >
        fit
      </button>
    </div>
  );
}
