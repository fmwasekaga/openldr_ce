import { z } from 'zod';

// A single entry in the global, editable report-category list. `id` is the value stored in
// ReportDef.category (a free string, see report-def.ts); `label` is the display name; `order`
// controls presentation order in the Reports page category groupings / editor.
export const ReportCategoryEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  order: z.number(),
});
export type ReportCategoryEntry = z.infer<typeof ReportCategoryEntrySchema>;

export const ReportCategoryListSchema = z.array(ReportCategoryEntrySchema);
export type ReportCategoryList = z.infer<typeof ReportCategoryListSchema>;

// Seeded once on first boot (see @openldr/bootstrap seed.ts) — matches the category ids the 8
// built-in seeded reports already use (see seed/report-seeds.ts), so existing reports keep their
// grouping when the operator hasn't customized the category list yet.
export const DEFAULT_REPORT_CATEGORIES: ReportCategoryList = [
  { id: 'amr', label: 'AMR / Surveillance', order: 0 },
  { id: 'operational', label: 'Operational', order: 1 },
  { id: 'quality', label: 'Quality', order: 2 },
  { id: 'regulatory', label: 'Regulatory', order: 3 },
];
