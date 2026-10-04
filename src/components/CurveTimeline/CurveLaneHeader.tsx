import {
  Button,
  cn,
  PopoverColorPicker,
} from '@theclearsky/react-blender-nodes';
import { Input } from '@theclearsky/react-blender-nodes';
import {
  ChartColumn,
  Magnet,
  Rows3,
  ScanSearch,
  Maximize2,
  Minimize2,
  Spline,
  Trash2,
} from 'lucide-react';
import type { CurveDisplay, TimelineCurve } from '../../model/types';
import { NumberField } from './NumberField';
import type { LaneValueRange } from './timelineView';

export type CurveLaneHeaderProps = {
  curve: TimelineCurve;
  valueRange: LaneValueRange;
  isAutoRange: boolean;
  /** Matches the lane's height exactly, or header and lane drift (review UI-5). */
  laneHeight: number;
  isFullscreen: boolean;
  onToggleFullscreen(): void;
  onRename(name: string): void;
  onRecolor(color: string): void;
  onSetRange(min: number, max: number): void;
  onResetRange(): void;
  onDeleteCurve(): void;
  /** Curve or MIDI-style bars (Q-M1 A). */
  onSetDisplay(display: CurveDisplay): void;
  /** The lane's horizontal grid (Q-F2 A): show it, snap to it, find one. */
  onToggleValueLines(): void;
  onToggleValueSnap(): void;
  onFindValueGrid(): void;
};

const SEGMENT =
  'rbnt:inline-flex rbnt:h-[22px] rbnt:items-center rbnt:gap-1 rbnt:border rbnt:border-secondary-dark-gray ' +
  'rbnt:bg-primary-dark-gray rbnt:px-2 rbnt:py-0 rbnt:text-[12px] rbnt:leading-4 rbnt:text-primary-light-gray ' +
  'rbnt:enabled:hover:bg-tl-button-hover rbnt:data-[active=true]:border-tl-accent ' +
  'rbnt:data-[active=true]:bg-tl-accent-bg rbnt:data-[active=true]:text-tl-accent';

/** Square icon buttons, all the same size, so the title row lines up. */
const ICON_BUTTON =
  'rbnt:inline-flex rbnt:h-7 rbnt:w-7 rbnt:shrink-0 rbnt:items-center rbnt:justify-center rbnt:rounded ' +
  'rbnt:border rbnt:border-secondary-dark-gray rbnt:bg-primary-dark-gray rbnt:p-0 rbnt:text-primary-white ' +
  'rbnt:enabled:hover:bg-tl-button-hover rbnt:data-[active=true]:border-tl-accent ' +
  'rbnt:data-[active=true]:text-tl-accent';

/**
 * The per-curve header, in three bands:
 *
 *   ● name ……………………………… [⤢] [🗑]    identity + the lane's actions
 *   [〰 Curve|▮ Bars]    [Auto range]    how it is drawn, what height shows
 *   ‹ min            95.00 ›
 *   ‹ max          1950.00 ›
 *
 * The range fields are full width and stacked — side by side at 108px each
 * they truncated real values ("max 195…"). All text is 12px, the size of the
 * host's compact number field.
 *
 * Every control is a HOST widget — `PopoverColorPicker` for the colour,
 * `Input` for the name, `SliderNumberInput` behind `NumberField` for the
 * range, `Button` for the actions.
 */
