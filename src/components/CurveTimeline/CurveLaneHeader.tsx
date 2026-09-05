import type { TimelineCurve } from '../../model/types';
import { NumberField } from './NumberField';
import { LANE_HEIGHT_PX, type LaneValueRange } from './timelineView';

export type CurveLaneHeaderProps = {
  curve: TimelineCurve;
  valueRange: LaneValueRange;
  isAutoRange: boolean;
  onRename(name: string): void;
  onRecolor(color: string): void;
  onSetRange(min: number, max: number): void;
  onResetRange(): void;
  onDeleteCurve(): void;
};

/** `<input type="color">` accepts only #rrggbb — expand schema-legal
 *  3-digit hex so the swatch renders instead of warning (review UI-16). */
function colorInputValue(color: string): string {
  const shortHex = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(color);
  if (shortHex !== null) {
    return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`;
  }
  return color;
}

export function CurveLaneHeader({
  curve,
  valueRange,
  isAutoRange,
  onRename,
  onRecolor,
  onSetRange,
  onResetRange,
  onDeleteCurve,
}: CurveLaneHeaderProps) {
  return (
    <div className="rbnt-tl-lane-header" style={{ height: LANE_HEIGHT_PX }}>
      <div className="rbnt-tl-lane-header-row">
        <input
          type="color"
          className="rbnt-tl-color"
          value={colorInputValue(curve.color)}
          aria-label={`Color of ${curve.name}`}
          onChange={(event) => onRecolor(event.target.value)}
        />
        <input
          className="rbnt-tl-name"
          value={curve.name}
          aria-label="Curve name"
          onChange={(event) => onRename(event.target.value)}
        />
      </div>
      <div className="rbnt-tl-lane-header-row">
        <span className="rbnt-tl-dim">y</span>
        <NumberField
          value={valueRange.min}
          onCommit={(nextMin) => {
            if (nextMin < valueRange.max) {
              onSetRange(nextMin, valueRange.max);
            }
          }}
          decimals={2}
          widthPx={58}
          ariaLabel={`Minimum of ${curve.name}`}
        />
        <span className="rbnt-tl-dim">–</span>
        <NumberField
          value={valueRange.max}
          onCommit={(nextMax) => {
            if (nextMax > valueRange.min) {
              onSetRange(valueRange.min, nextMax);
            }
          }}
          decimals={2}
          widthPx={58}
          ariaLabel={`Maximum of ${curve.name}`}
        />
        <button
          type="button"
          className="rbnt-tl-button rbnt-tl-button-small"
          disabled={isAutoRange}
          aria-label={`Auto range for ${curve.name}`}
          title="Auto range"
          onClick={onResetRange}
        >
          auto
        </button>
      </div>
      <div className="rbnt-tl-lane-header-row">
        <button
          type="button"
          className="rbnt-tl-button rbnt-tl-button-small rbnt-tl-danger"
          aria-label={`Delete curve ${curve.name}`}
          title="Delete curve"
          onClick={onDeleteCurve}
        >
          delete
        </button>
      </div>
    </div>
  );
}
