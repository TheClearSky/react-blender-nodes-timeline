import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@theclearsky/react-blender-nodes';
import {
  sideInterps,
  type CurvePoint,
  type SideInterp,
} from '../../model/types';
import { NumberField } from './NumberField';

export type PointEditorPanelProps = {
  curveName: string;
  pointIndex: number;
  point: CurvePoint;
  onSetTime(timeSeconds: number): void;
  onSetValue(value: number): void;
  onSetInterp(side: 'left' | 'right', interp: SideInterp): void;
  onDeletePoint(): void;
};

/**
 * Per-side interpolation pickers — the HOST's `Select`, the same widget as a
 * node's enum input, instead of the native `<select>` the plugin used to ship.
 *
 * After a choice, focus returns to the TIMELINE ROOT (not `<body>` — a bare
 * blur would silently disable the timeline's Delete/Escape shortcuts and let
 * the graph's delete keys fire again; review UI-17).
 */
function InterpSelect({
  side,
  value,
  onSetInterp,
}: {
  side: 'left' | 'right';
  value: SideInterp;
  onSetInterp(side: 'left' | 'right', interp: SideInterp): void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        const nextInterp = sideInterps.find(
          (candidate) => candidate === nextValue,
        );
        if (nextInterp !== undefined) onSetInterp(side, nextInterp);
        const timelineRoot = window.document.querySelector('.rbnt-timeline');
        if (timelineRoot instanceof HTMLElement) timelineRoot.focus();
      }}
      size="compact"
    >
      <SelectTrigger
        className="rbnt:h-7 rbnt:w-full rbnt:min-w-0 rbnt:px-2 rbnt:text-[12px] rbnt:leading-4"
        aria-label={`${side === 'left' ? 'Left' : 'Right'} interpolation`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sideInterps.map((interp) => (
          <SelectItem key={interp} value={interp}>
            {interp}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PointEditorPanel({
  curveName,
  pointIndex,
  point,
  onSetTime,
  onSetValue,
  onSetInterp,
  onDeletePoint,
}: PointEditorPanelProps) {
  return (
    <div className="rbnt:flex rbnt:flex-wrap rbnt:items-center rbnt:gap-1.5 rbnt:border-b rbnt:border-secondary-dark-gray rbnt:bg-secondary-black rbnt:px-2 rbnt:py-1.5">
      <span className="rbnt:min-w-[110px] rbnt:text-[12px] rbnt:text-tl-dim">
        {curveName || '(unnamed)'} · point {pointIndex + 1}
      </span>
      <NumberField
        value={point.t}
        onCommit={onSetTime}
        label="t s"
        ariaLabel="Point time in seconds"
      />
      <NumberField
        value={point.v}
        onCommit={onSetValue}
        label="v"
        ariaLabel="Point value"
      />
      <span className="rbnt:inline-flex rbnt:items-center rbnt:gap-1 rbnt:text-tl-dim">
        left
        <InterpSelect
          side="left"
          value={point.leftInterp}
          onSetInterp={onSetInterp}
        />
      </span>
      <span className="rbnt:inline-flex rbnt:items-center rbnt:gap-1 rbnt:text-tl-dim">
        right
        <InterpSelect
          side="right"
          value={point.rightInterp}
          onSetInterp={onSetInterp}
        />
      </span>
      <Button
        type="button"
        size="small"
        className="rbnt:rounded rbnt:border rbnt:border-tl-danger-border rbnt:bg-primary-dark-gray rbnt:px-1.5 rbnt:py-px rbnt:text-[12px] rbnt:leading-[1.4] rbnt:text-tl-danger rbnt:enabled:hover:bg-tl-danger-bg"
        aria-label="Delete point"
        title="Delete point"
        onClick={onDeletePoint}
      >
        delete point
      </Button>
    </div>
  );
}