export function CurveLaneHeader({
  curve,
  valueRange,
  isAutoRange,
  laneHeight,
  isFullscreen,
  onToggleFullscreen,
  onRename,
  onRecolor,
  onSetRange,
  onResetRange,
  onDeleteCurve,
  onSetDisplay,
  onToggleValueLines,
  onToggleValueSnap,
  onFindValueGrid,
}: CurveLaneHeaderProps) {
  const valueGrid = curve.valueGrid;
  const isBars = curve.display === 'bars';
  return (
    <div
      className="rbnt:box-border rbnt:flex rbnt:flex-col rbnt:justify-center rbnt:gap-1.5 rbnt:border-b rbnt:border-tl-lane-border rbnt:px-2.5 rbnt:py-2 rbnt:text-[12px]"
      style={{ height: laneHeight }}
    >
      <div className="rbnt:flex rbnt:items-center rbnt:gap-1.5">
        <PopoverColorPicker
          value={curve.color}
          onChange={onRecolor}
          size="small"
          showSwatches
          triggerClassName="rbnt:h-6 rbnt:w-6 rbnt:shrink-0"
        />
        {/* `liveUpdate` keeps the rename per-keystroke, as it was. The name
            comes from the wrapping label: the pinned host `Input` (^0.0.14)
            forwards no `aria-label`. */}
        <label className="rbnt:inline-flex rbnt:min-w-0 rbnt:flex-1 rbnt:items-center">
          <span className="rbnt:sr-only">Curve name</span>
          <Input
            size="small"
            liveUpdate
            className="rbnt:h-7 rbnt:w-full rbnt:min-w-0 rbnt:flex-1 rbnt:px-2 rbnt:text-[12px] rbnt:leading-4"
            value={curve.name}
            placeholder="Curve name"
            onChange={onRename}
          />
        </label>
        <Button
          type="button"
          size="small"
          className={ICON_BUTTON}
          aria-label={
            isFullscreen
              ? `Exit fullscreen for ${curve.name}`
              : `Fullscreen ${curve.name}`
          }
          title={
            isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen this curve'
          }
          data-active={isFullscreen ? 'true' : undefined}
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? (
            <Minimize2 className="rbnt:h-3.5 rbnt:w-3.5" />
          ) : (
            <Maximize2 className="rbnt:h-3.5 rbnt:w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          size="small"
          className={cn(
            ICON_BUTTON,
            'rbnt:border-tl-danger-border rbnt:text-tl-danger rbnt:enabled:hover:bg-tl-danger-bg',
          )}
          aria-label={`Delete curve ${curve.name}`}
          title="Delete curve"
          onClick={onDeleteCurve}
        >
          <Trash2 className="rbnt:h-3.5 rbnt:w-3.5" />
        </Button>
      </div>
      <div className="rbnt:mt-0.5 rbnt:flex rbnt:items-center rbnt:justify-between">
        <span
          role="group"
          aria-label={`Show ${curve.name} as`}
          className="rbnt:inline-flex"
        >
          <Button
            type="button"
            size="small"
            className={cn(SEGMENT, 'rbnt:rounded-l rbnt:rounded-r-none')}
            aria-pressed={!isBars}
            title="Show as a curve"
            data-active={!isBars ? 'true' : undefined}
            onClick={() => {
              if (isBars) onSetDisplay('curve');
            }}
          >
            <Spline className="rbnt:h-3.5 rbnt:w-3.5" />
            Curve
          </Button>
          <Button
            type="button"
            size="small"
            className={cn(
              SEGMENT,
              'rbnt:-ml-px rbnt:rounded-l-none rbnt:rounded-r',
            )}
            aria-pressed={isBars}
            title="Show as bars — drag them up and down (edit mode)"
            data-active={isBars ? 'true' : undefined}
            onClick={() => {
              if (!isBars) onSetDisplay('bars');
            }}
          >
            <ChartColumn className="rbnt:h-3.5 rbnt:w-3.5" />
            Bars
          </Button>
        </span>
        {/* A toggle that shows its state: lit while the range follows the
            curve; pressing it after a manual edit fits the range again. */}
        <Button
          type="button"
          size="small"
          className={cn(
            'rbnt:h-[22px] rbnt:rounded rbnt:border rbnt:border-secondary-dark-gray rbnt:bg-primary-dark-gray',
            'rbnt:px-2 rbnt:py-0 rbnt:text-[12px] rbnt:leading-4 rbnt:text-primary-light-gray',
            'rbnt:enabled:hover:bg-tl-button-hover rbnt:data-[active=true]:border-tl-accent',
            'rbnt:data-[active=true]:bg-tl-accent-bg rbnt:data-[active=true]:text-tl-accent',
          )}
          aria-pressed={isAutoRange}
          aria-label={`Auto range for ${curve.name}`}
          title={
            isAutoRange
              ? 'The range follows the curve'
              : 'Fit the range to this curve'
          }
          data-active={isAutoRange ? 'true' : undefined}
          onClick={() => {
            if (!isAutoRange) onResetRange();
          }}
        >
          Auto range
        </Button>
      </div>
      {/* Horizontal grid: lines and snap need a grid, which "find" makes. */}
      <div className="rbnt:flex rbnt:items-center rbnt:justify-between">
        <span className="rbnt:text-primary-light-gray">
          {valueGrid === undefined
            ? 'Value grid'
            : valueGrid.kind === 'pitch'
              ? 'Notes'
              : `Step ${Number(valueGrid.step.toPrecision(4))}`}
        </span>
        <span className="rbnt:inline-flex rbnt:gap-1">
          <Button
            type="button"
            size="small"
            className={cn(SEGMENT, 'rbnt:rounded rbnt:disabled:opacity-40')}
            aria-label={`Show value lines on ${curve.name}`}
            aria-pressed={valueGrid?.show === true}
            title={
              valueGrid === undefined ? 'Find a grid first' : 'Show the lines'
            }
            disabled={valueGrid === undefined}
            data-active={valueGrid?.show === true ? 'true' : undefined}
            onClick={onToggleValueLines}
          >
            <Rows3 className="rbnt:h-3.5 rbnt:w-3.5" />
          </Button>
          <Button
            type="button"
            size="small"
            className={cn(SEGMENT, 'rbnt:rounded rbnt:disabled:opacity-40')}
            aria-label={`Snap values of ${curve.name}`}
            aria-pressed={valueGrid?.snap === true}
            title={
              valueGrid === undefined
                ? 'Find a grid first'
                : 'Snap edited values to the lines (hold Alt to place freely)'
            }
            disabled={valueGrid === undefined}
            data-active={valueGrid?.snap === true ? 'true' : undefined}
            onClick={onToggleValueSnap}
          >
            <Magnet className="rbnt:h-3.5 rbnt:w-3.5" />
          </Button>
          <Button
            type="button"
            size="small"
            className={cn(SEGMENT, 'rbnt:rounded rbnt:text-primary-white')}
            aria-label={`Find a value grid for ${curve.name}`}
            title="Find a grid that fits these values"
            onClick={onFindValueGrid}
          >
            <ScanSearch className="rbnt:h-3.5 rbnt:w-3.5" />
            find
          </Button>
        </span>
      </div>
      <NumberField
        value={valueRange.min}
        onCommit={(nextMin) => {
          if (nextMin < valueRange.max) {
            onSetRange(nextMin, valueRange.max);
          }
        }}
        decimals={2}
        widthPx="full"
        label="min"
        ariaLabel={`Minimum of ${curve.name}`}
      />
      <NumberField
        value={valueRange.max}
        onCommit={(nextMax) => {
          if (nextMax > valueRange.min) {
            onSetRange(valueRange.min, nextMax);
          }
        }}
        decimals={2}
        widthPx="full"
        label="max"
        ariaLabel={`Maximum of ${curve.name}`}
      />
    </div>
  );
}
