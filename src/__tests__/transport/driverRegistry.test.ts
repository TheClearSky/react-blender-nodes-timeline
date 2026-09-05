/**
 * §9.1 pins for the driver registry (EM-13/EM-14): one driver per
 * (curve, build), isNew only on first acquire, silence-safe initial
 * offset, releaseBuild prunes exactly its build, subscription semantics.
 */
import { describe, expect, it } from 'vitest';
import { createTimelineDriverRegistry } from '../../transport/driverRegistry';
import { createFakeContext } from './fakes';

describe('driver registry', () => {
  it('acquire creates + starts one node at offset 0 and reports isNew', () => {
    const { context, createdNodes } = createFakeContext();
    const registry = createTimelineDriverRegistry(context);
    let notifications = 0;
    registry.subscribe(() => {
      notifications += 1;
    });

    const first = registry.acquireDriver('crv_a', 1);
    expect(first.isNew).toBe(true);
    expect(createdNodes.length).toBe(1);
    expect(createdNodes[0].startCallCount).toBe(1);
    expect(createdNodes[0].offset.valueAssignments).toEqual([0]);
    expect(registry.getLiveDrivers().length).toBe(1);
    expect(notifications).toBe(1);
  });

  it('re-acquire of the same (curve, build) returns the SAME node, no notify', () => {
    const { context, createdNodes } = createFakeContext();
    const registry = createTimelineDriverRegistry(context);
    let notifications = 0;
    registry.subscribe(() => {
      notifications += 1;
    });

    const first = registry.acquireDriver('crv_a', 1);
    const second = registry.acquireDriver('crv_a', 1);
    expect(second.isNew).toBe(false);
    expect(second.node).toBe(first.node);
    expect(createdNodes.length).toBe(1);
    expect(createdNodes[0].startCallCount).toBe(1);
    expect(notifications).toBe(1);
  });

  it('same curve in a NEW build gets a new driver', () => {
    const { context, createdNodes } = createFakeContext();
    const registry = createTimelineDriverRegistry(context);
    registry.acquireDriver('crv_a', 1);
    const nextBuild = registry.acquireDriver('crv_a', 2);
    expect(nextBuild.isNew).toBe(true);
    expect(createdNodes.length).toBe(2);
    expect(registry.getLiveDrivers().length).toBe(2);
  });

  it('releaseBuild prunes exactly that build and notifies once', () => {
    const { context } = createFakeContext();
    const registry = createTimelineDriverRegistry(context);
    registry.acquireDriver('crv_a', 1);
    registry.acquireDriver('crv_b', 1);
    registry.acquireDriver('crv_a', 2);
    let notifications = 0;
    registry.subscribe(() => {
      notifications += 1;
    });

    registry.releaseBuild(1);
    expect(notifications).toBe(1);
    const survivors = registry.getLiveDrivers();
    expect(survivors.length).toBe(1);
    expect(survivors[0].buildId).toBe(2);

    registry.releaseBuild(1);
    expect(notifications).toBe(1);
  });

  it('numeric and string buildIds are DISTINCT builds (EN-7)', () => {
    const { context, createdNodes } = createFakeContext();
    const registry = createTimelineDriverRegistry(context);
    const numeric = registry.acquireDriver('crv_a', 1);
    const stringy = registry.acquireDriver('crv_a', '1');
    expect(numeric.isNew).toBe(true);
    expect(stringy.isNew).toBe(true);
    expect(createdNodes.length).toBe(2);
    registry.releaseBuild('1');
    const survivors = registry.getLiveDrivers();
    expect(survivors.length).toBe(1);
    expect(survivors[0].buildId).toBe(1);
  });

  it('acquire after a build was released throws (EN-8)', () => {
    const { context } = createFakeContext();
    const registry = createTimelineDriverRegistry(context);
    registry.acquireDriver('crv_a', 1);
    registry.releaseBuild(1);
    expect(() => registry.acquireDriver('crv_b', 1)).toThrow(
      /already released/,
    );
  });

  it('releaseAll prunes every build and notifies once (EN-8)', () => {
    const { context } = createFakeContext();
    const registry = createTimelineDriverRegistry(context);
    registry.acquireDriver('crv_a', 1);
    registry.acquireDriver('crv_b', 2);
    let notifications = 0;
    registry.subscribe(() => {
      notifications += 1;
    });
    registry.releaseAll();
    expect(registry.getLiveDrivers().length).toBe(0);
    expect(notifications).toBe(1);
    registry.releaseAll();
    expect(notifications).toBe(1);
  });

  it('unsubscribe stops notifications', () => {
    const { context } = createFakeContext();
    const registry = createTimelineDriverRegistry(context);
    let notifications = 0;
    const unsubscribe = registry.subscribe(() => {
      notifications += 1;
    });
    unsubscribe();
    registry.acquireDriver('crv_a', 1);
    expect(notifications).toBe(0);
  });
});
