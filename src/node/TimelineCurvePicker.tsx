import { useContext, useRef, useSyncExternalStore } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@theclearsky/react-blender-nodes';
import type { TimelineDocument } from '../model/types';
import { TimelineContext } from '../store/TimelineContext';
import type { TimelineDocumentStore } from '../store/documentStore';
import { makeTimelineCurveRef, parseTimelineCurveRef } from './curveRef';

/**
 * The host's InputComponentProps contract, declared STRUCTURALLY so the
 * rolled d.ts never imports the host package (review UI-8). A compile-time
 * assignability check against the real host type lives in
 * src/__tests__/node/curveNode.test.ts.
 */
export type TimelineCurvePickerProps = {
  value: unknown;
  onChange: (value: unknown) => void;
  name: string;
  dataTypeId: string;
};

const EMPTY_DOCUMENT_STORE_WARNING =
  '[TimelineCurvePicker] no <TimelineProvider> above the graph — the picker ' +
  'is disabled. Wrap the graph (see the plugin README).';

function useDocumentFromStore(store: TimelineDocumentStore | null) {
  const emptySnapshot = useRef<TimelineDocument>({
    version: 1,
    durationSec: 1,
    loop: false,
    curves: [],
  });
  return useSyncExternalStore(
    store === null ? () => () => undefined : store.subscribe,
    store === null ? () => emptySnapshot.current : store.getDocument,
    store === null ? () => emptySnapshot.current : store.getDocument,
  );
}

/**
 * The curve picker rendered INSIDE a Timeline Curve node by the host (plan
 * §7): registered in the app's InputComponentRegistry under the curveRef
 * dataType. Built on the host's `Select` — the same widget as a node's enum
 * input — with `renderInline` so the dropdown inherits the ReactFlow canvas
 * transform instead of being portaled to the body.
 *
 * Requires a <TimelineProvider> above the graph — without one it degrades to a
 * disabled picker with a console error instead of unmounting the whole
 * application from inside the host's render tree (review UI-13). A reference to
 * a deleted curve keeps a red "missing" row (§8) — running stays safe (the impl
 * emits a constant-0 driver).
 */
export function TimelineCurvePicker({
  value,
  onChange,
}: TimelineCurvePickerProps) {
  const contextValue = useContext(TimelineContext);
  const warnedRef = useRef(false);
  const store = contextValue?.store ?? null;
  const document = useDocumentFromStore(store);
  if (store === null && !warnedRef.current) {
    warnedRef.current = true;
    console.error(EMPTY_DOCUMENT_STORE_WARNING);
  }

  const selectedCurveId = parseTimelineCurveRef(value);
  const isMissing =
    selectedCurveId !== null &&
    !document.curves.some((curve) => curve.id === selectedCurveId);

  return (
    <Select
      value={selectedCurveId ?? ''}
      disabled={store === null}
      allowDeselect
      renderInline
      onValueChange={(curveId) =>
        onChange(
          curveId === undefined || curveId === ''
            ? undefined
            : makeTimelineCurveRef(curveId),
        )
      }
    >
      <SelectTrigger
        className="rbnt:max-w-full rbnt:data-[missing=true]:border-tl-danger rbnt:data-[missing=true]:text-tl-danger"
        data-missing={isMissing ? 'true' : undefined}
        aria-label="Timeline curve"
      >
        <SelectValue placeholder="— pick curve —" />
      </SelectTrigger>
      <SelectContent>
        {isMissing && selectedCurveId !== null && (
          <SelectItem value={selectedCurveId}>
            ⚠ missing reference ({selectedCurveId})
          </SelectItem>
        )}
        {document.curves.map((curve) => (
          <SelectItem key={curve.id} value={curve.id}>
            {curve.name || '(unnamed)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
