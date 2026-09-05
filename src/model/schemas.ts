/**
 * Zod schemas for the timeline document (plan §3). Imported JSON is
 * validated with path-level errors — including the refines for
 * strictly-increasing point times (min Δ 1 ms), all-finite values,
 * durationSec covering every curve, and unique curve ids (nodes and
 * drivers bind curves by id) — so hand-edited files cannot break the
 * segment lookup or the driver registry (review EM-22.6). `version` gates
 * future migrations.
 */
import { z } from 'zod';
import {
  MIN_POINT_DELTA_SECONDS,
  sideInterps,
  type TimelineDocument,
} from './types';

export const sideInterpSchema = z.enum(sideInterps);

export const curvePointSchema = z.object({
  t: z.number().finite().nonnegative(),
  v: z.number().finite(),
  leftInterp: sideInterpSchema,
  rightInterp: sideInterpSchema,
});

export const timelineCurveSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    // Hex only (3 or 6 digits): every UI writer produces #rrggbb, and a
    // free-form string breaks the color input + canvas stroke silently
    // (review UI-16).
    color: z
      .string()
      .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex color'),
    defaultValue: z.number().finite(),
    points: z.array(curvePointSchema),
  })
  .superRefine((curve, ctx) => {
    for (let index = 1; index < curve.points.length; index += 1) {
      const previousPoint = curve.points[index - 1];
      const currentPoint = curve.points[index];
      if (currentPoint.t - previousPoint.t < MIN_POINT_DELTA_SECONDS) {
        ctx.addIssue({
          code: 'custom',
          message: `points must be strictly increasing in t by at least ${MIN_POINT_DELTA_SECONDS}s (point ${index} at t=${currentPoint.t} follows t=${previousPoint.t})`,
          path: ['points', index, 't'],
        });
      }
    }
  });

export const timelineDocumentSchema = z
  .object({
    version: z.literal(1),
    // Floor: a schema-legal microscopic duration would freeze the
    // transport's cycle top-up (review EN-6). Ceiling: unbounded durations
    // hang the ruler/canvas paths (review UI-3). The editor's own limits
    // (0.1 s / 3600 s) sit inside this envelope.
    durationSec: z.number().finite().min(0.01).max(3600),
    loop: z.boolean(),
    curves: z.array(timelineCurveSchema),
  })
  .superRefine((document, ctx) => {
    const seenCurveIds = new Set<string>();
    for (const [index, curve] of document.curves.entries()) {
      if (seenCurveIds.has(curve.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate curve id "${curve.id}" — nodes and drivers bind curves by id, so ids must be unique`,
          path: ['curves', index, 'id'],
        });
      }
      seenCurveIds.add(curve.id);
      const lastPoint = curve.points[curve.points.length - 1];
      if (lastPoint !== undefined && lastPoint.t > document.durationSec) {
        ctx.addIssue({
          code: 'custom',
          message: `durationSec (${document.durationSec}) is shorter than the last point of curve "${curve.name}" (t=${lastPoint.t})`,
          path: ['durationSec'],
        });
      }
    }
  });

/**
 * Parse an unknown value into a TimelineDocument or throw a ZodError. The
 * TimelineDocument return annotation doubles as a compile-time check that
 * the schema output stays assignable to the public §3 types.
 */
export function parseTimelineDocument(input: unknown): TimelineDocument {
  return timelineDocumentSchema.parse(input);
}
