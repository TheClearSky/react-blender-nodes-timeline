import type { ChangeEvent } from 'react';
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

export function PointEditorPanel({
  curveName,
  pointIndex,
  point,
  onSetTime,
  onSetValue,
  onSetInterp,
  onDeletePoint,
}: PointEditorPanelProps) {
  function handleInterpChange(side: 'left' | 'right') {
    return (event: ChangeEvent<HTMLSelectElement>) => {
      const nextInterp = sideInterps.find(
        (candidate) => candidate === event.target.value,
      );
      if (nextInterp !== undefined) {
        onSetInterp(side, nextInterp);
      }
      // Return focus to the TIMELINE ROOT (not <body> — a bare blur() would
      // silently disable the timeline's Delete/Escape shortcuts, and let
      // graph delete keys fire again; review UI-17).
      const timelineRoot = event.currentTarget.closest('.rbnt-timeline');
      if (timelineRoot instanceof HTMLElement) {
        timelineRoot.focus();
      } else {
        event.currentTarget.blur();
      }
    };
  }

  return (
    <div className="rbnt-tl-point-panel">
      <span className="rbnt-tl-point-label">
        {curveName || '(unnamed)'} · point {pointIndex + 1}
      </span>
      <label className="rbnt-tl-field">
        t
        <NumberField
          value={point.t}
          onCommit={onSetTime}
          ariaLabel="Point time in seconds"
        />
      </label>
      <label className="rbnt-tl-field">
        v
        <NumberField
          value={point.v}
          onCommit={onSetValue}
          ariaLabel="Point value"
        />
      </label>
      <label className="rbnt-tl-field">
        left
        <select
          className="rbnt-tl-select"
          value={point.leftInterp}
          aria-label="Left interpolation"
          onChange={handleInterpChange('left')}
        >
          {sideInterps.map((interp) => (
            <option key={interp} value={interp}>
              {interp}
            </option>
          ))}
        </select>
      </label>
      <label className="rbnt-tl-field">
        right
        <select
          className="rbnt-tl-select"
          value={point.rightInterp}
          aria-label="Right interpolation"
          onChange={handleInterpChange('right')}
        >
          {sideInterps.map((interp) => (
            <option key={interp} value={interp}>
              {interp}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="rbnt-tl-button rbnt-tl-button-small rbnt-tl-danger"
        aria-label="Delete point"
        title="Delete point"
        onClick={onDeletePoint}
      >
        delete point
      </button>
    </div>
  );
}
