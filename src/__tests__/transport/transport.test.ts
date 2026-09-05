/**
 * §9.1 transport pins on fakes: play performs ZERO cancels; pause =
 * cancel+hold (UI-10); stop = cancel+anchor curve(0); clean loop wrap =
 * append-only with NO cancel (EM-05); natural end → ENDED with zero param
 * calls (EM-15); scrub clamps (EM-22.3) and previews a bounded window
 * (EM-22.4); edits coalesce to ONE reschedule (EM-08) and flush from the
 * interval when rAF is dead (EM-16); registry swaps reschedule and
 * released drivers stop being scheduled (EM-13/14).
 */
import { describe, expect, it } from 'vitest';
import type { TimelineCurve, TimelineDocument } from '../../model/types';
import { evaluateCurve } from '../../model/evaluate';
import { createTimelineDriverRegistry } from '../../transport/driverRegistry';
import {
  createTimelineTransport,
  type CreateTimelineTransportOptions,
} from '../../transport/transport';
import {
  countMethod,
  createFakeContext,
  createFakeTimers,
  createManualCoalescer,
  methodsOf,
  type FakeDriverNode,
} from './fakes';

const demoCutoffCurve: TimelineCurve = {
  id: 'crv_cutoff',
  name: 'cutoff',
  color: '#f59e0b',
  defaultValue: 800,
  points: [
    { t: 0, v: 400, leftInterp: 'linear', rightInterp: 'ease' },
    { t: 2, v: 2000, leftInterp: 'linear', rightInterp: 'step' },
    { t: 5, v: 2000, leftInterp: 'linear', rightInterp: 'linear' },
    { t: 8, v: 400, leftInterp: 'ease', rightInterp: 'linear' },
  ],
};

const demoDocument: TimelineDocument = {
  version: 1,
  durationSec: 8,
  loop: true,
  curves: [demoCutoffCurve],
};

function makeLinearDocument(loop: boolean, durationSec: number) {
  const document: TimelineDocument = {
    version: 1,
    durationSec,
    loop,
    curves: [
      {
        id: 'crv_line',
        name: 'line',
        color: '#fff',
        defaultValue: 0,
        points: [
          { t: 0, v: 5, leftInterp: 'linear', rightInterp: 'linear' },
          {
            t: durationSec,
            v: 15,
            leftInterp: 'linear',
            rightInterp: 'linear',
          },
        ],
      },
    ],
  };
  return document;
}

function setup(
  initialDocument: TimelineDocument,
  transportOverrides?: Partial<CreateTimelineTransportOptions>,
) {
  const { context, createdNodes } = createFakeContext();
  const registry = createTimelineDriverRegistry(context);
  const fakeTimers = createFakeTimers();
  const coalescer = createManualCoalescer();
  let currentDocument = initialDocument;
  const transport = createTimelineTransport({
    context,
    registry,
    getDocument: () => currentDocument,
    timers: fakeTimers.timers,
    coalesce: coalescer.coalesce,
    lookaheadSeconds: 2,
    scrubWindowSeconds: 2,
    intervalMs: 250,
    // Exact-time pins run headroom-free; the default is pinned separately.
    scheduleHeadroomSeconds: 0,
    ...transportOverrides,
  });
  return {
    context,
    registry,
    fakeTimers,
    coalescer,
    transport,
    createdNodes,
    setDocument(next: TimelineDocument) {
      currentDocument = next;
    },
  };
}

function totalCancels(nodes: readonly FakeDriverNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + countMethod(node.offset, 'cancelScheduledValues'),
    0,
  );
}

