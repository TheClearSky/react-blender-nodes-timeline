import { useId, useLayoutEffect, useRef, useState } from 'react';
import { SliderNumberInput } from '@theclearsky/react-blender-nodes';

export type NumberFieldProps = {
  value: number;
  onCommit(nextValue: number): void;
  /** Full name, announced but not shown. */
  ariaLabel: string;
  /** Short name shown inside the control (`t`, `v`, `min`, `dur`, …). */
  label: string;
  /** A fixed width, or `'full'` to fill the parent. */
  widthPx?: number | 'full';
  decimals?: number;
};

/**
 * The timeline's number field — the HOST's `SliderNumberInput`, the same
 * control a node's number input uses: drag the middle to scrub the value,
 * click it to type one, or step with the chevrons. (It replaced a plain text
 * box, which could only be typed into.)
 *
 * Two things stay this component's job:
 *
 * - **Key isolation.** Delete/Backspace/Escape must not reach the timeline's
 *   root key handler while a number is being typed, or editing "0.5" would
 *   delete the selected point (reviews UI-1/UI-2). Escape additionally
 *   discards the edit by REMOUNTING the control — that drops its draft without
 *   the blur-commit — and returns focus to the timeline root so its shortcuts
 *   keep working (review UI-17).
 * - **The accessible name.** The control shows a SHORT label to stay narrow, so
 *   the full name lives in a visually-hidden span, which names the surrounding
 *   `role='group'` through `aria-labelledby`.
 *
 *   The wrapper is deliberately NOT a `<label>`. A `<label>` binds to its first
 *   labelable descendant — here the host slider's DECREMENT CHEVRON — and
 *   Chromium then propagates `:hover` to that chevron whenever the pointer is
 *   anywhere inside the label, so the left chevron lit up while the user
 *   hovered the middle. Measured and proved by reparenting: identical markup
 *   outside a `<label>` behaves correctly.
 *
 *   The span is KEPT rather than replaced by an `aria-label`: `sr-only` leaves
 *   the text in the accessibility tree as static text, so readers that walk the
 *   document still reach it even where a `role='group'` name is not announced.
 */
export function NumberField({
  value,
  onCommit,
  ariaLabel,
  label,
  widthPx = 104,
  decimals = 3,
}: NumberFieldProps) {
  const [resetToken, setResetToken] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const nameId = useId();

  // The host widget swaps the slider for a bare <input> when clicked, and the
  // PINNED host (`^0.0.14`) accepts no name for that branch — the field would
  // announce itself by its 3-character placeholder ("dur s") exactly when the
  // user is committing a value.
  //
  // It has to OBSERVE THE DOM rather than react to a render. The swap happens in
  // `SliderNumberInput`'s own state, so this component never re-renders when it
  // occurs — a dep-less effect would not re-run, and a focus-keyed handler would
  // depend on the host choosing to focus the field. Both were tried and both
  // measured as leaving the field named "dur s".
  //
  // Re-runs on `ariaLabel` so a curve renamed while the field is open does not
  // leave a stale name behind.
  //
  // Delete this whole effect once the plugin can depend on the host's
  // `ariaLabel` prop (host >= 0.0.15), which names BOTH branches directly.
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const apply = () => {
      const input = wrapper.querySelector('input');
      if (input && input.getAttribute('aria-label') !== ariaLabel) {
        input.setAttribute('aria-label', ariaLabel);
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(wrapper, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ariaLabel]);

  return (
    <div
      ref={wrapperRef}
      role="group"
      aria-labelledby={nameId}
      className="rbnt:inline-flex rbnt:min-w-0 rbnt:items-center"
      style={{ width: widthPx === 'full' ? '100%' : widthPx }}
      onKeyDown={(event) => {
        // Never let the timeline's Delete/Backspace/x handler see typing.
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        setResetToken((token) => token + 1);
        const timelineRoot = wrapperRef.current?.closest('.rbnt-timeline');
        if (timelineRoot instanceof HTMLElement) timelineRoot.focus();
      }}
    >
      <span id={nameId} className="rbnt:sr-only">
        {ariaLabel}
      </span>
      <SliderNumberInput
        key={resetToken}
        name={label}
        size="small"
        value={value}
        decimals={decimals}
        onChange={onCommit}
        className="rbnt:w-full"
      />
    </div>
  );
}
