/**
 * Driver registry (plan §5.2, review EM-13/EM-14). One driver — a
 * ConstantSourceNode built via the injected context FACTORY — per
 * (curve, build). `acquireDriver` returns `{ node, isNew }`: only the
 * FIRST acquiring impl registers the node for disposal in the app's build
 * registry (shared curves fan out from one driver). `releaseBuild` only
 * PRUNES entries — stopping/disconnecting the nodes is the app's job
 * through its own disposal registry, so there is exactly one owner. The
 * transport schedules ONLY onto live entries and subscribes here to learn
 * about build swaps.
 *
 * Keys are a nested Map<buildId, Map<curveId, entry>> (review EN-7): a
 * string build "1" and a numeric build 1 are DIFFERENT builds, and no
 * string concatenation exists for hostile curve ids to collide through.
 * Acquiring under an already-RELEASED buildId throws (review EN-8) — the
 * releasing side has already run its disposal, so a late acquire would
 * mint a driver nothing will ever release.
 */
import type { DriverNode, TimelineAudioContextLike } from './seamTypes';

export type DriverRegistryEntry = {
  readonly curveId: string;
  readonly buildId: string | number;
  readonly node: DriverNode;
};

export type AcquireDriverResult = {
  readonly node: DriverNode;
  readonly isNew: boolean;
};

export type TimelineDriverRegistry = {
  acquireDriver(curveId: string, buildId: string | number): AcquireDriverResult;
  releaseBuild(buildId: string | number): void;
  /** Prune EVERY build (consumer teardown, review EN-8). */
  releaseAll(): void;
  getLiveDrivers(): readonly DriverRegistryEntry[];
  subscribe(listener: () => void): () => void;
};

export function createTimelineDriverRegistry(
  context: TimelineAudioContextLike,
): TimelineDriverRegistry {
  const buildEntries = new Map<
    string | number,
    Map<string, DriverRegistryEntry>
  >();
  const releasedBuildIds = new Set<string | number>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  return {
    acquireDriver(curveId, buildId) {
      if (releasedBuildIds.has(buildId)) {
        throw new Error(
          `acquireDriver: build ${String(buildId)} was already released — ` +
            'a driver minted now would never be disposed (check for async ' +
            'work outliving its build)',
        );
      }
      let curveEntries = buildEntries.get(buildId);
      if (curveEntries === undefined) {
        curveEntries = new Map();
        buildEntries.set(buildId, curveEntries);
      }
      const existing = curveEntries.get(curveId);
      if (existing !== undefined) {
        return { node: existing.node, isNew: false };
      }
      const node = context.createConstantSource();
      // Silence-safe default until the transport's registry listener
      // anchors the real curve value (ConstantSource offset defaults to 1).
      node.offset.value = 0;
      node.start();
      curveEntries.set(curveId, { curveId, buildId, node });
      notify();
      return { node, isNew: true };
    },

    releaseBuild(buildId) {
      releasedBuildIds.add(buildId);
      if (buildEntries.delete(buildId)) {
        notify();
      }
    },

    releaseAll() {
      const hadEntries = buildEntries.size > 0;
      for (const buildId of buildEntries.keys()) {
        releasedBuildIds.add(buildId);
      }
      buildEntries.clear();
      if (hadEntries) {
        notify();
      }
    },

    getLiveDrivers() {
      const entries: DriverRegistryEntry[] = [];
      for (const curveEntries of buildEntries.values()) {
        for (const entry of curveEntries.values()) {
          entries.push(entry);
        }
      }
      return entries;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