describe('play', () => {
  it('opens with ONE startup cancel sweep, then the anchor set', () => {
    const { registry, transport, createdNodes, fakeTimers } = setup(
      makeLinearDocument(true, 8),
    );
    registry.acquireDriver('crv_line', 1);
    const offset = createdNodes[0].offset;
    // Parked registry change refreshes the offset VALUE (no automation).
    expect(offset.valueAssignments).toEqual([0, 5]);
    expect(offset.calls).toEqual([]);

    transport.play();
    expect(transport.getState()).toBe('playing');
    expect(fakeTimers.activeCount()).toBe(1);
    // Exactly the startup sweep — no other cancels.
    expect(totalCancels(createdNodes)).toBe(1);
    expect(offset.calls).toEqual([
      { method: 'cancelScheduledValues', args: [0] },
      { method: 'setValueAtTime', args: [5, 0] },
      { method: 'linearRampToValueAtTime', args: [15, 8] },
      { method: 'setValueAtTime', args: [15, 8] },
    ]);
  });

  it('playhead follows the context clock and wraps for display', () => {
    const shortLoop = setup(makeLinearDocument(true, 1));
    shortLoop.registry.acquireDriver('crv_line', 1);
    shortLoop.transport.play();
    shortLoop.context.currentTime = 1.25;
    expect(shortLoop.transport.getPlayheadTime()).toBeCloseTo(0.25, 9);
  });
});

describe('loop wrap (EM-05)', () => {
  it('appends the next pass with ZERO cancel calls', () => {
    const { registry, transport, createdNodes, context, fakeTimers } = setup(
      makeLinearDocument(true, 1),
    );
    registry.acquireDriver('crv_line', 1);
    transport.play();
    const offset = createdNodes[0].offset;
    // lookahead 2 s over a 1 s document: play writes cycles 0 and 1
    // (preceded by its single startup sweep).
    expect(offset.calls.length).toBe(7);
    expect(offset.calls[4]).toEqual({
      method: 'setValueAtTime',
      args: [5, 1],
    });

    context.currentTime = 0.6;
    fakeTimers.tick();
    expect(offset.calls.length).toBe(10);
    expect(offset.calls[7]).toEqual({
      method: 'setValueAtTime',
      args: [5, 2],
    });
    // The ONLY cancel is play's startup sweep; the wraps added ZERO.
    expect(totalCancels(createdNodes)).toBe(1);
  });
});

describe('natural end with loop off (EM-15)', () => {
  it('parks at the end with zero extra param calls, play restarts at 0', () => {
    const { registry, transport, createdNodes, context, fakeTimers } = setup(
      makeLinearDocument(false, 1),
    );
    registry.acquireDriver('crv_line', 1);
    transport.play();
    const offset = createdNodes[0].offset;
    const callsAtPlay = offset.calls.length;

    context.currentTime = 1.05;
    fakeTimers.tick();
    expect(transport.getState()).toBe('ended');
    expect(transport.getPlayheadTime()).toBe(1);
    expect(offset.calls.length).toBe(callsAtPlay);
    expect(fakeTimers.activeCount()).toBe(0);

    transport.play();
    expect(transport.getState()).toBe('playing');
    expect(transport.getPlayheadTime()).toBeCloseTo(0, 9);
    // Restarted pass: startup sweep, then the anchor set.
    expect(offset.calls[callsAtPlay].method).toBe('cancelScheduledValues');
    expect(offset.calls[callsAtPlay + 1]).toEqual({
      method: 'setValueAtTime',
      args: [5, 1.05],
    });
    expect(totalCancels(createdNodes)).toBe(2);
  });

  it('scrub while ENDED re-parks as paused and play resumes there', () => {
    const { registry, transport, context, fakeTimers, createdNodes } = setup(
      makeLinearDocument(false, 1),
    );
    registry.acquireDriver('crv_line', 1);
    transport.play();
    context.currentTime = 1.05;
    fakeTimers.tick();
    expect(transport.getState()).toBe('ended');

    transport.scrub(0.5);
    expect(transport.getState()).toBe('paused');
    expect(transport.getPlayheadTime()).toBe(0.5);
    const offset = createdNodes[0].offset;
    const lastTwo = offset.calls.slice(-2);
    expect(lastTwo[0].method).toBe('cancelScheduledValues');
    expect(lastTwo[1].method).toBe('setValueAtTime');
    // Solver interval 1e−9 × the segment's value slope bounds the error
    // near 5e−9, so precision 7 is the tightest safe pin.
    expect(lastTwo[1].args[0]).toBeCloseTo(10, 7);

    transport.play();
    expect(transport.getPlayheadTime()).toBeCloseTo(0.5, 9);
  });
});

