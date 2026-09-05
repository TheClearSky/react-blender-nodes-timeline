import { useContext, useRef, useSyncExternalStore } from 'react';
import type { TimelineDocument } from '../model/types';
import { TimelineContext } from '../store/TimelineContext';
import type { TimelineDocumentStore } from '../store/documentStore';
import { makeTimelineCurveRef, parseTimelineCurveRef } from './curveRef';

/**
 * The host's InputComponentProps contract, declared STRUCTURALLY so the
 * rolled d.ts never imports the host package — the host peer is optional
 * and a hard d.ts import would break host-less consumers' type-checking
 * (review UI-8). A compile-time assignability check against the real host
 * type lives in src/__tests__/node/curveNode.test.ts.
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
 * dataType. Requires a <TimelineProvider> above the graph — without one it
 * degrades to a disabled select with a console error instead of unmounting
 * the whole application from inside the host's render tree (review UI-13).
 * A reference to a deleted curve shows a red "missing" state (§8) — running
 * stays safe (the impl emits a constant-0 driver).
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
    <select
      className="rbnt-tl-curve-picker"
      data-missing={isMissing ? 'true' : undefined}
      disabled={store === null}
      value={selectedCurveId ?? ''}
      aria-label="Timeline curve"
      onChange={(event) => {
        const curveId = event.target.value;
        onChange(curveId === '' ? undefined : makeTimelineCurveRef(curveId));
        // Give focus back immediately — in the sound app a focused select
        // swallows the note keys (the demo-picker incident).
        event.currentTarget.blur();
      }}
    >
      <option value="">— pick curve —</option>
      {isMissing && selectedCurveId !== null && (
        <option value={selectedCurveId}>
          ⚠ missing reference ({selectedCurveId})
        </option>
      )}
      {document.curves.map((curve) => (
        <option key={curve.id} value={curve.id}>
          {curve.name || '(unnamed)'}
        </option>
      ))}
    </select>
  );
}
