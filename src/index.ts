/**
 * @theclearsky/react-blender-nodes-timeline — public surface.
 *
 * Grows step by step (model T1 → transport/store T2 → editor T3 → node
 * factory T4); EVERY runtime addition must also be added to
 * EXPECTED_EXPORTS in scripts/check-dist-loads.ts — the build fails
 * otherwise, by design.
 */
import './style.css';

export const TIMELINE_PLUGIN_VERSION = '0.0.3';

export { MIN_POINT_DELTA_SECONDS, sideInterps } from './model/types';
export type {
  CurveDisplay,
  CurvePoint,
  SideInterp,
  TimelineCurve,
  TimelineDocument,
  TimelineTempo,
  ValueGrid,
} from './model/types';
export { evaluateCurve } from './model/evaluate';
export { demoTimelineDocument } from './model/demoDocument';
export {
  curvePointSchema,
  parseTimelineDocument,
  sideInterpSchema,
  timelineCurveSchema,
  timelineDocumentSchema,
} from './model/schemas';

export type {
  DriverNode,
  SchedulableParam,
  TimelineAudioContextLike,
} from './transport/seamTypes';
export { createTimelineDriverRegistry } from './transport/driverRegistry';
export type {
  AcquireDriverResult,
  DriverRegistryEntry,
  TimelineDriverRegistry,
} from './transport/driverRegistry';
export {
  createTimelineTransport,
  transportStates,
} from './transport/transport';
export type {
  CreateTimelineTransportOptions,
  TimelineTransport,
  TimelineTransportTimers,
  TransportState,
} from './transport/transport';
export {
  createEmptyTimelineDocument,
  createTimelineDocumentStore,
} from './store/documentStore';
export type { TimelineDocumentStore } from './store/documentStore';
export { useTimelineContext } from './store/TimelineContext';
export type { TimelineContextValue } from './store/TimelineContext';
export { TimelineProvider } from './store/TimelineProvider';
export type { TimelineProviderProps } from './store/TimelineProvider';
export { CurveTimeline } from './components/CurveTimeline/CurveTimeline';
// The Grid finder's pure analysis — for apps that want to suggest a tempo or
// a lane's value grid outside the editor (plan timeline-grid-finder.md).
export {
  collectEventTimes,
  findTempoCandidates,
  findValueGridCandidates,
} from './components/CurveTimeline/gridFinder';
export type {
  TempoCandidate,
  ValueGridCandidate,
  ValueGridShape,
} from './components/CurveTimeline/gridFinder';
export type { CurveTimelineProps } from './components/CurveTimeline/CurveTimeline';
export {
  makeTimelineCurveRef,
  parseTimelineCurveRef,
  timelineCurveRefSchema,
} from './node/curveRef';
export type { TimelineCurveRef } from './node/curveRef';
export { makeTimelineCurveNodeType } from './node/makeTimelineCurveNodeType';
export type { MakeTimelineCurveNodeTypeOptions } from './node/makeTimelineCurveNodeType';
export { TimelineCurvePicker } from './node/TimelineCurvePicker';
export type { TimelineCurvePickerProps } from './node/TimelineCurvePicker';
