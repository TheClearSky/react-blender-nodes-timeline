/**
 * Framework-free document store (plan §14, review UI-11): subscribe +
 * getDocument for `useSyncExternalStore` in the editor, and the same plain
 * getter for the transport runtime. Documents are treated as immutable —
 * setDocument replaces the whole snapshot and notifies.
 *
 * The store does NOT call the transport; the app (or provider glue) is
 * responsible for calling transport.notifyDocumentChanged() after edits so
 * playing audio reschedules (kept separate so the store stays usable
 * without any audio context).
 */
import type { TimelineDocument } from '../model/types';

export type TimelineDocumentStore = {
  getDocument(): TimelineDocument;
  setDocument(nextDocument: TimelineDocument): void;
  subscribe(listener: () => void): () => void;
};

export function createTimelineDocumentStore(
  initialDocument: TimelineDocument,
): TimelineDocumentStore {
  let currentDocument = initialDocument;
  const listeners = new Set<() => void>();
  return {
    getDocument: () => currentDocument,
    setDocument(nextDocument) {
      if (nextDocument === currentDocument) {
        return;
      }
      currentDocument = nextDocument;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A fresh valid document: 8 s, looping, no curves (the §8 empty state). */
export function createEmptyTimelineDocument(): TimelineDocument {
  return { version: 1, durationSec: 8, loop: true, curves: [] };
}