describe('pause and stop (UI-10)', () => {
  it('pause cancels then holds curve(t); playhead freezes', () => {
    const { registry, transport, createdNodes, context, fakeTimers } =
      setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.play();
    context.currentTime = 1.065;
    transport.pause();

    const offset = createdNodes[0].offset;
    const lastTwo = offset.calls.slice(-2);
    expect(lastTwo[0]).toEqual({
      method: 'cancelScheduledValues',
      args: [1.065],
    });
    expect(lastTwo[1].method).toBe('setValueAtTime');
    expect(lastTwo[1].args[0]).toBeCloseTo(1000, 3);
    // One ulp after `now` — post-cancel anchors bump past the closed edge.
    expect(lastTwo[1].args[1] as number).toBeCloseTo(1.065, 9);
    expect(lastTwo[1].args[1] as number).toBeGreaterThan(1.065);
    expect(transport.getState()).toBe('paused');
    expect(fakeTimers.activeCount()).toBe(0);

    context.currentTime = 5;
    expect(transport.getPlayheadTime()).toBe(1.065);
  });

  it('resume replays from the pause point (startup sweep + partial curve)', () => {
    const { registry, transport, createdNodes, context } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.play();
    context.currentTime = 1.065;
    transport.pause();
    const offset = createdNodes[0].offset;
    const cancelsAfterPause = totalCancels(createdNodes);
    const callCountAfterPause = offset.calls.length;

    context.currentTime = 5;
    transport.play();
    expect(totalCancels(createdNodes)).toBe(cancelsAfterPause + 1);
    const firstResumeCall = offset.calls[callCountAfterPause + 1];
    expect(firstResumeCall.method).toBe('setValueCurveAtTime');
    // One ulp past `now` — the startup sweep arms the closed cancel edge.
    expect(firstResumeCall.args[1] as number).toBeCloseTo(5, 9);
    expect(firstResumeCall.args[1] as number).toBeGreaterThanOrEqual(5);
    const resumeValues = firstResumeCall.args[0] as Float32Array;
    expect(resumeValues[0]).toBeCloseTo(
      evaluateCurve(demoCutoffCurve, 1.065),
      2,
    );
  });

  it('stop cancels and anchors curve(0)', () => {
    const { registry, transport, createdNodes, context } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.play();
    context.currentTime = 3;
    transport.stop();
    const offset = createdNodes[0].offset;
    const lastTwo = offset.calls.slice(-2);
    expect(lastTwo[0]).toEqual({ method: 'cancelScheduledValues', args: [3] });
    expect(lastTwo[1].method).toBe('setValueAtTime');
    expect(lastTwo[1].args[0]).toBe(400);
    expect(lastTwo[1].args[1] as number).toBeCloseTo(3, 9);
    expect(transport.getState()).toBe('stopped');
    expect(transport.getPlayheadTime()).toBe(0);
  });
});

