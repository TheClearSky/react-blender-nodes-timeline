import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@theclearsky/react-blender-nodes';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { evaluateCurve } from '../../model/evaluate';
import type {
  TimelineCurve,
  TimelineDocument,
  TimelineTempo,
} from '../../model/types';
import {
  collectEventTimes,
  findTempoCandidates,
  findValueGridCandidates,
  hitTolerance,
  isOnValueGrid,
  mergeIntoOnsets,
  type TempoCandidate,
  type ValueGridCandidate,
  type ValueGridShape,
} from './gridFinder';
import { buildValueLines } from './gridLines';
import { NumberField } from './NumberField';
import { GRID_DIVISION_LABELS, type GridDivision } from './tempo';

/**
 * The Grid finder (plan `timeline-grid-finder.md`, Q-F3 A): suggestions on
 * the left, a preview of YOUR content on the right — green where it sits on
 * the grid, red where it does not — so the pick is made by eye. Nothing is
 * changed until "Use this grid".
 */

const BUTTON =
  'rbnt:rounded rbnt:border rbnt:border-secondary-dark-gray rbnt:bg-primary-dark-gray rbnt:px-3 rbnt:py-1.5 ' +
  'rbnt:text-[12px] rbnt:leading-4 rbnt:text-primary-white rbnt:enabled:hover:bg-tl-button-hover ' +
  'rbnt:disabled:cursor-default rbnt:disabled:opacity-40';
const PRIMARY =
  'rbnt:rounded rbnt:border rbnt:border-tl-accent rbnt:bg-tl-accent-bg rbnt:px-3 rbnt:py-1.5 rbnt:text-[12px] ' +
  'rbnt:leading-4 rbnt:text-tl-accent rbnt:enabled:hover:brightness-125 rbnt:disabled:opacity-40';

const PREVIEW_WIDTH = 560;
const ON = '#4ade80';
const OFF = '#f87171';

function strength(confidence: number): string {
  if (confidence >= 0.8) return 'strong';
  if (confidence >= 0.5) return 'good';
  return 'weak';
}

function formatBpm(bpm: number): string {
  return `${Number(bpm.toFixed(2))} BPM`;
}

/** One suggestion: name, a confidence bar, how many events it holds. */
function SuggestionRow({
  title,
  confidence,
  hits,
  total,
  selected,
  onSelect,
}: {
  title: string;
  confidence: number;
  hits: number;
  total: number;
  selected: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'rbnt:flex rbnt:w-full rbnt:cursor-pointer rbnt:flex-col rbnt:gap-1 rbnt:rounded rbnt:border rbnt:px-2.5 rbnt:py-2 rbnt:text-left',
        selected
          ? 'rbnt:border-tl-accent rbnt:bg-tl-accent-bg'
          : 'rbnt:border-secondary-dark-gray rbnt:bg-primary-dark-gray rbnt:hover:bg-tl-button-hover',
      )}
    >
      <span className="rbnt:flex rbnt:items-center rbnt:justify-between rbnt:gap-2 rbnt:text-[12px] rbnt:text-primary-white">
        <span>{title}</span>
        <span className="rbnt:text-tl-dim">{strength(confidence)}</span>
      </span>
      <span className="rbnt:h-1.5 rbnt:w-full rbnt:overflow-hidden rbnt:rounded-full rbnt:bg-secondary-dark-gray">
        <span
          className="rbnt:block rbnt:h-full rbnt:rounded-full rbnt:bg-tl-accent"
          style={{ width: `${Math.round(Math.max(0.04, confidence) * 100)}%` }}
        />
      </span>
      <span className="rbnt:text-[11px] rbnt:text-tl-dim">
        {hits} of {total} on the grid
      </span>
    </button>
  );
}

/** A canvas sized in CSS px with a crisp backing store; `draw` paints it. */
function PreviewCanvas({
  height,
  draw,
  label,
}: {
  height: number;
  draw(context: CanvasRenderingContext2D, width: number, height: number): void;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(PREVIEW_WIDTH * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, PREVIEW_WIDTH, height);
    draw(context, PREVIEW_WIDTH, height);
  });
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="rbnt:block rbnt:rounded rbnt:bg-tl-lane-bg"
      style={{ width: PREVIEW_WIDTH, height }}
    />
  );
}

// ── time ─────────────────────────────────────────────────────────────────

export type TempoGridChoice = {
  bpm: number;
  beatsPerBar: number;
  offsetSec: number;
  division: GridDivision;
};

