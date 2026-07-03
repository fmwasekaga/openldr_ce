import { z } from 'zod';
import { WidgetQuerySchema } from '@openldr/dashboards';

export const REPORT_CATEGORIES = ['amr', 'operational', 'quality', 'regulatory'] as const;

export const PageSchema = z.object({
  size: z.enum(['A4', 'Letter']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margins: z.object({
    top: z.number(), right: z.number(), bottom: z.number(), left: z.number(),
  }).default({ top: 40, right: 40, bottom: 40, left: 40 }),
});

// Mirrors @openldr/reporting ReportParamMeta so built reports plug into the existing
// ReportParametersBar in a later phase.
export const ReportParamSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['daterange', 'select', 'text']),
  required: z.boolean().default(false),
  optionsKey: z.string().optional(),
});

const BlockStyleSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  fontSize: z.number().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
}).default({});

export const BlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('title'), text: z.string().default(''), style: BlockStyleSchema }),
  z.object({ kind: z.literal('text'), content: z.string().default(''), style: BlockStyleSchema }),
  z.object({ kind: z.literal('kpi'), query: WidgetQuerySchema, label: z.string().default(''), format: z.string().optional() }),
  z.object({ kind: z.literal('chart'), query: WidgetQuerySchema, chartType: z.enum(['bar', 'line', 'pie']), visual: z.record(z.unknown()).default({}) }),
  z.object({
    kind: z.literal('table'),
    source: z.union([z.literal('primary'), WidgetQuerySchema]),
    columns: z.array(z.object({ key: z.string(), label: z.string() })).default([]),
  }),
  z.object({ kind: z.literal('image'), src: z.string() }),
  z.object({ kind: z.literal('divider') }),
  z.object({ kind: z.literal('spacer'), height: z.number().default(12) }),
  z.object({ kind: z.literal('pageBreak') }),
]);
export type Block = z.infer<typeof BlockSchema>;

export const ReportCellSchema = z.object({
  colSpan: z.number().int().min(1).max(12),
  block: BlockSchema,
});

export const ReportRowSchema = z.object({
  id: z.string(),
  repeat: z.enum(['header', 'footer']).optional(),
  cells: z.array(ReportCellSchema).default([]),
});

export const ReportTemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  category: z.enum(REPORT_CATEGORIES).default('operational'),
  status: z.enum(['draft', 'published']).default('draft'),
  page: PageSchema.default({}),
  parameters: z.array(ReportParamSchema).default([]),
  dataset: WidgetQuerySchema.optional(),
  rows: z.array(ReportRowSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;
export type ReportParam = z.infer<typeof ReportParamSchema>;