describe('scrub (EM-22.3 / EM-22.4)', () => {
  it('while stopped: cancel + anchor, playhead moves, state unchanged', () => {
    const { registry, transport, createdNodes } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.scrub(3);
    const offset = createdNodes[0].offset;
    expect(methodsOf(offset)).toEqual([
      'cancelScheduledValues',
      'setValueAtTime',
    ]);
    expect(offset.calls[1].args[0]).toBe(2000);
    expect(offset.calls[1].args[1] as number).toBeCloseTo(0, 9);
    expect(transport.getPlayheadTime()).toBe(3);
    expect(transport.getState()).toBe('stopped');
  });

  it('clamps into [0, durationSec]', () => {
    const { registry, transport } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.scrub(99);
    expect(transport.getPlayheadTime()).toBe(8);
    transport.scrub(-5);
    expect(transport.getPlayheadTime()).toBe(0);
  });

  it('while playing: cancel, re-anchor clock, reschedule remainder', () => {
    const { registry, transport, createdNodes, context } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.play();
    context.currentTime = 2;
    transport.scrub(6);
    const offset = createdNodes[0].offset;
    // Play's startup sweep + the scrub's cancel.
    expect(totalCancels(createdNodes)).toBe(2);
    const afterCancel = offset.calls.slice(-2);
    expect(afterCancel[0].method).toBe('setValueCurveAtTime');
    // The play-pass curve [0,2] SURVIVES the cancel (it is past at now=2)
    // and keeps a closed right edge — the new partial curve bumps one ulp
    // past it.
    expect(afterCancel[0].args[1] as number).toBeCloseTo(2, 9);
    expect(afterCancel[0].args[1] as number).toBeGreaterThan(2);
    expect(afterCancel[0].args[2]).toBe(2);
    expect(afterCancel[1].method).toBe('setValueAtTime');
    expect(afterCancel[1].args[0]).toBe(400);
    // One ulp after the curve end (closed-boundary rule).
    expect(afterCancel[1].args[1] as number).toBeCloseTo(4, 9);
    expect(transport.getPlayheadTime()).toBeCloseTo(6, 9);
  });

  it('preview scrub writes only the ~2 s window; commit writes the rest', () => {
    const { registry, transport, createdNodes } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.play();
    const offset = createdNodes[0].offset;

    transport.scrub(1, { preview: true });
    // Play's startup sweep is the FIRST cancel; the preview scrub's is the
    // second — slice after that one.
    const cancelIndices = offset.calls
      .map((call, index) =>
        call.method === 'cancelScheduledValues' ? index : -1,
      )
      .filter((index) => index !== -1);
    const previewCalls = offset.calls.slice(cancelIndices[1] + 1);
    // Window [1, 3] mapped to ctx [0, 2]: partial curve, step set, terminal.
    expect(previewCalls.map((call) => call.method)).toEqual([
      'setValueCurveAtTime',
      'setValueAtTime',
      'setValueAtTime',
    ]);
    expect(previewCalls[2].args[0]).toBe(2000);
    expect(previewCalls[2].args[1] as number).toBeCloseTo(2, 9);

    transport.scrub(1);
    const commitTerminal = offset.calls[offset.calls.length - 1];
    expect(commitTerminal.args[0]).toBe(400);
    expect(commitTerminal.args[1] as number).toBeCloseTo(7, 9);
  });
});

describe('document edits (EM-08 / EM-16 / EM-22.5)', () => {
  function editDemoValueAt2(nextValue: number): TimelineDocument {
    return {
      ...demoDocument,
      curves: [
        {
          ...demoCutoffCurve,
          points: demoCutoffCurve.points.map((point) =>
            point.t === 2 ? { ...point, v: nextValue } : point,
          ),
        },
      ],
    };
  }

  it('coalesces N notifications into ONE reschedule from current t', () => {
    const {
      registry,
      transport,
      createdNodes,
      context,
      coalescer,
      setDocument,
    } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.play();
    context.currentTime = 1;
    setDocument(editDemoValueAt2(3000));
    transport.notifyDocumentChanged(['crv_cutoff']);
    transport.notifyDocumentChanged(['crv_cutoff']);
    expect(coalescer.pendingCount()).toBe(1);

    coalescer.flushAll();
    // Play's startup sweep + the coalesced edit flush.
    expect(totalCancels(createdNodes)).toBe(2);
    const offset = createdNodes[0].offset;
    const cancelIndex = methodsOf(offset).lastIndexOf('cancelScheduledValues');
    const firstAfterCancel = offset.calls[cancelIndex + 1];
    expect(firstAfterCancel.method).toBe('setValueCurveAtTime');
    const values = firstAfterCancel.args[0] as Float32Array;
    expect(values[values.length - 1]).toBeCloseTo(3000, 2);
  });

  it('the interval force-flushes a pending edit when rAF never fires', () => {
    const {
      registry,
      transport,
      createdNodes,
      context,
      coalescer,
      fakeTimers,
    } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.play();
    context.currentTime = 1;
    transport.notifyDocumentChanged();
    // Only play's startup sweep so far — the edit has not flushed.
    expect(totalCancels(createdNodes)).toBe(1);

    fakeTimers.tick();
    expect(totalCancels(createdNodes)).toBe(2);

    coalescer.flushAll();
    expect(totalCancels(createdNodes)).toBe(2);
  });

  it('edit while paused refreshes the held value; duration shrink clamps', () => {
    const {
      registry,
      transport,
      createdNodes,
      context,
      coalescer,
      setDocument,
    } = setup(makeLinearDocument(true, 8));
    registry.acquireDriver('crv_line', 1);
    transport.play();
    context.currentTime = 7;
    transport.pause();
    expect(transport.getPlayheadTime()).toBe(7);

    setDocument(makeLinearDocument(true, 6));
    transport.notifyDocumentChanged();
    coalescer.flushAll();
    expect(transport.getPlayheadTime()).toBe(6);
    const offset = createdNodes[0].offset;
    const lastCall = offset.calls[offset.calls.length - 1];
    expect(lastCall.method).toBe('setValueAtTime');
    expect(lastCall.args[0]).toBeCloseTo(15, 9);
  });
});

