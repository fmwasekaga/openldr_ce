import { z } from 'zod';

/** Parameter declaration for a Custom Query. Mirrors report-builder's ReportParam so a query
 *  authored on the Query page is described identically to report/dashboard params. */
export const CustomQueryParamSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  type: z.enum(['text', 'select', 'daterange']),
  required: z.boolean().default(false),
  optionsSql: z.string().optional(),
});
export type CustomQueryParam = z.infer<typeof CustomQueryParamSchema>;

/** Persisted, reusable live SQL query bound to a connector. */
export const CustomQuerySchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  connectorId: z.string().min(1),
  sql: z.string(),
  params: z.array(CustomQueryParamSchema).default([]),
});
export type CustomQuery = z.infer<typeof CustomQuerySchema>;

/** Body accepted on create/update (id/timestamps assigned server-side). */
export const CustomQueryInputSchema = CustomQuerySchema.omit({ id: true });
export type CustomQueryInput = z.infer<typeof CustomQueryInputSchema>;