const PER_BEAT: Record<GridDivision, number> = {
  bar: 0.25,
  '1/2': 0.5,
  '1/4': 1,
  '1/8': 2,
  '1/16': 4,
  '1/8T': 3,
  '1/16T': 6,
};

export function TempoFinderModal({
  open,
  onOpenChange,
  document,
  tempo,
  onApply,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  document: TimelineDocument;
  tempo: TimelineTempo;
  onApply(choice: TempoGridChoice): void;
}) {
  const [curveIds, setCurveIds] = useState<string[]>(() =>
    document.curves.map((curve) => curve.id),
  );
  const [candidates, setCandidates] = useState<TempoCandidate[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [beatsPerBar, setBeatsPerBar] = useState(tempo.beatsPerBar);
  const [offsetMs, setOffsetMs] = useState(0);
  const [page, setPage] = useState(0);

  const times = useMemo(
    () => collectEventTimes(document, curveIds),
    [document, curveIds],
  );

  // The search takes 0.1–0.6 s on a real score: let the modal paint first.
  useEffect(() => {
    if (!open) return;
    setCandidates(null);
    const handle = window.setTimeout(() => {
      const found = findTempoCandidates(times);
      setCandidates(found);
      setSelected(0);
      setOffsetMs(Math.round((found[0]?.offsetSec ?? 0) * 1000));
    }, 30);
    return () => window.clearTimeout(handle);
  }, [open, times]);

  const choice = candidates?.[selected] ?? null;
  const beat = choice === null ? 0.5 : 60 / choice.bpm;
  const bar = beat * beatsPerBar;
  // Two bars per page, at least 4 s, never past the end.
  const pageSec = Math.min(document.durationSec, Math.max(4, bar * 2));
  const pages = Math.max(1, Math.ceil(document.durationSec / pageSec));
  const from = Math.min(page, pages - 1) * pageSec;
  const offsetSec = offsetMs / 1000;

  const lanes = document.curves.filter((curve) => curveIds.includes(curve.id));
  const rowHeight = 16;
  const previewHeight = Math.max(
    60,
    Math.min(lanes.length, 12) * rowHeight + 20,
  );

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="lg" className="rbnt:max-w-[920px]">
        <ModalHeader>
          <ModalTitle>Grid finder — time</ModalTitle>
          <ModalDescription>
            Tempos that fit your events. Pick one by how its grid lines up —
            nothing changes until you use it.
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="rbnt:flex rbnt:flex-col rbnt:gap-3 rbnt:text-[12px] rbnt:text-primary-light-gray">
          <fieldset className="rbnt:flex rbnt:flex-wrap rbnt:items-center rbnt:gap-x-3 rbnt:gap-y-1">
            <legend className="rbnt:sr-only">Lanes to look at</legend>
            <span>Look at:</span>
            {document.curves.map((curve) => (
              <label
                key={curve.id}
                className="rbnt:inline-flex rbnt:cursor-pointer rbnt:items-center rbnt:gap-1.5"
              >
                <input
                  type="checkbox"
                  className="rbnt:accent-tl-accent"
                  checked={curveIds.includes(curve.id)}
                  onChange={(event) =>
                    setCurveIds((ids) =>
                      event.target.checked
                        ? [...ids, curve.id]
                        : ids.filter((id) => id !== curve.id),
                    )
                  }
                />
                <span
                  className="rbnt:inline-block rbnt:h-2 rbnt:w-2 rbnt:rounded-full"
                  style={{ background: curve.color }}
                />
                {curve.name || '(unnamed)'}
              </label>
            ))}
          </fieldset>
          <div className="rbnt:flex rbnt:gap-3">
            <div
              role="listbox"
              aria-label="Suggested tempos"
              className="rbnt:flex rbnt:max-h-[340px] rbnt:w-[240px] rbnt:shrink-0 rbnt:flex-col rbnt:gap-1.5 rbnt:overflow-y-auto"
            >
              {candidates === null && <p role="status">Finding…</p>}
              {candidates !== null && candidates.length === 0 && (
                <p role="status">
                  Not enough events to find a tempo — add points, or look at
                  more lanes.
                </p>
              )}
              {candidates?.map((candidate, index) => (
                <SuggestionRow
                  key={`${candidate.bpm}-${candidate.division}`}
                  title={`${formatBpm(candidate.bpm)} · ${GRID_DIVISION_LABELS[candidate.division]}`}
                  confidence={candidate.confidence}
                  hits={candidate.hits}
                  total={candidate.total}
                  selected={index === selected}
                  onSelect={() => {
                    setSelected(index);
                    setOffsetMs(Math.round(candidate.offsetSec * 1000));
                    setPage(0);
                  }}
                />
              ))}
            </div>
            <div className="rbnt:flex rbnt:flex-col rbnt:gap-1.5">
              <div className="rbnt:flex rbnt:items-center rbnt:justify-between">
                <span>
                  Preview · {from.toFixed(1)}–{(from + pageSec).toFixed(1)} s
                </span>
                <span className="rbnt:inline-flex rbnt:gap-1">
                  <Button
                    type="button"
                    size="small"
                    className={BUTTON}
                    aria-label="Earlier"
                    disabled={page <= 0}
                    onClick={() =>
                      setPage((current) => Math.max(0, current - 1))
                    }
                  >
                    <ChevronLeft className="rbnt:h-3.5 rbnt:w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    className={BUTTON}
                    aria-label="Later"
                    disabled={page >= pages - 1}
                    onClick={() =>
                      setPage((current) => Math.min(pages - 1, current + 1))
                    }
                  >
                    <ChevronRight className="rbnt:h-3.5 rbnt:w-3.5" />
                  </Button>
                </span>
              </div>
              <PreviewCanvas
                height={previewHeight}
                label={
                  choice === null
                    ? 'Preview'
                    : `Preview of ${formatBpm(choice.bpm)} over your events`
                }
                draw={(context, width, height) => {
                  if (choice === null) return;
                  const pxPerSec = width / pageSec;
                  const x = (t: number) => (t - from) * pxPerSec;
                  const cell = beat / PER_BEAT[choice.division];
                  // Grid: cells faint, beats brighter, bars brightest.
                  const firstCell = Math.ceil((from - offsetSec) / cell - 1e-9);
                  for (let index = firstCell; ; index += 1) {
                    const t = offsetSec + index * cell;
                    if (t > from + pageSec) break;
                    const onBar =
                      Math.abs(
                        (t - offsetSec) / bar -
                          Math.round((t - offsetSec) / bar),
                      ) < 1e-6;
                    const onBeat =
                      Math.abs(
                        (t - offsetSec) / beat -
                          Math.round((t - offsetSec) / beat),
                      ) < 1e-6;
                    context.strokeStyle = onBar
                      ? '#6b6b6b'
                      : onBeat
                        ? '#454545'
                        : '#2c2c2c';
                    context.beginPath();
                    context.moveTo(Math.round(x(t)) + 0.5, 0);
                    context.lineTo(Math.round(x(t)) + 0.5, height);
                    context.stroke();
                  }
                  // Each lane's events: green on the grid, red off it.
                  const tolerance = hitTolerance(cell);
                  lanes.slice(0, 12).forEach((curve, row) => {
                    const top = 10 + row * rowHeight;
                    context.fillStyle = curve.color;
                    context.globalAlpha = 0.35;
                    context.fillRect(0, top + rowHeight / 2, width, 1);
                    context.globalAlpha = 1;
                    // Note STARTS, as the finder counts them — not every
                    // point of every envelope.
                    const onsets = mergeIntoOnsets(
                      curve.points.map((point) => point.t),
                    );
                    for (const t of onsets) {
                      if (t < from || t > from + pageSec) continue;
                      const phase = t - offsetSec;
                      const on =
                        Math.abs(phase - Math.round(phase / cell) * cell) <=
                        tolerance + 1e-9;
                      context.fillStyle = on ? ON : OFF;
                      context.fillRect(
                        Math.round(x(t)) - 1,
                        top + 3,
                        3,
                        rowHeight - 6,
                      );
                    }
                  });
                }}
              />
              <span className="rbnt:text-tl-dim">
                <span style={{ color: ON }}>■</span> on the grid ·{' '}
                <span style={{ color: OFF }}>■</span> off it · bar lines
                brightest
              </span>
              <div className="rbnt:flex rbnt:flex-wrap rbnt:items-center rbnt:gap-2">
                <NumberField
                  value={offsetMs}
                  onCommit={(next) =>
                    setOffsetMs(Math.max(0, Math.round(next)))
                  }
                  decimals={0}
                  label="offset ms"
                  ariaLabel="Where the grid starts, in milliseconds"
                  widthPx={150}
                />
                <NumberField
                  value={beatsPerBar}
                  onCommit={(next) =>
                    setBeatsPerBar(Math.min(16, Math.max(1, Math.round(next))))
                  }
                  decimals={0}
                  label="beats/bar"
                  ariaLabel="Beats in one bar"
                  widthPx={124}
                />
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter align="right">
          <Button
            type="button"
            size="small"
            className={BUTTON}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="small"
            className={PRIMARY}
            disabled={choice === null}
            onClick={() => {
              if (choice === null) return;
              onApply({
                bpm: choice.bpm,
                beatsPerBar,
                offsetSec,
                division: choice.division,
              });
              onOpenChange(false);
            }}
          >
            Use this grid
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ── values ───────────────────────────────────────────────────────────────

function describeValueGrid(grid: ValueGridShape): string {
  return grid.kind === 'pitch'
    ? `Notes (A4 = ${grid.a4} Hz)`
    : `Step ${Number(grid.step.toPrecision(6))}${grid.origin !== 0 ? ` from ${Number(grid.origin.toPrecision(6))}` : ''}`;
}

export function ValueGridFinderModal({
  open,
  onOpenChange,
  curve,
  durationSec,
  valueRange,
  onApply,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  curve: TimelineCurve;
  durationSec: number;
  valueRange: { min: number; max: number };
  onApply(grid: ValueGridShape): void;
}) {
  // Distinct values, as the finder counts them — so every row's "N of M"
  // means the same thing.
  const values = useMemo(
    () => [
      ...new Set(curve.points.map((point) => Math.round(point.v * 1e6) / 1e6)),
    ],
    [curve],
  );
  const candidates = useMemo<ValueGridCandidate[]>(
    () => findValueGridCandidates(values),
    [values],
  );
  const [selected, setSelected] = useState<number | 'custom'>(0);
  const existing = curve.valueGrid;
  const firstLinear = candidates.find(
    (candidate) => candidate.grid.kind === 'linear',
  )?.grid;
  const [customStep, setCustomStep] = useState(
    existing?.kind === 'linear'
      ? existing.step
      : firstLinear?.kind === 'linear'
        ? firstLinear.step
        : 1,
  );
  const [customOrigin, setCustomOrigin] = useState(
    existing?.kind === 'linear' ? existing.origin : 0,
  );
  const [customA4, setCustomA4] = useState(
    existing?.kind === 'pitch' ? existing.a4 : 440,
  );
  const [customKind, setCustomKind] = useState<'linear' | 'pitch'>(
    existing?.kind ?? 'linear',
  );

  const custom: ValueGridShape =
    customKind === 'pitch'
      ? { kind: 'pitch', a4: customA4 }
      : { kind: 'linear', step: customStep, origin: customOrigin };
  const chosen: ValueGridShape | null =
    selected === 'custom' ? custom : (candidates[selected]?.grid ?? null);
  const customHits = values.filter((v) => isOnValueGrid(v, custom)).length;

  const height = 180;
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="lg" className="rbnt:max-w-[920px]">
        <ModalHeader>
          <ModalTitle>Grid finder — {curve.name || '(unnamed)'}</ModalTitle>
          <ModalDescription>
            Horizontal lines that fit this lane’s values. Snap pulls edited
            values onto them.
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="rbnt:flex rbnt:gap-3 rbnt:text-[12px] rbnt:text-primary-light-gray">
          <div
            role="listbox"
            aria-label="Suggested value grids"
            className="rbnt:flex rbnt:max-h-[360px] rbnt:w-[240px] rbnt:shrink-0 rbnt:flex-col rbnt:gap-1.5 rbnt:overflow-y-auto"
          >
            {candidates.length === 0 && (
              <p role="status">Not enough distinct values to find a grid.</p>
            )}
            {candidates.map((candidate, index) => (
              <SuggestionRow
                key={describeValueGrid(candidate.grid)}
                title={describeValueGrid(candidate.grid)}
                confidence={candidate.confidence}
                hits={candidate.hits}
                total={candidate.total}
                selected={selected === index}
                onSelect={() => setSelected(index)}
              />
            ))}
            <SuggestionRow
              title={`Custom · ${describeValueGrid(custom)}`}
              confidence={values.length === 0 ? 0 : customHits / values.length}
              hits={customHits}
              total={values.length}
              selected={selected === 'custom'}
              onSelect={() => setSelected('custom')}
            />
          </div>
          <div className="rbnt:flex rbnt:flex-col rbnt:gap-1.5">
            <span>Preview · the whole lane</span>
            <PreviewCanvas
              height={height}
              label={
                chosen === null
                  ? 'Preview'
                  : `Preview of ${describeValueGrid(chosen)}`
              }
              draw={(context, width, canvasHeight) => {
                const span = valueRange.max - valueRange.min || 1;
                const y = (v: number) =>
                  canvasHeight - ((v - valueRange.min) / span) * canvasHeight;
                if (chosen !== null) {
                  const lines = buildValueLines(
                    { ...chosen, show: true, snap: false },
                    valueRange.min,
                    valueRange.max,
                    canvasHeight,
                  );
                  context.font = '10px system-ui, sans-serif';
                  let lastLabel = Infinity;
                  for (const line of lines) {
                    const lineY = Math.round(y(line.v)) + 0.5;
                    context.strokeStyle =
                      line.strength === 1 ? '#4a4466' : '#2e2c38';
                    context.beginPath();
                    context.moveTo(0, lineY);
                    context.lineTo(width, lineY);
                    context.stroke();
                    if (line.label !== undefined && lastLabel - lineY >= 12) {
                      context.fillStyle = '#8a82b8';
                      context.fillText(line.label, 4, lineY - 2);
                      lastLabel = lineY;
                    }
                  }
                }
                // The lane's own shape, then its points: green on a line.
                context.strokeStyle = curve.color;
                context.lineWidth = 1.5;
                context.beginPath();
                for (let px = 0; px <= width; px += 2) {
                  const value = evaluateCurve(
                    curve,
                    (px / width) * durationSec,
                  );
                  if (px === 0) context.moveTo(px, y(value));
                  else context.lineTo(px, y(value));
                }
                context.stroke();
                for (const point of curve.points) {
                  const on = chosen !== null && isOnValueGrid(point.v, chosen);
                  context.fillStyle = on ? ON : OFF;
                  context.fillRect(
                    Math.round((point.t / durationSec) * width) - 2,
                    Math.round(y(point.v)) - 2,
                    5,
                    5,
                  );
                }
              }}
            />
            <span className="rbnt:text-tl-dim">
              <span style={{ color: ON }}>■</span> on a line ·{' '}
              <span style={{ color: OFF }}>■</span> off
            </span>
            <div className="rbnt:flex rbnt:flex-wrap rbnt:items-center rbnt:gap-2">
              <span>Custom:</span>
              <span
                role="group"
                aria-label="Custom grid kind"
                className="rbnt:inline-flex"
              >
                {(['linear', 'pitch'] as const).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    size="small"
                    className={cn(
                      BUTTON,
                      kind === 'linear'
                        ? 'rbnt:rounded-r-none'
                        : 'rbnt:-ml-px rbnt:rounded-l-none',
                      customKind === kind &&
                        'rbnt:border-tl-accent rbnt:text-tl-accent',
                    )}
                    aria-pressed={customKind === kind}
                    onClick={() => {
                      setCustomKind(kind);
                      setSelected('custom');
                    }}
                  >
                    {kind === 'linear' ? 'Step' : 'Notes'}
                  </Button>
                ))}
              </span>
              {customKind === 'linear' ? (
                <>
                  <NumberField
                    value={customStep}
                    onCommit={(next) => {
                      if (next > 0) setCustomStep(next);
                      setSelected('custom');
                    }}
                    decimals={4}
                    label="step"
                    ariaLabel="Custom step between lines"
                    widthPx={130}
                  />
                  <NumberField
                    value={customOrigin}
                    onCommit={(next) => {
                      setCustomOrigin(next);
                      setSelected('custom');
                    }}
                    decimals={4}
                    label="from"
                    ariaLabel="A value the lines pass through"
                    widthPx={130}
                  />
                </>
              ) : (
                <NumberField
                  value={customA4}
                  onCommit={(next) => {
                    setCustomA4(Math.min(900, Math.max(200, next)));
                    setSelected('custom');
                  }}
                  decimals={1}
                  label="A4 Hz"
                  ariaLabel="Tuning: the frequency of A4"
                  widthPx={130}
                />
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter align="right">
          <Button
            type="button"
            size="small"
            className={BUTTON}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="small"
            className={PRIMARY}
            disabled={chosen === null}
            onClick={() => {
              if (chosen === null) return;
              onApply(chosen);
              onOpenChange(false);
            }}
          >
            Use this grid
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