describe('registry lifecycle (EM-13 / EM-14)', () => {
  it('acquire while parked sets the offset value directly, no automation', () => {
    const { registry, createdNodes } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    const offset = createdNodes[0].offset;
    expect(offset.calls).toEqual([]);
    expect(offset.valueAssignments).toEqual([0, 400]);
  });

  it('acquire while playing reschedules (coalesced) onto the new driver', () => {
    const { registry, transport, createdNodes, coalescer } =
      setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.play();
    registry.acquireDriver('crv_cutoff', 2);
    const newOffset = createdNodes[1].offset;
    expect(newOffset.calls).toEqual([]);

    coalescer.flushAll();
    expect(
      newOffset.calls.some((call) => call.method === 'setValueCurveAtTime'),
    ).toBe(true);
  });

  it('a released driver stops being scheduled', () => {
    const {
      registry,
      transport,
      createdNodes,
      coalescer,
      context,
      fakeTimers,
    } = setup(makeLinearDocument(true, 1));
    registry.acquireDriver('crv_line', 1);
    transport.play();
    registry.acquireDriver('crv_line', 2);
    coalescer.flushAll();
    const oldOffset = createdNodes[0].offset;

    registry.releaseBuild(1);
    coalescer.flushAll();
    const oldCallsAfterRelease = oldOffset.calls.length;

    context.currentTime = 0.9;
    fakeTimers.tick();
    expect(oldOffset.calls.length).toBe(oldCallsAfterRelease);
    const newOffset = createdNodes[1].offset;
    expect(newOffset.calls.length).toBeGreaterThan(0);
  });

  it('missing curve reference anchors a constant 0', () => {
    const { registry, transport, createdNodes } = setup(demoDocument);
    registry.acquireDriver('crv_ghost', 1);
    transport.play();
    const offset = createdNodes[0].offset;
    expect(offset.calls).toEqual([
      { method: 'cancelScheduledValues', args: [0] },
      { method: 'setValueAtTime', args: [0, 0] },
    ]);
  });

  it('notifyBuildEnded reschedules once while playing', () => {
    const { registry, transport, coalescer } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.play();
    transport.notifyBuildEnded();
    transport.notifyBuildEnded();
    expect(coalescer.pendingCount()).toBe(1);
  });
});

