// Browser-safe mirror of the Custom Query types.
//
// NOTE: the source of truth is the Zod schema in @openldr/dashboards/custom-query
// (CustomQueryParamSchema / CustomQuerySchema / CustomQueryInputSchema). The studio app
// deliberately does NOT depend on @openldr/dashboards (that would pull server-only DB deps —
// kysely / pg-mem — into the browser bundle; see apps/studio/src/dashboard/template.ts and the
// hand-maintained WidgetQuery in apps/studio/src/api.ts). These small, pure types are kept in
// sync by hand. If the shared schema changes, update this file too.

/** Parameter declaration for a Custom Query. Mirrors the report-builder ReportParam shape. */
export interface CustomQueryParam {
  id: string;
  label: string;
  type: 'text' | 'select' | 'daterange';
  required: boolean;
  optionsSql?: string;
}

/** Persisted, reusable live SQL query bound to a connector. */
export interface CustomQuery {
  id: string;
  name: string;
  connectorId: string;
  sql: string;
  params: CustomQueryParam[];
}

/** Body accepted on create/update (id assigned server-side). */
export type CustomQueryInput = Omit<CustomQuery, 'id'>;
