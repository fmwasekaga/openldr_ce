import { z } from 'zod';

export type ElementKind = 'text' | 'table' | 'image' | 'line' | 'rect' | 'datetime';
export type Paper = 'A4' | 'Letter';
export type Orientation = 'portrait' | 'landscape';
export type TextAlign = 'left' | 'center' | 'right';

export const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Rect = z.infer<typeof RectSchema>;

export const ElementStyleSchema = z.object({
  fontSize: z.number().optional(),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  color: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  fill: z.string().optional(),
});
export type ElementStyle = z.infer<typeof ElementStyleSchema>;

export const MarginsSchema = z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() });
export type Margins = z.infer<typeof MarginsSchema>;

export const DataSourceSchema = z.object({ kind: z.literal('custom-query'), queryId: z.string() });
export type DataSource = z.infer<typeof DataSourceSchema>;

export const BoundColumnSchema = z.object({ key: z.string(), label: z.string() });
export type BoundColumn = z.infer<typeof BoundColumnSchema>;

export const DesignElementSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'table', 'image', 'line', 'rect', 'datetime']),
  name: z.string(),
  rect: RectSchema,
  /** text/datetime content */
  text: z.string().optional(),
  /** table column headers */
  columns: z.array(z.string()).optional(),
  /** table sample rows (looks-only) */
  rows: z.array(z.array(z.string())).optional(),
  /** table binding label, e.g. "AMR resistance" */
  boundReport: z.string().optional(),
  /** real table binding (supersedes boundReport) */
  dataSource: DataSourceSchema.optional(),
  /** picked/reordered/relabeled projection of the query's result columns */
  boundColumns: z.array(BoundColumnSchema).optional(),
  /** presentational style (text/line/rect) */
  style: ElementStyleSchema.optional(),
  /** image source (URL or data: URI) */
  src: z.string().optional(),
});
export type DesignElement = z.infer<typeof DesignElementSchema>;

export const DesignPageSchema = z.object({ id: z.string(), elements: z.array(DesignElementSchema).default([]) });
export type DesignPage = z.infer<typeof DesignPageSchema>;

export const DateRangeValueSchema = z.object({ from: z.string(), to: z.string() });
export type DateRangeValue = z.infer<typeof DateRangeValueSchema>;

export const TemplateParamSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'select', 'daterange']).optional(),
  value: z.union([z.string(), DateRangeValueSchema]).optional(),
});
export type TemplateParam = z.infer<typeof TemplateParamSchema>;

export const ReportDesignSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  paper: z.enum(['A4', 'Letter']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  pages: z.array(DesignPageSchema).default([]),
  parameters: z.array(TemplateParamSchema).default([]),
  margins: MarginsSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ReportDesign = z.infer<typeof ReportDesignSchema>;