describe('float-boundary + axis discipline (EN-1/EN-2/EN-3/EN-6/EN-9)', () => {
  function makeCurvedDocument(durationSec: number): TimelineDocument {
    // Two ADJACENT curved segments + non-representable interior time — the
    // EN-1 hazard shape (curve event ending exactly where the next starts).
    return {
      version: 1,
      durationSec,
      loop: true,
      curves: [
        {
          id: 'crv_wavy',
          name: 'wavy',
          color: '#fff',
          defaultValue: 0,
          points: [
            { t: 0, v: 0, leftInterp: 'ease', rightInterp: 'ease' },
            {
              t: durationSec * 0.37,
              v: 10,
              leftInterp: 'ease',
              rightInterp: 'ease',
            },
            { t: durationSec, v: 0, leftInterp: 'ease', rightInterp: 'ease' },
          ],
        },
      ],
    };
  }

  it('survives a 500-wrap marathon with non-representable anchor + duration, zero errors, zero wrap cancels', () => {
    const durationSec = 8.3; // not representable in binary
    const scheduleErrors: unknown[] = [];
    const {
      registry,
      transport,
      context,
      fakeTimers,
      coalescer,
      createdNodes,
      setDocument,
    } = setup(makeCurvedDocument(durationSec), {
      onScheduleError: (error) => scheduleErrors.push(error),
    });
    registry.acquireDriver('crv_wavy', 1);
    transport.scrub(0.1 + 0.2); // 0.30000000000000004 parked anchor
    transport.play();
    // Mid-play edit → re-anchor at a full-mantissa wrapped time.
    context.currentTime = 1.2345678901234567;
    setDocument(makeCurvedDocument(durationSec));
    transport.notifyDocumentChanged();
    coalescer.flushAll();
    for (let step = 0; step < 500; step += 1) {
      context.currentTime += durationSec * 0.93;
      fakeTimers.tick(); // the spec-faithful fake THROWS on window violations
    }
    expect(scheduleErrors).toEqual([]);
    expect(transport.getState()).toBe('playing');
    // Cancels: the scrub + play's startup sweep + the edit flush; the
    // hundreds of wraps added ZERO.
    expect(totalCancels(createdNodes)).toBe(3);
  });

  it('duration GROWTH mid-play keeps the true position (EN-3a)', () => {
    const { registry, transport, context, coalescer, setDocument } = setup(
      makeLinearDocument(true, 8),
    );
    registry.acquireDriver('crv_line', 1);
    transport.play();
    context.currentTime = 13.5; // absolute 13.5 → wrapped 5.5 under dur 8
    setDocument({ ...makeLinearDocument(true, 8), durationSec: 10 });
    transport.notifyDocumentChanged();
    coalescer.flushAll();
    // NOT 13.5 % 10 = 3.5 — the old axis interprets the absolute time.
    expect(transport.getPlayheadTime()).toBeCloseTo(5.5, 9);
  });

  it('loop toggled OFF mid-cycle finishes the current cycle then ends (EN-3b)', () => {
    const { registry, transport, context, coalescer, fakeTimers, setDocument } =
      setup(makeLinearDocument(true, 1));
    registry.acquireDriver('crv_line', 1);
    transport.play();
    context.currentTime = 1.4; // wrapped 0.4 in cycle 1
    setDocument(makeLinearDocument(false, 1));
    transport.notifyDocumentChanged();
    coalescer.flushAll();
    expect(transport.getState()).toBe('playing');
    expect(transport.getPlayheadTime()).toBeCloseTo(0.4, 9);
    context.currentTime = 2.1; // +0.7 under the new axis → past the end
    fakeTimers.tick();
    expect(transport.getState()).toBe('ended');
    expect(transport.getPlayheadTime()).toBe(1);
  });

  it('duration SHRINK mid-play clamps to the new end, never re-wraps (EN-3d)', () => {
    const { registry, transport, context, coalescer, setDocument } = setup(
      makeLinearDocument(true, 8),
    );
    registry.acquireDriver('crv_line', 1);
    transport.play();
    context.currentTime = 7;
    setDocument(makeLinearDocument(true, 6));
    transport.notifyDocumentChanged();
    coalescer.flushAll();
    // Clamped to 6 = the loop seam (displays as 0) — NOT 7 % 6 = 1.
    expect(transport.getPlayheadTime()).toBeCloseTo(0, 9);
  });

  it('play() while parked at the end with loop off restarts at 0 (EN-9)', () => {
    const { registry, transport, createdNodes } = setup(
      makeLinearDocument(false, 1),
    );
    registry.acquireDriver('crv_line', 1);
    transport.scrub(1); // parked at the end, state stays stopped
    transport.play();
    expect(transport.getState()).toBe('playing');
    expect(transport.getPlayheadTime()).toBeCloseTo(0, 9);
    const offset = createdNodes[0].offset;
    expect(
      offset.calls.some(
        (call) => call.method === 'setValueAtTime' && call.args[0] === 5,
      ),
    ).toBe(true);
  });

  it('non-finite scrub input is ignored (EN-6)', () => {
    const { registry, transport, createdNodes } = setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    const callsBefore = createdNodes[0].offset.calls.length;
    transport.scrub(NaN);
    transport.scrub(Infinity);
    expect(createdNodes[0].offset.calls.length).toBe(callsBefore);
    expect(transport.getPlayheadTime()).toBe(0);
  });

  it('a throwing driver is quarantined; the others still schedule (EN-2)', () => {
    const twoCurveDocument: TimelineDocument = {
      ...demoDocument,
      curves: [demoCutoffCurve, { ...demoCutoffCurve, id: 'crv_b', name: 'b' }],
    };
    const scheduleErrors: string[] = [];
    const { registry, transport, createdNodes, context, fakeTimers } = setup(
      twoCurveDocument,
      {
        onScheduleError: (_error, curveId) => scheduleErrors.push(curveId),
      },
    );
    registry.acquireDriver('crv_cutoff', 1);
    registry.acquireDriver('crv_b', 1);
    const sabotagedOffset = createdNodes[0].offset;
    (sabotagedOffset as { setValueCurveAtTime: unknown }).setValueCurveAtTime =
      () => {
        throw new Error('NotSupportedError: sabotage');
      };
    transport.play();
    expect(scheduleErrors).toContain('crv_cutoff');
    expect(
      createdNodes[1].offset.calls.some(
        (call) => call.method === 'setValueCurveAtTime',
      ),
    ).toBe(true);
    expect(transport.getState()).toBe('playing');
    // Frontier stayed consistent: the next wrap appends to the healthy
    // driver without any cancel.
    const healthyCallsBefore = createdNodes[1].offset.calls.length;
    context.currentTime = 7;
    fakeTimers.tick();
    expect(createdNodes[1].offset.calls.length).toBeGreaterThan(
      healthyCallsBefore,
    );
    // Only play's startup sweep — the wrap appends added no cancel.
    expect(countMethod(createdNodes[1].offset, 'cancelScheduledValues')).toBe(
      1,
    );
  });
});

