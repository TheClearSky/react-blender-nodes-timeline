/**
 * Pins for the §7 node seam: the curve-ref value round-trip and the factory
 * shape (picker-only input with edges disabled, signal + Run-time number
 * outputs). Also the COMPILE-TIME check that the picker's structural props
 * stay assignable from the host's InputComponentProps — the props are
 * structural so the rolled d.ts never imports the optional host peer
 * (review UI-8); this assignment breaks the build if they drift.
 */
import type { ComponentType } from 'react';
import type { InputComponentProps } from '@theclearsky/react-blender-nodes';
import { describe, expect, it } from 'vitest';
import {
  makeTimelineCurveRef,
  parseTimelineCurveRef,
  timelineCurveRefSchema,
} from '../../node/curveRef';
import { makeTimelineCurveNodeType } from '../../node/makeTimelineCurveNodeType';
import { TimelineCurvePicker } from '../../node/TimelineCurvePicker';

// Compile-time host-contract check (never executed).
const pickerSatisfiesHostContract: ComponentType<InputComponentProps> =
  TimelineCurvePicker;
void pickerSatisfiesHostContract;

describe('curve reference value', () => {
  it('round-trips and rejects foreign shapes', () => {
    const reference = makeTimelineCurveRef('crv_cutoff');
    expect(parseTimelineCurveRef(reference)).toBe('crv_cutoff');
    expect(timelineCurveRefSchema.safeParse(reference).success).toBe(true);
    expect(parseTimelineCurveRef(undefined)).toBeNull();
    expect(parseTimelineCurveRef('crv_cutoff')).toBeNull();
    expect(parseTimelineCurveRef({ kind: 'other', curveId: 'x' })).toBeNull();
    expect(
      parseTimelineCurveRef({ kind: 'timelineCurveRef', curveId: '' }),
    ).toBeNull();
  });
});

describe('makeTimelineCurveNodeType', () => {
  it('threads the dataType ids; picker input forbids edges; two outputs', () => {
    const nodeType = makeTimelineCurveNodeType({
      signalDataTypeId: 'signal',
      numberDataTypeId: 'number',
      curveRefDataTypeId: 'curveRef',
    });
    expect(nodeType.name).toBe('Timeline Curve');
    expect(nodeType.inputs).toEqual([
      {
        name: 'Curve',
        dataType: 'curveRef',
        allowInput: true,
        maxConnections: 0,
      },
    ]);
    expect(nodeType.outputs).toEqual([
      { name: 'Signal', dataType: 'signal' },
      { name: 'Value', dataType: 'number' },
    ]);
    const renamed = makeTimelineCurveNodeType({
      signalDataTypeId: 's',
      numberDataTypeId: 'n',
      curveRefDataTypeId: 'c',
      name: 'Curve Out',
      headerColor: '#123456',
    });
    expect(renamed.name).toBe('Curve Out');
    expect(renamed.headerColor).toBe('#123456');
  });
});
