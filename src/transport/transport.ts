/**
 * Transport (plan §5.1/§5.2). One clock: document time is anchored to the
 * injected audio context's currentTime — the UI only READS the playhead.
 *
 * Discipline encoded here, unit-pinned on fakes:
 * - play() opens with ONE startup cancel sweep (a no-op when genuinely
 *   parked; it kills a coalesced flush racing play in the same tick —
 *   observed live). All other cancels happen ONLY on scrub / pause /
 *   stop / document-edit / build-change — and every cancel is immediately
 *   followed by an anchor.
 * - LOOP WRAP IS APPEND-ONLY (review EM-05): the scheduler keeps a
 *   monotone absolute-time frontier and appends the next pass ahead of the
 *   wrap; a clean wrap performs no cancel calls. The frontier is topped up
 *   from an injected setInterval — rAF is dead in background tabs while
 *   audio keeps playing (review EM-16) — keeping ≥ lookaheadSeconds of
 *   automation written ahead (default 2 s). While the page is HIDDEN the
 *   effective lookahead grows to ≥ 65 s: Chrome's intensive throttling can
 *   park timers at one wake per minute for tabs that are silent (muted
 *   monitors included), and the buffer must outlive that gap (review EN-5).
 * - The axis a schedule was built under (duration, loop) is CAPTURED at
 *   every (re)anchor: playhead math and edit-flush rescheduling interpret
 *   the accumulated absolute time with the CAPTURED values, then clamp
 *   into the new document before re-anchoring — a duration edit or loop
 *   toggle mid-play repositions cleanly instead of re-wrapping stale
 *   absolute time (review EN-3).
 * - Every per-driver write is contained: an exception from one param
 *   (spec NotSupportedError, non-finite TypeError, closed context) is
 *   reported through onScheduleError, the remaining drivers still get
 *   their pass, and anchor/frontier stay consistent (review EN-2). Write-
 *   boundary ulp mismatches themselves are prevented by the per-param
 *   write guards (review EN-1, scheduling.ts).
 * - pause = cancel + hold curve(t); stop = cancel + anchor curve(0);
 *   natural end with loop off → ENDED: playhead parks at the end, params
 *   HOLD the pass's terminal value with zero extra calls (review EM-15);
 *   play() while parked at the end with loop off restarts at 0 (EN-9).
 * - scrub clamps into [0, durationSec] and ignores non-finite input
 *   (review EM-22.3/EN-6); `preview: true` writes only a
 *   ~scrubWindowSeconds window per call (review EM-22.4).
 * - Document edits arrive via notifyDocumentChanged and are COALESCED —
 *   the default coalescer arms BOTH an animation frame and a ~40 ms
 *   timeout (first wins), so parked edits flush even in hidden tabs
 *   (review EN-4); the interval tick also force-flushes while playing.
 *   Edits reschedule ALL live drivers — rewriting an unchanged curve with
 *   identical values is inaudible, and one shared frontier stays correct.
 *   `changedCurveIds` is accepted but currently ignored (reserved for
 *   future narrowing — do not build dirty-tracking against it).
 * - Registry changes (acquireDriver/releaseBuild) reschedule while
 *   playing (coalesced); while parked they refresh driver offsets to
 *   curve(playhead) directly.
 */
import { evaluateCurve } from '../model/evaluate';
import type { TimelineDocument } from '../model/types';
import {
  applyScheduleEvents,
  buildSchedulePass,
  createParamWriteGuard,
  nextRepresentableAfter,
  type ParamWriteGuard,
} from './scheduling';
import type { TimelineDriverRegistry } from './driverRegistry';
import type { SchedulableParam, TimelineAudioContextLike } from './seamTypes';

export const transportStates = [
  'stopped',
  'playing',
  'paused',
  'ended',
] as const;
export type TransportState = (typeof transportStates)[number];

export type TimelineTransportTimers = {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
};

export type CreateTimelineTransportOptions = {
  context: TimelineAudioContextLike;
  getDocument(): TimelineDocument;
  registry: TimelineDriverRegistry;
  /** Seconds of automation kept written ahead of the playhead. Default 2. */
  lookaheadSeconds?: number;
  /** Window written per preview scrub call. Default 2. */
  scrubWindowSeconds?: number;
  /** Top-up interval period. Default 250. */
  intervalMs?: number;
  /**
   * Passes are anchored this far in the FUTURE (default 0.08 s). Writing a
   * large pass takes longer than an audio render quantum, and an event
   * dated in the past gets its curve window SHIFTED forward by Chrome —
   * later events of the same pass then collide with the shifted windows
   * (found live by the 280-event Curve Orchestra score). 80 ms covers many
   * quanta of main-thread write time and is imperceptible on play/scrub.
   */
  scheduleHeadroomSeconds?: number;
  /** Coalescer for edit/build notifications. Default rAF + 40 ms timeout. */
  coalesce?(flush: () => void): void;
  timers?: TimelineTransportTimers;
  /**
   * Called when writing automation to one driver throws (spec overlap
   * errors, non-finite values, closed context). The pass continues for the
   * other drivers. Default: console.error.
   */
  onScheduleError?(error: unknown, curveId: string): void;
};