describe('schedule headroom (Curve Orchestra finding)', () => {
  it('default headroom anchors the pass in the future; playhead holds at start meanwhile', () => {
    const { registry, transport, createdNodes, context } = setup(
      makeLinearDocument(true, 8),
      { scheduleHeadroomSeconds: undefined }, // use the 0.08 default
    );
    registry.acquireDriver('crv_line', 1);
    context.currentTime = 5;
    transport.play();
    const offset = createdNodes[0].offset;
    // Startup sweep at `now`, then the anchor headroom in the future...
    expect(offset.calls[0].method).toBe('cancelScheduledValues');
    expect(offset.calls[0].args[0]).toBe(5);
    expect(offset.calls[1].method).toBe('setValueAtTime');
    expect(offset.calls[1].args[1]).toBeCloseTo(5.08, 9);
    // ...and the playhead does not run backwards during the headroom.
    expect(transport.getPlayheadTime()).toBe(0);
    context.currentTime = 5.08 + 1;
    expect(transport.getPlayheadTime()).toBeCloseTo(1, 9);
  });
});

describe('subscribe and dispose', () => {
  it('notifies on state transitions', () => {
    const { registry, transport, context, fakeTimers } = setup(
      makeLinearDocument(false, 1),
    );
    registry.acquireDriver('crv_line', 1);
    let notifications = 0;
    transport.subscribe(() => {
      notifications += 1;
    });
    transport.play();
    expect(notifications).toBe(1);
    context.currentTime = 1.05;
    fakeTimers.tick();
    expect(notifications).toBe(2);
  });

  it('dispose clears the interval and makes the transport inert', () => {
    const { registry, transport, createdNodes, fakeTimers } =
      setup(demoDocument);
    registry.acquireDriver('crv_cutoff', 1);
    transport.play();
    transport.dispose();
    expect(fakeTimers.activeCount()).toBe(0);
    const callCount = createdNodes[0].offset.calls.length;
    transport.play();
    transport.scrub(3);
    transport.notifyDocumentChanged();
    expect(createdNodes[0].offset.calls.length).toBe(callCount);
  });
});
