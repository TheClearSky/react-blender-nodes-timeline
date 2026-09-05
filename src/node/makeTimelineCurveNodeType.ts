/**
 * Node-type factory (plan §7, Q-TL-2: ONE node per curve reference). The
 * returned literal is host-`TypeOfNode`-shaped but deliberately untyped
 * against the host (no import — the host peer stays type-only elsewhere and
 * this stays inference-friendly): the app wraps the result in its own
 * `makeTypeOfNodeWithAutoInfer(...)`.
 *
 * Outputs (Q-V2-6 RULED): the live `signal` handle (the driver — absolute
 * values, replace-on-connect per Q-V2-1a) PLUS a `number` handle carrying
 * the curve's value sampled at RUN time (feeds construction-time params; it
 * does NOT vary during playback — document on the node).
 */
export type MakeTimelineCurveNodeTypeOptions<
  SignalDataTypeId extends string,
  NumberDataTypeId extends string,
  CurveRefDataTypeId extends string,
> = {
  signalDataTypeId: SignalDataTypeId;
  numberDataTypeId: NumberDataTypeId;
  curveRefDataTypeId: CurveRefDataTypeId;
  name?: string;
  headerColor?: string;
};

export function makeTimelineCurveNodeType<
  SignalDataTypeId extends string,
  NumberDataTypeId extends string,
  CurveRefDataTypeId extends string,
>(
  options: MakeTimelineCurveNodeTypeOptions<
    SignalDataTypeId,
    NumberDataTypeId,
    CurveRefDataTypeId
  >,
) {
  return {
    name: options.name ?? 'Timeline Curve',
    headerColor: options.headerColor ?? '#b45309',
    inputs: [
      {
        name: 'Curve',
        dataType: options.curveRefDataTypeId,
        allowInput: true,
        // Picker-only: no producer emits curve references, so edges into
        // this handle are disabled outright.
        maxConnections: 0,
      },
    ],
    outputs: [
      { name: 'Signal', dataType: options.signalDataTypeId },
      { name: 'Value', dataType: options.numberDataTypeId },
    ],
  };
}
