/**
 * §14 store pins: snapshot identity for useSyncExternalStore, notify on
 * replace, same-reference no-op, unsubscribe — plus the empty-document
 * helper staying schema-valid.
 */
import { describe, expect, it } from 'vitest';
import { parseTimelineDocument } from '../../model/schemas';
import {
  createEmptyTimelineDocument,
  createTimelineDocumentStore,
} from '../../store/documentStore';

describe('document store', () => {
  it('getDocument returns a stable snapshot until setDocument', () => {
    const initial = createEmptyTimelineDocument();
    const store = createTimelineDocumentStore(initial);
    expect(store.getDocument()).toBe(initial);
    expect(store.getDocument()).toBe(store.getDocument());

    const next = { ...initial, loop: false };
    store.setDocument(next);
    expect(store.getDocument()).toBe(next);
  });

  it('notifies subscribers on replace; same reference is a no-op', () => {
    const store = createTimelineDocumentStore(createEmptyTimelineDocument());
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.setDocument(store.getDocument());
    expect(notifications).toBe(0);

    store.setDocument({ ...store.getDocument(), durationSec: 12 });
    expect(notifications).toBe(1);

    unsubscribe();
    store.setDocument({ ...store.getDocument(), durationSec: 16 });
    expect(notifications).toBe(1);
  });

  it('createEmptyTimelineDocument is schema-valid', () => {
    const empty = createEmptyTimelineDocument();
    expect(parseTimelineDocument(empty)).toEqual(empty);
  });
});
