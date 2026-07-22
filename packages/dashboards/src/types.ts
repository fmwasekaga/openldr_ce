import { z } from 'zod';

export const WIDGET_TYPES = [
  'kpi', 'line-chart', 'bar-chart', 'area-chart', 'row-chart', 'pie-chart',
  'scatter-plot', 'funnel', 'progress-bar', 'gauge', 'table', 'traffic-light',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;
export type Agg = (typeof AGGS)[number];

export const FILTER_OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export type DimensionKind = 'string' | 'date' | 'number';
export type DateGrain = 'day' | 'week' | 'month' | 'year';

export const QueryFilterSchema = z.object({
  dimension: z.string(), op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).nullable(),
});
export type QueryFilter = z.infer<typeof QueryFilterSchema>;

// A single condition — reuses the flat filter shape (dimension/op/value) plus a discriminant.
export const ConditionRuleSchema = QueryFilterSchema.extend({ kind: z.literal('rule') });
export type ConditionRule = z.infer<typeof ConditionRuleSchema>;

// A recursive AND/OR group of rules and nested groups. Zod needs z.lazy + an explicit type.
export type ConditionNode = ConditionRule | ConditionGroup;
export interface ConditionGroup { kind: 'group'; combinator: 'and' | 'or'; children: ConditionNode[] }
export const ConditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.object({
    kind: z.literal('group'),
    combinator: z.enum(['and', 'or']),
    children: z.array(z.union([ConditionRuleSchema, ConditionGroupSchema])),
  }),
);

export const DerivedRatioSchema = z.object({
  numerator: z.string(),            // key of another (aggregate) metric in the same query
  denominator: z.string(),          // key of another (aggregate) metric
  scale: z.number().default(100),   // ×100 → percent
  decimals: z.number().default(1),  // round to N decimals
});
export type DerivedRatio = z.infer<typeof DerivedRatioSchema>;

export const MetricSchema = z.object({
  key: z.string(), label: z.string().optional(),
  agg: z.enum(AGGS), column: z.string().optional(),
  where: z.array(QueryFilterSchema).optional(), // Slice A: conditional predicate (ANDed)
  derived: DerivedRatioSchema.optional(),       // Slice B: computed post-aggregation, not selected in SQL
});
export type Metric = z.infer<typeof MetricSchema>;

export const DimensionRefSchema = z.object({ key: z.string(), grain: z.enum(['day', 'week', 'month', 'year']).optional(), reference: z.string().optional() });
export type DimensionRef = z.infer<typeof DimensionRefSchema>;

export const WidgetVariableDefSchema = z.object({
  type: z.enum(['text', 'number', 'date', 'date-range']),
  label: z.string(),
  options: z.array(z.string()).optional(),
  optionsSql: z.string().optional(),
  defaultValue: z.union([z.string(), z.number()]).nullable().optional(),
  defaultRange: z.object({ from: z.string(), to: z.string() }).nullable().optional(),
});
export type WidgetVariableDef = z.infer<typeof WidgetVariableDefSchema>;

export const WidgetQuerySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('builder'),
    model: z.string(),
    metric: MetricSchema,
    metrics: z.array(MetricSchema).optional(), // Slice A: multi-column table mode
    dimension: DimensionRefSchema.optional(),
    breakdown: z.object({ key: z.string() }).optional(),
    filters: z.array(QueryFilterSchema).default([]),
    filterTree: ConditionGroupSchema.optional(), // recursive AND/OR tree; supersedes `filters` when present
    limit: z.number().int().positive().optional(), // top-N of the shaped result, by primary measure desc
    variableBindings: z.record(z.string()).optional(),
  }),
  z.object({
    mode: z.literal('sql'),
    sql: z.string(),
    variableBindings: z.record(z.string()).optional(),
    variables: z.record(WidgetVariableDefSchema).optional(),
    // Resolved dashboard-filter values (name → value / {from,to}). When present, `sql` is the
    // STORED template (verbatim) and the server applies the `{{var}}`/`[[ ]]` substitution
    // itself — so the submitted `sql` stays byte-identical to the persisted widget and can be
    // vetted against stored dashboards even when filters are set.
    values: z.record(z.union([
      z.string(), z.number(), z.null(),
      z.object({ from: z.string(), to: z.string() }),
    ])).optional(),
  }),
]);
export type WidgetQuery = z.infer<typeof WidgetQuerySchema>;

export const WidgetVisualSchema = z.object({
  color: z.string().optional(), secondaryColor: z.string().optional(),
  xAxisKey: z.string().optional(), yAxisKey: z.string().optional(), sizeKey: z.string().optional(),
  suffix: z.string().optional(), trendEnabled: z.boolean().optional(),
  greenThreshold: z.number().optional(), amberThreshold: z.number().optional(),
  goalValue: z.number().optional(), minValue: z.number().optional(), maxValue: z.number().optional(),
  innerRadius: z.number().optional(), showLegend: z.boolean().optional(),
  columns: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
  pageSize: z.number().optional(),
}).passthrough();
export type WidgetVisual = z.infer<typeof WidgetVisualSchema>;

export const WidgetConfigSchema = z.object({
  id: z.string(), type: z.enum(WIDGET_TYPES), title: z.string(),
  query: WidgetQuerySchema, refreshIntervalSec: z.number().default(0),
  visual: WidgetVisualSchema.default({}),
});
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

export const LayoutItemSchema = z.object({
  i: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  minW: z.number().optional(), minH: z.number().optional(),
});
export type LayoutItem = z.infer<typeof LayoutItemSchema>;

export const DashboardFilterDefSchema = z.object({
  id: z.string(), label: z.string(),
  type: z.enum(['text', 'number', 'date', 'date-range']),
  defaultValue: z.union([z.string(), z.number()]).nullable().optional(),
  defaultRange: z.object({ from: z.string(), to: z.string() }).nullable().optional(),
  options: z.array(z.string()).optional(),
  optionsSql: z.string().optional(),
});
export type DashboardFilterDef = z.infer<typeof DashboardFilterDefSchema>;

export const DashboardSchema = z.object({
  id: z.string(), ownerId: z.string().nullable().default(null), name: z.string(),
  layout: z.array(LayoutItemSchema).default([]),
  widgets: z.array(WidgetConfigSchema).default([]),
  filters: z.array(DashboardFilterDefSchema).default([]),
  refreshIntervalSec: z.number().default(0), isDefault: z.boolean().default(false),
  createdAt: z.string().optional(), updatedAt: z.string().optional(),
});
export type Dashboard = z.infer<typeof DashboardSchema>;
