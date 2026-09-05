import { useRef, useState } from 'react';

export type NumberFieldProps = {
  value: number;
  onCommit(nextValue: number): void;
  step?: number;
  ariaLabel: string;
  widthPx?: number;
  decimals?: number;
};

function formatNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

/**
 * Draft-while-editing number input: commits on blur/Enter, Escape cancels.
 * The cancelingRef guards the synchronous blur that follows Escape from
 * committing the aborted draft (the sound repo's SU-01 lesson).
 */
export function NumberField({
  value,
  onCommit,
  step = 0.001,
  ariaLabel,
  widthPx = 76,
  decimals = 3,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelingRef = useRef(false);

  function commitDraft() {
    if (cancelingRef.current) {
      cancelingRef.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) {
      return;
    }
    setDraft(null);
    const parsed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(parsed)) {
      onCommit(parsed);
    }
  }

  return (
    <input
      className="rbnt-tl-number"
      type="number"
      step={step}
      aria-label={ariaLabel}
      style={{ width: widthPx }}
      value={draft ?? formatNumber(value, decimals)}
      onFocus={() => setDraft(formatNumber(value, decimals))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        // Keep Delete/Backspace/etc. away from the timeline's key handler
        // while typing.
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          cancelingRef.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}
