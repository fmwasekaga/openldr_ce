import { z } from 'zod';

// Mirror of ChartHint / ReportMetricMeta from ./types, expressed as Zod so the API + CLI validate input.
const ChartHintSchema = z.union([
  z.object({ type: z.literal('bar'), x: z.string(), y: z.string(), series: z.string().optional() }),
  z.object({ type: z.literal('line'), x: z.string(), y: z.string(), series: z.string().optional() }),
  z.object({ type: z.literal('pie'), label: z.string(), value: z.string() }),
  z.object({ type: z.literal('stat'), value: z.string(), label: z.string() }),
]);

const MetricSchema = z.object({
  id: z.string(), label: z.string(),
  type: z.enum(['count', 'sum', 'avg', 'pct']),
  column: z.string().optional(), match: z.string().optional(),
});

export const ReportDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: z.enum(['amr', 'operational', 'quality', 'regulatory']),
  designId: z.string().min(1),
  primaryQueryId: z.string().min(1),
  summaryMetrics: z.array(MetricSchema).optional(),
  chart: ChartHintSchema.optional(),
  paramOptions: z.record(z.string()).optional(),
  status: z.enum(['draft', 'published']).default('draft'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ReportDef = z.infer<typeof ReportDefSchema>;