export type TimelineTransport = {
  getState(): TransportState;
  getPlayheadTime(): number;
  play(): void;
  pause(): void;
  stop(): void;
  scrub(timeSeconds: number, options?: { preview?: boolean }): void;
  /** `changedCurveIds` is reserved — currently every edit reschedules all. */
  notifyDocumentChanged(changedCurveIds?: readonly string[]): void;
  notifyBuildEnded(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

const FRONTIER_EPSILON_SECONDS = 1e-9;
/** Defense in depth against pathological (tiny-duration) documents: cap
 *  appended cycles per tick; the next tick continues (review EN-6). */
const MAX_CYCLES_PER_TOPUP = 128;
/** Hidden-tab lookahead: must outlive Chrome's 1/min intensive-throttle
 *  wake interval for silent tabs (review EN-5). */
const HIDDEN_LOOKAHEAD_SECONDS = 65;

function defaultCoalesce(flush: () => void): void {
  // Arm both: rAF for pointer-rate coalescing while visible, a clamped
  // timeout so hidden/parked tabs still flush (review EN-4). First wins.
  let flushed = false;
  function runOnce() {
    if (flushed) {
      return;
    }
    flushed = true;
    flush();
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(runOnce);
  }
  setTimeout(runOnce, 40);
}

const defaultTimers: TimelineTransportTimers = {
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (handle) => clearInterval(handle as number),
};

function sanitizePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function createTimelineTransport(
  options: CreateTimelineTransportOptions,
): TimelineTransport {
  const { context, getDocument, registry } = options;
  const lookaheadSeconds = sanitizePositive(options.lookaheadSeconds, 2);
  const scrubWindowSeconds = sanitizePositive(options.scrubWindowSeconds, 2);
  const intervalMs = sanitizePositive(options.intervalMs, 250);
  const scheduleHeadroomSeconds =
    options.scheduleHeadroomSeconds !== undefined &&
    Number.isFinite(options.scheduleHeadroomSeconds) &&
    options.scheduleHeadroomSeconds >= 0
      ? options.scheduleHeadroomSeconds
      : 0.08;
  const coalesce = options.coalesce ?? defaultCoalesce;
  const timers = options.timers ?? defaultTimers;
  const onScheduleError =
    options.onScheduleError ??
    ((error: unknown, curveId: string) => {
      console.error(
        `[timeline-transport] scheduling onto driver for curve "${curveId}" failed`,
        error,
      );
    });

  let state: TransportState = 'stopped';
  /** Authoritative playhead while NOT playing. */
  let parkedPlayheadSeconds = 0;
  /** While playing: document time ↔ context time anchor. */
  let anchorContextTime = 0;
  let anchorDocumentTime = 0;
  /** The document parameters the CURRENT schedule was built under (EN-3). */
  let axisDurationSec = 0;
  let axisLoop = false;
  /** Absolute (unwrapped) document time up to which automation is written. */
  let scheduledUntilAbsolute = 0;
  let intervalHandle: unknown = null;
  let reschedulePending = false;
  let flushScheduled = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  /** Per-driver write guards (EN-1) — continuous across appended passes,
   *  reset on every cancel. */
  const writeGuards = new WeakMap<SchedulableParam, ParamWriteGuard>();

  function guardFor(param: SchedulableParam): ParamWriteGuard {
    let guard = writeGuards.get(param);
    if (guard === undefined) {
      guard = createParamWriteGuard();
      writeGuards.set(param, guard);
    }
    return guard;
  }

  /** Direct writes (anchors, missing-ref zeros, .value refreshes) must be
   *  visible to the guard too, or a curve scheduled in the SAME tick can
   *  start exactly ON them — the spec window [T, T+D) includes T. Caught
   *  by the EN-12 marathon: scrub-parked → play() same tick. */
  function recordDirectWrite(param: SchedulableParam, atTime: number): void {
    const guard = guardFor(param);
    if (atTime > guard.lastWrittenContextTime) {
      guard.lastWrittenContextTime = atTime;
    }
  }

  /** Guard-aware direct set: a PAST curve surviving a cancel keeps its
   *  CLOSED right edge in the wrapper's shadow list, so an anchor at a
   *  `now` bit-equal to that edge must bump one ulp past it. */
  function guardedSetValueAtTime(
    param: SchedulableParam,
    value: number,
    atTime: number,
  ): void {
    const guard = guardFor(param);
    let writeTime = atTime;
    if (writeTime <= guard.curveEndContextTime) {
      writeTime = nextRepresentableAfter(guard.curveEndContextTime);
    }
    param.setValueAtTime(value, writeTime);
    if (writeTime > guard.lastWrittenContextTime) {
      guard.lastWrittenContextTime = writeTime;
    }
  }

  function notifyListeners(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function absoluteNow(): number {
    // During the schedule headroom (anchor in the near future) the raw
    // difference is negative — the playhead holds at the anchor position.
    return Math.max(
      anchorDocumentTime,
      anchorDocumentTime + (context.currentTime - anchorContextTime),
    );
  }

  /** Wrap ABSOLUTE time using the CAPTURED axis (EN-3). */
  function wrappedAxisTime(absoluteTime: number): number {
    if (!(axisDurationSec > 0)) {
      return 0;
    }
    return axisLoop
      ? absoluteTime % axisDurationSec
      : Math.min(absoluteTime, axisDurationSec);
  }

  function clampToDocument(timeSeconds: number): number {
    const durationSec = getDocument().durationSec;
    return Math.min(Math.max(timeSeconds, 0), durationSec);
  }

  function effectiveLookaheadSeconds(): number {
    const globalDocument = (
      globalThis as { document?: { visibilityState?: string } }
    ).document;
    return globalDocument?.visibilityState === 'hidden'
      ? Math.max(lookaheadSeconds, HIDDEN_LOOKAHEAD_SECONDS)
      : lookaheadSeconds;
  }

  /**
   * Write one pass over [fromDocTime, toDocTime] of the given cycle onto
   * every live driver. A driver whose curve was deleted from the document
   * (missing reference, plan §7/§8) is anchored to a constant 0. A throw
   * from one driver is contained (EN-2): reported, the rest still write.
   */
  function writeCycle(
    cycleIndex: number,
    fromDocTime: number,
    toDocTime: number,
  ): void {
    const timelineDocument = getDocument();
    const cycleStartAbsolute = cycleIndex * axisDurationSec;
    // SNAPSHOT the mapping: the whole pass must be internally consistent
    // even if the axis is re-anchored by anything mid-iteration.
    const passAnchorContextTime = anchorContextTime;
    const passAnchorDocumentTime = anchorDocumentTime;
    const mapDocumentTime = (documentTimeSeconds: number) =>
      passAnchorContextTime +
      (cycleStartAbsolute + documentTimeSeconds - passAnchorDocumentTime);
    for (const driver of registry.getLiveDrivers()) {
      try {
        const curve = timelineDocument.curves.find(
          (candidate) => candidate.id === driver.curveId,
        );
        if (curve === undefined) {
          guardedSetValueAtTime(
            driver.node.offset,
            0,
            mapDocumentTime(fromDocTime),
          );
          continue;
        }
        const events = buildSchedulePass(curve, fromDocTime, toDocTime);
        applyScheduleEvents(
          driver.node.offset,
          events,
          mapDocumentTime,
          guardFor(driver.node.offset),
        );
      } catch (error) {
        onScheduleError(error, driver.curveId);
      }
    }
  }

  function cancelAllDrivers(): void {
    const cancelTime = context.currentTime;
    for (const driver of registry.getLiveDrivers()) {
      try {
        driver.node.offset.cancelScheduledValues(cancelTime);
      } catch (error) {
        onScheduleError(error, driver.curveId);
      }
      // Cancel removes events at/after cancelTime and in-flight curves
      // WHOLE — but PAST curves survive, and every survivor's CLOSED right
      // edge is ≤ cancelTime (wrapper rule; an edge can be BIT-EQUAL to
      // now, e.g. 5e-324 + 2 === 2). Treating cancelTime itself as a
      // closed edge covers every survivor at the cost of one ulp on
      // post-cancel anchors.
      const guard = writeGuards.get(driver.node.offset);
      if (guard !== undefined) {
        if (guard.wroteCurve) {
          guard.curveEndContextTime = cancelTime;
          guard.lastWrittenContextTime = cancelTime;
        } else {
          guard.curveEndContextTime = -Infinity;
          guard.lastWrittenContextTime = -Infinity;
        }
      }
    }
  }

  function anchorAllDrivers(documentTimeSeconds: number): void {
    const timelineDocument = getDocument();
    const atTime = context.currentTime;
    for (const driver of registry.getLiveDrivers()) {
      try {
        const curve = timelineDocument.curves.find(
          (candidate) => candidate.id === driver.curveId,
        );
        guardedSetValueAtTime(
          driver.node.offset,
          curve === undefined ? 0 : evaluateCurve(curve, documentTimeSeconds),
          atTime,
        );
      } catch (error) {
        onScheduleError(error, driver.curveId);
      }
    }
  }

  function refreshParkedDriverValues(): void {
    const timelineDocument = getDocument();
    for (const driver of registry.getLiveDrivers()) {
      try {
        const curve = timelineDocument.curves.find(
          (candidate) => candidate.id === driver.curveId,
        );
        driver.node.offset.value =
          curve === undefined ? 0 : evaluateCurve(curve, parkedPlayheadSeconds);
        // The .value setter behaves like an implicit event at `now` on some
        // engines — keep the guard aware.
        recordDirectWrite(driver.node.offset, context.currentTime);
      } catch (error) {
        onScheduleError(error, driver.curveId);
      }
    }
  }

  /**
   * Append-only top-up under the CAPTURED axis: advance the frontier until
   * the effective lookahead is written ahead. NEVER cancels — this is the
   * loop wrap. Bounded per tick against pathological documents.
   */
  function ensureScheduledAhead(): void {
    if (state !== 'playing' || !(axisDurationSec > 0)) {
      return;
    }
    const targetFrontier = axisLoop
      ? absoluteNow() + effectiveLookaheadSeconds()
      : Math.min(absoluteNow() + effectiveLookaheadSeconds(), axisDurationSec);
    let appendedCycles = 0;
    while (
      scheduledUntilAbsolute < targetFrontier - FRONTIER_EPSILON_SECONDS &&
      appendedCycles < MAX_CYCLES_PER_TOPUP
    ) {
      const cycleIndex = Math.floor(
        scheduledUntilAbsolute / axisDurationSec + 1e-6,
      );
      const cycleStartAbsolute = cycleIndex * axisDurationSec;
      const fromDocTime = Math.max(
        0,
        scheduledUntilAbsolute - cycleStartAbsolute,
      );
      writeCycle(cycleIndex, fromDocTime, axisDurationSec);
      scheduledUntilAbsolute = cycleStartAbsolute + axisDurationSec;
      appendedCycles += 1;
    }
  }

  function stopInterval(): void {
    if (intervalHandle !== null) {
      timers.clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  function transitionToEnded(): void {
    state = 'ended';
    parkedPlayheadSeconds = axisDurationSec;
    stopInterval();
    notifyListeners();
  }

  /**
   * Re-anchor the clock at documentTime under the CURRENT document (the
   * axis capture, EN-3) and rewrite from there. Callers cancel first.
   */
  function restartAxisAndSchedule(
    documentTimeSeconds: number,
    windowEndSeconds: number,
  ): void {
    const timelineDocument = getDocument();
    // Headroom keeps every event of the pass in the future even while the
    // audio clock advances under a long write burst (see the option doc).
    anchorContextTime = context.currentTime + scheduleHeadroomSeconds;
    anchorDocumentTime = documentTimeSeconds;
    axisDurationSec = timelineDocument.durationSec;
    axisLoop = timelineDocument.loop;
    writeCycle(0, documentTimeSeconds, windowEndSeconds);
    scheduledUntilAbsolute = windowEndSeconds;
  }

  function flushPendingReschedule(): void {
    if (disposed || !reschedulePending) {
      return;
    }
    reschedulePending = false;
    if (state === 'playing') {
      // Interpret the accumulated absolute time under the OLD axis, then
      // clamp into the NEW document (EM-22.5) before re-anchoring.
      const currentAxisTime = wrappedAxisTime(absoluteNow());
      const currentTime = clampToDocument(currentAxisTime);
      cancelAllDrivers();
      restartAxisAndSchedule(currentTime, getDocument().durationSec);
      ensureScheduledAhead();
    } else {
      parkedPlayheadSeconds = clampToDocument(parkedPlayheadSeconds);
      cancelAllDrivers();
      anchorAllDrivers(parkedPlayheadSeconds);
    }
    notifyListeners();
  }

  function requestCoalescedReschedule(): void {
    reschedulePending = true;
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;
    coalesce(() => {
      flushScheduled = false;
      flushPendingReschedule();
    });
  }

  function intervalTick(): void {
    if (disposed) {
      return;
    }
    // Playing-state safety net: the coalescer's own fallback covers parked
    // states; this covers rAF-dead playing tabs between coalescer arms.
    flushPendingReschedule();
    if (state !== 'playing') {
      return;
    }
    if (!axisLoop && axisDurationSec > 0 && absoluteNow() >= axisDurationSec) {
      transitionToEnded();
      return;
    }
    ensureScheduledAhead();
  }

  function getPlayheadTime(): number {
    if (state !== 'playing') {
      return parkedPlayheadSeconds;
    }
    return wrappedAxisTime(absoluteNow());
  }

  function handleVisibilityChange(): void {
    if (disposed || state !== 'playing') {
      return;
    }
    // Entering hidden: immediately extend the written buffer to survive
    // intensive timer throttling (EN-5).
    ensureScheduledAhead();
  }

  const globalDocument = (
    globalThis as {
      document?: {
        addEventListener?: (type: string, listener: () => void) => void;
        removeEventListener?: (type: string, listener: () => void) => void;
      };
    }
  ).document;
  globalDocument?.addEventListener?.(
    'visibilitychange',
    handleVisibilityChange,
  );

  const registryUnsubscribe = registry.subscribe(() => {
    if (disposed) {
      return;
    }
    if (state === 'playing') {
      requestCoalescedReschedule();
    } else {
      refreshParkedDriverValues();
    }
  });

  return {
    getState: () => state,
    getPlayheadTime,

    play() {
      if (disposed || state === 'playing') {
        return;
      }
      const timelineDocument = getDocument();
      if (state === 'ended') {
        parkedPlayheadSeconds = 0;
      } else if (
        !timelineDocument.loop &&
        parkedPlayheadSeconds >= timelineDocument.durationSec
      ) {
        // Parked exactly at the end with loop off: restarting at 0 is the
        // only non-zombie transition (EN-9).
        parkedPlayheadSeconds = 0;
      }
      parkedPlayheadSeconds = clampToDocument(parkedPlayheadSeconds);
      state = 'playing';
      // Startup sweep: normally a no-op (nothing is scheduled while
      // parked), but a coalesced flush racing play() in the same ~40 ms
      // window can have written a full pass already — observed live in the
      // Curve Orchestra demo. One cancel kills any such racing pass; the
      // append-only wrap discipline (EM-05) is untouched.
      cancelAllDrivers();
      restartAxisAndSchedule(
        parkedPlayheadSeconds,
        timelineDocument.durationSec,
      );
      ensureScheduledAhead();
      if (intervalHandle === null) {
        intervalHandle = timers.setInterval(intervalTick, intervalMs);
      }
      notifyListeners();
    },

    pause() {
      if (disposed || state !== 'playing') {
        return;
      }
      const pauseTime = getPlayheadTime();
      cancelAllDrivers();
      anchorAllDrivers(pauseTime);
      parkedPlayheadSeconds = pauseTime;
      state = 'paused';
      stopInterval();
      notifyListeners();
    },

    stop() {
      if (disposed) {
        return;
      }
      cancelAllDrivers();
      anchorAllDrivers(0);
      parkedPlayheadSeconds = 0;
      state = 'stopped';
      stopInterval();
      notifyListeners();
    },

    scrub(timeSeconds, scrubOptions) {
      if (disposed || !Number.isFinite(timeSeconds)) {
        return;
      }
      const preview = scrubOptions?.preview === true;
      const clampedTime = clampToDocument(timeSeconds);
      const durationSec = getDocument().durationSec;
      if (state === 'playing') {
        cancelAllDrivers();
        const windowEnd = preview
          ? Math.min(clampedTime + scrubWindowSeconds, durationSec)
          : durationSec;
        restartAxisAndSchedule(clampedTime, windowEnd);
        if (!preview) {
          ensureScheduledAhead();
        }
      } else {
        cancelAllDrivers();
        anchorAllDrivers(clampedTime);
        parkedPlayheadSeconds = clampedTime;
        if (state === 'ended') {
          // Scrubbing away from the end re-parks; play() then resumes here
          // instead of restarting at 0.
          state = 'paused';
        }
      }
      notifyListeners();
    },

    notifyDocumentChanged() {
      if (disposed) {
        return;
      }
      requestCoalescedReschedule();
    },

    notifyBuildEnded() {
      if (disposed) {
        return;
      }
      if (state === 'playing') {
        requestCoalescedReschedule();
      } else {
        refreshParkedDriverValues();
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stopInterval();
      registryUnsubscribe();
      globalDocument?.removeEventListener?.(
        'visibilitychange',
        handleVisibilityChange,
      );
      listeners.clear();
    },
  };
}
