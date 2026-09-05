/**
 * Fakes for the §9.1 transport pins: a SPEC-FAITHFUL call-recording param,
 * a driver-node/context factory pair, manual timers, and a manual
 * coalescer.
 *
 * The param enforces the Web Audio automation rules (review EN-12) so the
 * EN-1 float-boundary class is testable: it keeps an event list, recomputes
 * every curve window from the PASSED doubles as `startTime + duration`
 * (exactly like engines do), throws NotSupportedError when any automation
 * call lands inside an existing curve's [T, T+D) or a new curve window
 * would contain an existing event, throws TypeError on non-finite
 * arguments, and models cancelScheduledValues removing in-flight curves
 * WHOLE.
 */
import type {
  DriverNode,
  SchedulableParam,
  TimelineAudioContextLike,
} from '../../transport/seamTypes';
import type { TimelineTransportTimers } from '../../transport/transport';

export type RecordedCall = {
  readonly method: string;
  readonly args: readonly unknown[];
};

type FakeAutomationEvent =
  | { readonly kind: 'point'; readonly time: number }
  | { readonly kind: 'curve'; readonly time: number; readonly endTime: number };

export type FakeParam = SchedulableParam & {
  readonly calls: RecordedCall[];
  readonly valueAssignments: number[];
};

export function createFakeParam(): FakeParam {
  const calls: RecordedCall[] = [];
  const valueAssignments: number[] = [];
  const automationEvents: FakeAutomationEvent[] = [];
  let currentValue = 0;

  function assertFinite(label: string, ...numbers: number[]): void {
    for (const value of numbers) {
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `${label}: non-finite argument ${String(value)} (WebIDL double)`,
        );
      }
    }
  }

  function assertOutsideCurveWindows(label: string, time: number): void {
    for (const event of automationEvents) {
      // CLOSED right boundary: Tone's standardized-audio-context wrapper
      // rejects an event bit-equal to a curve's end (stricter than the
      // spec's [T, T+D)) — the fake models the strictest real target.
      if (
        event.kind === 'curve' &&
        time >= event.time &&
        time <= event.endTime
      ) {
        throw new Error(
          `NotSupportedError: ${label} at ${time} lands inside an existing ` +
            `setValueCurveAtTime window [${event.time}, ${event.endTime}]`,
        );
      }
    }
  }

  return {
    calls,
    valueAssignments,
    get value() {
      return currentValue;
    },
    set value(nextValue: number) {
      currentValue = nextValue;
      valueAssignments.push(nextValue);
    },
    setValueAtTime(value, startTime) {
      assertFinite('setValueAtTime', value, startTime);
      assertOutsideCurveWindows('setValueAtTime', startTime);
      automationEvents.push({ kind: 'point', time: startTime });
      calls.push({ method: 'setValueAtTime', args: [value, startTime] });
      return undefined;
    },
    linearRampToValueAtTime(value, endTime) {
      assertFinite('linearRampToValueAtTime', value, endTime);
      assertOutsideCurveWindows('linearRampToValueAtTime', endTime);
      automationEvents.push({ kind: 'point', time: endTime });
      calls.push({
        method: 'linearRampToValueAtTime',
        args: [value, endTime],
      });
      return undefined;
    },
    setValueCurveAtTime(values, startTime, duration) {
      assertFinite('setValueCurveAtTime', startTime, duration);
      for (const sample of values) {
        assertFinite('setValueCurveAtTime sample', sample);
      }
      if (values.length < 2) {
        throw new Error(
          'InvalidStateError: setValueCurveAtTime needs ≥ 2 samples',
        );
      }
      assertOutsideCurveWindows('setValueCurveAtTime', startTime);
      // The engine computes the window end from the passed doubles.
      const endTime = startTime + duration;
      for (const event of automationEvents) {
        if (event.time >= startTime && event.time <= endTime) {
          throw new Error(
            `NotSupportedError: existing event at ${event.time} lies inside ` +
              `the new setValueCurveAtTime window [${startTime}, ${endTime}]`,
          );
        }
      }
      automationEvents.push({ kind: 'curve', time: startTime, endTime });
      calls.push({
        method: 'setValueCurveAtTime',
        args: [values, startTime, duration],
      });
      return undefined;
    },
    cancelScheduledValues(cancelTime) {
      assertFinite('cancelScheduledValues', cancelTime);
      // Spec: removes events with time ≥ cancelTime; an in-flight curve
      // (started before, ending after) is removed WHOLE.
      for (let index = automationEvents.length - 1; index >= 0; index -= 1) {
        const event = automationEvents[index];
        const removes =
          event.time >= cancelTime ||
          (event.kind === 'curve' && event.endTime > cancelTime);
        if (removes) {
          automationEvents.splice(index, 1);
        }
      }
      calls.push({ method: 'cancelScheduledValues', args: [cancelTime] });
      return undefined;
    },
  };
}

export type FakeDriverNode = DriverNode & {
  readonly offset: FakeParam;
  startCallCount: number;
  stopCallCount: number;
  disconnectCallCount: number;
};

export type FakeContext = TimelineAudioContextLike & {
  currentTime: number;
};

export function createFakeContext(): {
  context: FakeContext;
  createdNodes: FakeDriverNode[];
} {
  const createdNodes: FakeDriverNode[] = [];
  const context: FakeContext = {
    currentTime: 0,
    createConstantSource() {
      const node: FakeDriverNode = {
        offset: createFakeParam(),
        startCallCount: 0,
        stopCallCount: 0,
        disconnectCallCount: 0,
        start() {
          node.startCallCount += 1;
          return undefined;
        },
        stop() {
          node.stopCallCount += 1;
          return undefined;
        },
        disconnect() {
          node.disconnectCallCount += 1;
          return undefined;
        },
      };
      createdNodes.push(node);
      return node;
    },
  };
  return { context, createdNodes };
}

export function createFakeTimers(): {
  timers: TimelineTransportTimers;
  tick(): void;
  activeCount(): number;
} {
  let nextHandle = 1;
  const activeHandlers = new Map<number, () => void>();
  return {
    timers: {
      setInterval(handler) {
        const handle = nextHandle;
        nextHandle += 1;
        activeHandlers.set(handle, handler);
        return handle;
      },
      clearInterval(handle) {
        activeHandlers.delete(handle as number);
      },
    },
    tick() {
      for (const handler of [...activeHandlers.values()]) {
        handler();
      }
    },
    activeCount() {
      return activeHandlers.size;
    },
  };
}

export function createManualCoalescer(): {
  coalesce(flush: () => void): void;
  flushAll(): void;
  pendingCount(): number;
} {
  const pendingFlushes: Array<() => void> = [];
  return {
    coalesce(flush) {
      pendingFlushes.push(flush);
    },
    flushAll() {
      for (const flush of pendingFlushes.splice(0)) {
        flush();
      }
    },
    pendingCount() {
      return pendingFlushes.length;
    },
  };
}

/** Flatten a param's recorded method names. */
export function methodsOf(param: FakeParam): string[] {
  return param.calls.map((call) => call.method);
}

export function countMethod(param: FakeParam, method: string): number {
  return param.calls.filter((call) => call.method === method).length;
}
