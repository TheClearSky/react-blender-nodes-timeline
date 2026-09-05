/**
 * Structural seam types the plugin OWNS (plan §5.2, review EM-07). Tone 15's
 * `rawContext` is a standardized-audio-context WRAPPER: `new
 * ConstantSourceNode(ctx)` THROWS against it and `instanceof
 * AudioParam` is false for its objects — so the plugin never references
 * lib.dom audio classes, builds drivers exclusively through the factory
 * method, and types the whole seam structurally. `cancelAndHoldAtTime` is
 * deliberately absent (not implemented by that wrapper).
 */

export type SchedulableParam = {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  setValueCurveAtTime(
    values: Float32Array,
    startTime: number,
    duration: number,
  ): unknown;
  cancelScheduledValues(cancelTime: number): unknown;
};

export type DriverNode = {
  readonly offset: SchedulableParam;
  start(): unknown;
  stop(): unknown;
  disconnect(): unknown;
};

export type TimelineAudioContextLike = {
  readonly currentTime: number;
  createConstantSource(): DriverNode;
};
