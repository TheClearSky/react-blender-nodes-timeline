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
  /** In-app docs shown behind the node's ⓘ (the host's
   *  `TypeOfNode.description`); a sensible default is provided. */
  description?: string;
};

/** Default in-app docs (host `description` fields, shown behind an ⓘ). */
const CURVE_NODE_DOCS = {
  node: 'Plays back a curve you draw on the timeline, so a setting can rise and fall over time as the music plays.',
  curve:
    'Which timeline curve to follow. Pick one, or make a new one, from the list.',
  signal:
    "The curve's value, changing live as the timeline plays. Connect it to a yellow socket to move that setting.",
  value:
    "The curve's value at the moment the graph starts. It stays fixed while it plays.",
} as const;

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
    description: options.description ?? CURVE_NODE_DOCS.node,
    inputs: [
      {
        name: 'Curve',
        dataType: options.curveRefDataTypeId,
        allowInput: true,
        // Picker-only: no producer emits curve references, so edges into
        // this handle are disabled outright.
        maxConnections: 0,
        description: CURVE_NODE_DOCS.curve,
      },
    ],
    outputs: [
      {
        name: 'Signal',
        dataType: options.signalDataTypeId,
        description: CURVE_NODE_DOCS.signal,
      },
      {
        name: 'Value',
        dataType: options.numberDataTypeId,
        description: CURVE_NODE_DOCS.value,
      },
    ],
  };
}
