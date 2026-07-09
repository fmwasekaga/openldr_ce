import type { ReportDesign } from '@openldr/report-designer/pure';

/** Spec for a one-page report design bound to a single custom query: a title, a "Generated
 *  {{date}}" stamp, and one table projecting the query's result columns. Used by S4 to turn each
 *  migrated hardcoded report into a design a `reports` record can point at. */
export interface SimpleDesignSpec {
  id: string;
  name: string;
  queryId: string;
  columns: { key: string; label: string }[];
  parameters: ReportDesign['parameters'];
  paper?: 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape';
}

/** Builds a one-page A4/Letter `ReportDesign` bound to `spec.queryId`, with the query's result
 *  columns projected onto the table via `boundColumns`. Deterministic element ids (derived from
 *  `spec.id`) so re-seeding never produces drift. */
export function simpleTableDesign(spec: SimpleDesignSpec): ReportDesign {
  return {
    id: spec.id,
    name: spec.name,
    paper: spec.paper ?? 'A4',
    orientation: spec.orientation ?? 'portrait',
    parameters: spec.parameters,
    pages: [
      {
        id: `${spec.id}-p1`,
        elements: [
          { id: `${spec.id}-title`, kind: 'text', name: 'Title', rect: { x: 48, y: 40, w: 600, h: 28 }, text: spec.name, style: { fontSize: 18, bold: true } },
          { id: `${spec.id}-date`, kind: 'datetime', name: 'Generated', rect: { x: 48, y: 74, w: 400, h: 18 }, text: 'Generated {{date}}' },
          {
            id: `${spec.id}-table`, kind: 'table', name: 'Data', rect: { x: 48, y: 120, w: 700, h: 560 },
            dataSource: { kind: 'custom-query', queryId: spec.queryId },
            boundColumns: spec.columns,
          },
        ],
      },
    ],
    pageNumbers: true,
  };
}
