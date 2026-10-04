import {
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@theclearsky/react-blender-nodes';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Crosshair,
  Grid3x3,
  Hand,
  Lock,
  LockOpen,
  Magnet,
  ScanSearch,
  Maximize2,
  Minimize2,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Square,
  SkipBack,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { TimelineDocument, TimelineTempo } from '../../model/types';
import type { TransportState } from '../../transport/transport';
import { NumberField } from './NumberField';
import {
  barsInDuration,
  formatBarsBeats,
  GRID_DIVISION_LABELS,
  gridDivisions,
  type GridDivision,
} from './tempo';

/** Pointer behaviour over the lanes. Exactly one is active. */
export type TimelineMode = 'pan' | 'edit';

export type TimelineToolbarProps = {
  document: TimelineDocument;
  transportState: TransportState | null;
  playheadTime: number;
  mode: TimelineMode;
  onModeChange(mode: TimelineMode): void;
  isFullscreen: boolean;
  onExitFullscreen(): void;
  onPlay(): void;
  onPause(): void;
  onStop(): void;
  onRewindToStart(): void;
  onToggleLoop(): void;
  onSetDuration(nextDurationSec: number): void;
  onAddCurve(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  /** Scroll the lanes to the start, to the playhead, or to the end. They move
   *  the VIEW only — the playhead stays where it is. */
  onViewStart(): void;
  onViewPlayhead(): void;
  onViewEnd(): void;
  // ── tempo & grid (plan timeline-midi-mode.md) ──
  tempo: TimelineTempo;
  lockDuration: boolean;
  onSetBpm(bpm: number): void;
  onSetBeatsPerBar(beatsPerBar: number): void;
  onToggleLockDuration(): void;
  gridVisible: boolean;
  snapEnabled: boolean;
  division: GridDivision;
  onToggleGrid(): void;
  onToggleSnap(): void;
  onDivisionChange(division: GridDivision): void;
  /** A refused edit's reason, shown in the tempo row until it clears. */
  notice: string | null;
  /** Open the Grid finder for time (tempo, division, offset). */
  onFindGrid(): void;
};

/**
 * The transport + mode + zoom bar. Every control is the HOST's `Button`, so
 * the timeline's buttons are the same widget as the graph's; `TOOLBAR_BUTTON`
 * adds the timeline's metrics and the `data-active` state shared by the loop
 * toggle and the mode pair.
 *
 * The bar stays pinned while a tall document scrolls underneath it (plan
 * section 6): `CurveTimeline` makes the bar and the scroll strip below it ONE
 * sticky block, so they pin together.
 *
 * Text is 12px throughout — the size of the host's compact number field that
 * sits among these buttons.
 */
const TOOLBAR_BUTTON =
  'rbnt:rounded rbnt:border rbnt:border-secondary-dark-gray rbnt:bg-primary-dark-gray rbnt:px-3 ' +
  'rbnt:py-1.5 rbnt:text-[12px] rbnt:leading-4 rbnt:text-primary-white ' +
  'rbnt:enabled:hover:bg-tl-button-hover rbnt:disabled:cursor-default ' +
  'rbnt:disabled:opacity-40 rbnt:data-[active=true]:border-tl-accent ' +
  'rbnt:data-[active=true]:bg-tl-accent-bg rbnt:data-[active=true]:text-tl-accent';

const ICON = 'rbnt:h-4 rbnt:w-4';

export function TimelineToolbar({
  document,
  transportState,
  playheadTime,
  mode,
  onModeChange,
  isFullscreen,
  onExitFullscreen,
  onPlay,
  onPause,
  onStop,
  onRewindToStart,
  onToggleLoop,
  onSetDuration,
  onAddCurve,
  onZoomIn,
  onZoomOut,
  onFit,
  onViewStart,
  onViewPlayhead,
  onViewEnd,
  tempo,
  lockDuration,
  onSetBpm,
  onSetBeatsPerBar,
  onToggleLockDuration,
  gridVisible,
  snapEnabled,
  division,
  onToggleGrid,
  onToggleSnap,
  onDivisionChange,
  notice,
  onFindGrid,
}: TimelineToolbarProps) {
  const hasTransport = transportState !== null;
  const bars = barsInDuration(document.durationSec, tempo);
  return (
    <div className="rbnt-tl-toolbar rbnt:border-b rbnt:border-secondary-dark-gray rbnt:bg-secondary-black">
      {/* Row 1: play, pointer mode, where the view is. */}
      <div className="rbnt:flex rbnt:flex-wrap rbnt:items-center rbnt:gap-2 rbnt:px-2 rbnt:py-2">
        <Button
          type="button"
          size="small"
          className={TOOLBAR_BUTTON}
          aria-label="Play"
          title="Play"
          disabled={!hasTransport || transportState === 'playing'}
          onClick={onPlay}
        >
          <Play className={ICON} />
        </Button>
        <Button
          type="button"
          size="small"
          className={TOOLBAR_BUTTON}
          aria-label="Pause"
          title="Pause"
          disabled={transportState !== 'playing'}
          onClick={onPause}
        >
          <Pause className={ICON} />
        </Button>
        <Button
          type="button"
          size="small"
          className={TOOLBAR_BUTTON}
          aria-label="Stop"
          title="Stop"
          disabled={!hasTransport}
          onClick={onStop}
        >
          <Square className={ICON} />
        </Button>
        {/* Moves the playhead to 0 WITHOUT stopping: while playing, the transport
          reschedules from the new position and keeps going. */}
        <Button
          type="button"
          size="small"
          className={TOOLBAR_BUTTON}
          aria-label="Playhead to start"
          title="Playhead to start (keeps playing)"
          disabled={!hasTransport}
          onClick={onRewindToStart}
        >
          <SkipBack className={ICON} />
        </Button>
        <Button
          type="button"
          size="small"
          className={TOOLBAR_BUTTON}
          aria-label="Toggle loop"
          title="Toggle loop"
          data-active={document.loop ? 'true' : undefined}
          onClick={onToggleLoop}
        >
          <Repeat className={ICON} />
        </Button>

        {/* Mode: exactly one active, pan by default. */}
        <span
          role="group"
          aria-label="Pointer mode"
          className="rbnt:ml-1 rbnt:inline-flex rbnt:items-center rbnt:gap-1"
        >
          <Button
            type="button"
            size="small"
            className={cn(TOOLBAR_BUTTON, 'rbnt:gap-1.5')}
            aria-label="Pan mode"
            aria-pressed={mode === 'pan'}
            title="Pan — drag the lanes to move through time"
            data-active={mode === 'pan' ? 'true' : undefined}
            onClick={() => onModeChange('pan')}
          >
            <Hand className={ICON} />
            pan
          </Button>
          <Button
            type="button"
            size="small"
            className={cn(TOOLBAR_BUTTON, 'rbnt:gap-1.5')}
            aria-label="Edit mode"
            aria-pressed={mode === 'edit'}
            title="Edit — drag on a lane to add and move points"
            data-active={mode === 'edit' ? 'true' : undefined}
            onClick={() => onModeChange('edit')}
          >
            <Pencil className={ICON} />
            edit
          </Button>
        </span>

        <span className="rbnt:min-w-[200px] rbnt:px-1.5 rbnt:font-mono rbnt:text-xs rbnt:text-tl-readout">
          t = {playheadTime.toFixed(3)} s ·{' '}
          {formatBarsBeats(playheadTime, tempo)}
          {hasTransport ? ` · ${transportState}` : ' · no transport'}
        </span>
        <Button
          type="button"
          size="small"
          className={cn(TOOLBAR_BUTTON, 'rbnt:gap-1.5')}
          aria-label="Add curve"
          title="Add curve"
          onClick={onAddCurve}
        >
          <Plus className={ICON} />
          curve
        </Button>
        <span className="rbnt:flex-1" />
        {isFullscreen && (
          <Button
            type="button"
            size="small"
            className={cn(TOOLBAR_BUTTON, 'rbnt:gap-1.5')}
            aria-label="Exit fullscreen"
            title="Exit fullscreen (Esc)"
            data-active="true"
            onClick={onExitFullscreen}
          >
            <Minimize2 className={ICON} />
            exit
          </Button>
        )}
        {/* Where the view is: jump it to the start, the playhead, or the end. */}
        <span
          role="group"
          aria-label="Move the view"
          className="rbnt:inline-flex rbnt:items-center rbnt:gap-1"
        >
          <Button
            type="button"
            size="small"
            className={TOOLBAR_BUTTON}
            aria-label="View the start"
            title="View the start"
            onClick={onViewStart}
          >
            <ArrowLeftToLine className={ICON} />
          </Button>
          <Button
            type="button"
            size="small"
            className={TOOLBAR_BUTTON}
            aria-label="View the playhead"
            title="View the playhead"
            onClick={onViewPlayhead}
          >
            <Crosshair className={ICON} />
          </Button>
          <Button
            type="button"
            size="small"
            className={TOOLBAR_BUTTON}
            aria-label="View the end"
            title="View the end"
            onClick={onViewEnd}
          >
            <ArrowRightToLine className={ICON} />
          </Button>
        </span>
        <Button
          type="button"
          size="small"
          className={TOOLBAR_BUTTON}
          aria-label="Zoom out"
          title="Zoom out"
          onClick={onZoomOut}
        >
          <ZoomOut className={ICON} />
        </Button>
        <Button
          type="button"
          size="small"
          className={TOOLBAR_BUTTON}
          aria-label="Zoom in"
          title="Zoom in"
          onClick={onZoomIn}
        >
          <ZoomIn className={ICON} />
        </Button>
        <Button
          type="button"
          size="small"
          className={TOOLBAR_BUTTON}
          aria-label="Fit to view"
          title="Fit to view"
          onClick={onFit}
        >
          <Maximize2 className={ICON} />
        </Button>
      </div>
      {/* Row 2: musical time — tempo, the duration and its lock, the grid. */}
      <div className="rbnt:flex rbnt:flex-wrap rbnt:items-center rbnt:gap-2 rbnt:border-t rbnt:border-secondary-dark-gray/60 rbnt:px-2 rbnt:py-1.5">
        <NumberField
          value={tempo.bpm}
          onCommit={onSetBpm}
          decimals={1}
          label="bpm"
          ariaLabel="Tempo in beats per minute"
          widthPx={116}
        />
        <NumberField
          value={tempo.beatsPerBar}
          onCommit={onSetBeatsPerBar}
          decimals={0}
          label="beats/bar"
          ariaLabel="Beats in one bar"
          widthPx={124}
        />
        <NumberField
          value={document.durationSec}
          onCommit={onSetDuration}
          decimals={2}
          label="dur s"
          ariaLabel="Duration in seconds"
          widthPx={136}
        />
        <span className="rbnt:font-mono rbnt:text-xs rbnt:text-tl-readout">
          = {Number(bars.toFixed(2))} {bars === 1 ? 'bar' : 'bars'}
        </span>
        {/* Locked: a tempo change keeps every time in seconds and moves only
          the grid. Unlocked: the music keeps its beats and plays faster or
          slower (ruling Q-M2 A). */}
        <Button
          type="button"
          size="small"
          className={cn(TOOLBAR_BUTTON, 'rbnt:gap-1.5')}
          aria-label="Lock the duration"
          aria-pressed={lockDuration}
          title={
            lockDuration
              ? 'Duration locked — changing the tempo moves only the grid'
              : 'Duration unlocked — changing the tempo speeds the timeline up or slows it down'
          }
          data-active={lockDuration ? 'true' : undefined}
          onClick={onToggleLockDuration}
        >
          {lockDuration ? (
            <Lock className={ICON} />
          ) : (
            <LockOpen className={ICON} />
          )}
          {lockDuration ? 'locked' : 'unlocked'}
        </Button>
        <span className="rbnt:mx-1 rbnt:h-5 rbnt:border-l rbnt:border-secondary-dark-gray" />
        <Button
          type="button"
          size="small"
          className={cn(TOOLBAR_BUTTON, 'rbnt:gap-1.5')}
          aria-label="Show the grid"
          aria-pressed={gridVisible}
          title="Show the grid"
          data-active={gridVisible ? 'true' : undefined}
          onClick={onToggleGrid}
        >
          <Grid3x3 className={ICON} />
          grid
        </Button>
        <Button
          type="button"
          size="small"
          className={cn(TOOLBAR_BUTTON, 'rbnt:gap-1.5')}
          aria-label="Snap to the grid"
          aria-pressed={snapEnabled}
          title="Snap point times to the grid (hold Alt to place freely)"
          data-active={snapEnabled ? 'true' : undefined}
          onClick={onToggleSnap}
        >
          <Magnet className={ICON} />
          snap
        </Button>
        <Select
          value={division}
          onValueChange={(next) => {
            const picked = gridDivisions.find(
              (candidate) => candidate === next,
            );
            if (picked !== undefined) onDivisionChange(picked);
            const timelineRoot =
              window.document.querySelector('.rbnt-timeline');
            if (timelineRoot instanceof HTMLElement) timelineRoot.focus();
          }}
          size="compact"
        >
          <SelectTrigger
            className="rbnt:h-7 rbnt:w-[84px] rbnt:px-2 rbnt:text-[12px] rbnt:leading-4"
            aria-label="Grid division"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {gridDivisions.map((candidate) => (
              <SelectItem key={candidate} value={candidate}>
                {GRID_DIVISION_LABELS[candidate]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="small"
          className={cn(TOOLBAR_BUTTON, 'rbnt:gap-1.5')}
          aria-label="Find grid"
          title="Find a tempo grid that fits your events"
          onClick={onFindGrid}
        >
          <ScanSearch className={ICON} />
          find grid
        </Button>
        {notice !== null && (
          <span role="status" className="rbnt:text-[12px] rbnt:text-tl-danger">
            {notice}
          </span>
        )}
      </div>
    </div>
  );
}
