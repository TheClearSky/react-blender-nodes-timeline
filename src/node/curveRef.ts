/**
 * The curve-reference VALUE stored by the picker input (plan §7): a branded
 * object rather than a bare string so it can never be confused with a text
 * value, validated by zod like every complex dataType in the host pattern.
 * Nodes bind curves by id — renames are safe.
 */
import { z } from 'zod';

export const timelineCurveRefSchema = z.object({
  kind: z.literal('timelineCurveRef'),
  curveId: z.string().min(1),
});

export type TimelineCurveRef = z.infer<typeof timelineCurveRefSchema>;

export function makeTimelineCurveRef(curveId: string): TimelineCurveRef {
  return { kind: 'timelineCurveRef', curveId };
}

/** The curveId when the value is a valid reference, else null. */
export function parseTimelineCurveRef(value: unknown): string | null {
  const result = timelineCurveRefSchema.safeParse(value);
  return result.success ? result.data.curveId : null;
}
