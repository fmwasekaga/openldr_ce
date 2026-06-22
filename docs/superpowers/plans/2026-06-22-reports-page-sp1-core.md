# Reports Page — Corlix Parity SP-1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenLDR's minimal reports page with the full corlix reports experience — a collapsible report library, parameters bar, KPI summary strip, and a tabbed Document (PDF viewer) / Spreadsheet area — wired to the existing 7-report backend.

**Architecture:** Backend gains UI metadata on each report (category, parameter descriptors, summary metrics, dynamic option resolver) exposed through `ctx.reporting.list()` and a new `/api/reports/:id/options` route. The frontend rebuilds `pages/Reports.tsx` as a single full-height split view (library + detail), porting corlix's components to shadcn/OpenLDR primitives. The Document tab fetches the existing server-rendered `/api/reports/:id.pdf` and renders it in a `pdfjs-dist` canvas viewer ported from corlix. The Spreadsheet tab reuses the existing `data-table` primitives plus client-side CSV/XLSX export.

**Tech Stack:** TypeScript, React, react-i18next, Fastify, Kysely, Zod, shadcn/Radix, recharts (unused here), `pdfjs-dist` (new), `xlsx` (SheetJS, existing), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-22-reports-page-sp1-core-design.md`

**Conventions (read before starting):**
- Always use shadcn primitives in `apps/web/src/components/ui/*`; never native `<select>`.
- Web imports forms/report helpers from package entry points, not deep paths.
- Gate after each task or batch: `pnpm -w turbo typecheck lint test build`. The `@openldr/web#test` suite has a known parallel-flake (Dhis2/Terminology); re-run the web suite in isolation if it flakes: `pnpm --filter @openldr/web test`.
- i18n has compile-time key parity (`apps/web/src/i18n/parity.test.ts`): every key added to `en.ts` MUST also be added to `fr.ts` and `pt.ts`.

---

## Task 1: Backend — extend reporting type model

**Files:**
- Modify: `packages/reporting/src/types.ts`
- Test: `packages/reporting/src/types.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/reporting/src/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ReportCategory, ReportParamMeta, ReportMetricMeta } from './types';

describe('reporting UI metadata types', () => {
  it('allows constructing valid metadata objects', () => {
    const cat: ReportCategory = 'amr';
    const param: ReportParamMeta = { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' };
    const metric: ReportMetricMeta = { id: 'avgR', label: 'Avg %R', type: 'avg', column: 'percentR' };
    expect(cat).toBe('amr');
    expect(param.type).toBe('select');
    expect(metric.type).toBe('avg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/reporting test -- types.test.ts`
Expected: FAIL — `ReportCategory`/`ReportParamMeta`/`ReportMetricMeta` are not exported.

- [ ] **Step 3: Extend the types**

In `packages/reporting/src/types.ts`, add after the existing `ChartHint` block and extend the two interfaces:

```ts
export type ReportCategory = 'amr' | 'operational' | 'quality' | 'regulatory';

export interface ReportParamMeta {
  id: string;
  label: string;
  type: 'daterange' | 'select' | 'text';
  required: boolean;
  /** Key into the report's options() result, for type 'select'. */
  optionsKey?: string;
}

export interface ReportMetricMeta {
  id: string;
  label: string;
  type: 'count' | 'sum' | 'avg' | 'pct';
  /** Column the metric is computed over (sum/avg/pct). */
  column?: string;
  /** For pct: the value to match against `column`. */
  match?: string;
}
```

Extend `ReportSummary`:

```ts
export interface ReportSummary {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;
  parameters: ReportParamMeta[];
  summaryMetrics?: ReportMetricMeta[];
}
```

Extend `ReportDefinition` (add the three metadata fields and the optional resolver; keep `params`/`run`):

```ts
export interface ReportDefinition<P = unknown> {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;
  parameters: ReportParamMeta[];
  summaryMetrics?: ReportMetricMeta[];
  params: ZodType<P>;
  run(db: Kysely<ExternalSchema>, params: P): Promise<ReportResultData>;
  /** Resolves dynamic select options keyed by ReportParamMeta.optionsKey. */
  options?(db: Kysely<ExternalSchema>): Promise<Record<string, string[]>>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/reporting test -- types.test.ts`
Expected: PASS. (Type errors elsewhere are expected until Task 2 — that's fine for this isolated test file.)

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/types.ts packages/reporting/src/types.test.ts
git commit -m "feat(reporting): add report UI metadata types (category, params, metrics)"
```

---

## Task 2: Backend — add metadata + facility options to the 7 reports

**Files:**
- Modify: `packages/reporting/src/helpers.ts` (add `facilityOptions`)
- Modify: `packages/reporting/src/reports/amr-resistance.ts`, `test-volume.ts`, `patient-demographics.ts`, `turnaround-time.ts`, `amr-antibiogram.ts`, `amr-first-isolate-summary.ts`, `amr-glass-ris.ts`
- Modify: `packages/reporting/src/catalog.ts`
- Test: `packages/reporting/src/catalog.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/reporting/src/catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reportCatalog, reportSummaries } from './catalog';

describe('report catalog metadata', () => {
  it('every report declares a category and parameter list', () => {
    for (const def of reportCatalog()) {
      expect(['amr', 'operational', 'quality', 'regulatory']).toContain(def.category);
      expect(Array.isArray(def.parameters)).toBe(true);
      for (const p of def.parameters) {
        expect(['daterange', 'select', 'text']).toContain(p.type);
        if (p.type === 'select') expect(typeof p.optionsKey).toBe('string');
      }
    }
  });

  it('summary metrics reference columns the report can produce', () => {
    const amr = reportCatalog().find((r) => r.id === 'amr-resistance')!;
    const cols = ['antibiotic', 'tested', 'r', 'i', 's', 'percentR'];
    for (const m of amr.summaryMetrics ?? []) {
      if (m.column) expect(cols).toContain(m.column);
    }
  });

  it('reportSummaries() exposes the enriched metadata', () => {
    const s = reportSummaries().find((r) => r.id === 'test-volume')!;
    expect(s.category).toBe('operational');
    expect(s.parameters.some((p) => p.type === 'daterange')).toBe(true);
  });

  it('reports with a facility select expose an options resolver', () => {
    const withFacility = reportCatalog().filter((r) => r.parameters.some((p) => p.optionsKey === 'facility'));
    for (const def of withFacility) expect(typeof def.options).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/reporting test -- catalog.test.ts`
Expected: FAIL — `category` undefined on definitions.

- [ ] **Step 3: Add the shared facility-options helper**

In `packages/reporting/src/helpers.ts`, add (keep existing exports):

```ts
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';

/** Distinct facility ids (patients.managing_organization), sorted, for select params. */
export async function facilityOptions(db: Kysely<ExternalSchema>): Promise<Record<string, string[]>> {
  const rows = await db
    .selectFrom('patients')
    .select('managing_organization')
    .distinct()
    .where('managing_organization', 'is not', null)
    .orderBy('managing_organization')
    .execute();
  return {
    facility: rows
      .map((r) => (r.managing_organization == null ? '' : String(r.managing_organization)))
      .filter((v) => v.length > 0),
  };
}
```

(If `helpers.ts` lacks the kysely/ExternalSchema imports, add them; if they already exist, don't duplicate.)

- [ ] **Step 4: Add metadata to each report**

For each report file, add `category`, `parameters`, `summaryMetrics` (and `options` where a facility select exists) to the exported definition object. Use exactly these values:

`amr-resistance.ts` — import `facilityOptions` and add:
```ts
  category: 'amr',
  parameters: [
    { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
    { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
  ],
  summaryMetrics: [
    { id: 'antibiotics', label: 'Antibiotics', type: 'count' },
    { id: 'avgR', label: 'Avg %R', type: 'avg', column: 'percentR' },
  ],
  options: facilityOptions,
```

`test-volume.ts`:
```ts
  category: 'operational',
  parameters: [
    { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
    { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
  ],
  summaryMetrics: [{ id: 'total', label: 'Total tests', type: 'sum', column: 'count' }],
  options: facilityOptions,
```

`patient-demographics.ts`:
```ts
  category: 'quality',
  parameters: [
    { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
    { id: 'asOf', label: 'As of (YYYY-MM-DD)', type: 'text', required: false },
  ],
  summaryMetrics: [{ id: 'patients', label: 'Patients', type: 'sum', column: 'total' }],
  options: facilityOptions,
```

`turnaround-time.ts`:
```ts
  category: 'operational',
  parameters: [
    { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
    { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
  ],
  summaryMetrics: [
    { id: 'avgHours', label: 'Avg hours', type: 'avg', column: 'avgHours' },
    { id: 'reports', label: 'Reports', type: 'sum', column: 'count' },
  ],
  options: facilityOptions,
```

`amr-antibiogram.ts`:
```ts
  category: 'amr',
  parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }],
  summaryMetrics: [{ id: 'pathogens', label: 'Pathogens', type: 'count' }],
```

`amr-first-isolate-summary.ts`:
```ts
  category: 'amr',
  parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }],
  summaryMetrics: [{ id: 'avgR', label: 'Avg %R', type: 'avg', column: 'percentR' }],
```

`amr-glass-ris.ts`:
```ts
  category: 'regulatory',
  parameters: [
    { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
    { id: 'country', label: 'Country code', type: 'text', required: false },
    { id: 'year', label: 'Year', type: 'text', required: false },
  ],
  summaryMetrics: [{ id: 'isolates', label: 'Total isolates', type: 'sum', column: 'Total' }],
```

> Note: a `daterange` param maps to the `from`/`to` query keys at the UI layer; the report's Zod `params` schema is unchanged. The `id` `'dateRange'` is a UI grouping id, not a query key.

In `catalog.ts`, replace `reportSummaries()` to project the new fields:

```ts
export function reportSummaries(): ReportSummary[] {
  return REPORTS.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    parameters: r.parameters,
    summaryMetrics: r.summaryMetrics,
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/reporting test`
Expected: PASS (all reporting tests).

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src
git commit -m "feat(reporting): declare category/params/metrics + facility options per report"
```

---

## Task 3: Backend — `options(id)` API + `/api/reports/:id/options` route

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (ReportingApi interface + impl)
- Modify: `apps/server/src/reports-routes.ts`
- Test: `apps/server/src/reports-routes.test.ts` (create if absent; otherwise extend)

- [ ] **Step 1: Write the failing test**

Create/extend `apps/server/src/reports-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerReportRoutes } from './reports-routes';

function ctxStub() {
  return {
    reporting: {
      list: () => [],
      run: async () => ({ columns: [], rows: [], chart: { type: 'stat', value: '0', label: 'x' }, meta: { generatedAt: '', rowCount: 0 } }),
      renderPdf: async () => Buffer.from(''),
      options: async (id: string) => (id === 'amr-resistance' ? { facility: ['F1', 'F2'] } : {}),
    },
  } as unknown as Parameters<typeof registerReportRoutes>[1];
}

describe('GET /api/reports/:id/options', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    registerReportRoutes(app, ctxStub());
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('returns the option map for a report', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance/options' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ facility: ['F1', 'F2'] });
  });

  it('returns {} for reports without options', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-antibiogram/options' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- reports-routes.test.ts`
Expected: FAIL — route 404 / `options` missing.

- [ ] **Step 3: Add `options` to ReportingApi + bootstrap impl**

In `packages/bootstrap/src/index.ts`, extend the `ReportingApi` interface:

```ts
export interface ReportingApi {
  list(): ReportSummary[];
  run(id: string, rawParams: unknown): Promise<ReportResult>;
  runEventSource(id: string, window: { from: string; to: string }): Promise<{ rows: Record<string, unknown>[] }>;
  eventSources(): { id: string; name: string; columns: { key: string; label: string }[] }[];
  renderPdf(id: string, rawParams: unknown): Promise<Buffer>;
  options(id: string): Promise<Record<string, string[]>>;
}
```

In the `reporting` object literal, add (after `renderPdf`):

```ts
    async options(id) {
      const def = getReport(id);
      if (!def) throw new ReportNotFoundError(id);
      return def.options ? def.options(reportingDb) : {};
    },
```

- [ ] **Step 4: Add the route**

In `apps/server/src/reports-routes.ts`, add this route (place it just before the bare `:id` GET):

```ts
  app.get('/api/reports/:id/options', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await ctx.reporting.options(id);
    } catch (err) {
      return mapError(err, reply);
    }
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server test -- reports-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/index.ts apps/server/src/reports-routes.ts apps/server/src/reports-routes.test.ts
git commit -m "feat(reports): add reporting.options(id) + GET /api/reports/:id/options"
```

---

## Task 4: Frontend — add `pdfjs-dist`, enrich api.ts types + helpers

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/api.ts`
- Test: `apps/web/src/api.test.ts` (extend if present; else create a focused test)

- [ ] **Step 1: Add the dependency**

Run:
```bash
pnpm --filter @openldr/web add pdfjs-dist
```
Confirm `pdfjs-dist` now appears under `dependencies` in `apps/web/package.json`.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/api.reports.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchReportOptions, fetchReportPdf, csvUrl } from './api';

afterEach(() => vi.restoreAllMocks());

describe('report api helpers', () => {
  it('csvUrl builds a query string', () => {
    expect(csvUrl('amr-resistance', { from: '2026-01-01' })).toBe('/api/reports/amr-resistance.csv?from=2026-01-01');
  });

  it('fetchReportOptions returns the option map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ facility: ['F1'] }), { status: 200 })));
    await expect(fetchReportOptions('amr-resistance')).resolves.toEqual({ facility: ['F1'] });
  });

  it('fetchReportPdf returns a Blob', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['%PDF']), { status: 200 })));
    const blob = await fetchReportPdf('amr-resistance', { from: '2026-01-01' });
    expect(blob).toBeInstanceOf(Blob);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- api.reports.test.ts`
Expected: FAIL — `fetchReportOptions`/`fetchReportPdf` not exported.

- [ ] **Step 4: Enrich api.ts**

In `apps/web/src/api.ts`, replace the `ReportSummary` interface and add the metadata types + helpers:

```ts
export type ReportCategory = 'amr' | 'operational' | 'quality' | 'regulatory';
export interface ReportParamMeta {
  id: string;
  label: string;
  type: 'daterange' | 'select' | 'text';
  required: boolean;
  optionsKey?: string;
}
export interface ReportMetricMeta {
  id: string;
  label: string;
  type: 'count' | 'sum' | 'avg' | 'pct';
  column?: string;
  match?: string;
}
export interface ReportSummary {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;
  parameters: ReportParamMeta[];
  summaryMetrics?: ReportMetricMeta[];
}
```

Add after `fetchReport`:

```ts
export async function fetchReportOptions(id: string): Promise<Record<string, string[]>> {
  const res = await authFetch(`/api/reports/${encodeURIComponent(id)}/options`);
  if (!res.ok) throw new Error(`report options ${id} failed: ${res.status}`);
  return res.json() as Promise<Record<string, string[]>>;
}

export async function fetchReportPdf(id: string, params: Record<string, string> = {}): Promise<Blob> {
  const qs = new URLSearchParams(params).toString();
  const res = await authFetch(`/api/reports/${encodeURIComponent(id)}.pdf${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`report pdf ${id} failed: ${res.status}`);
  return res.blob();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- api.reports.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/api.ts apps/web/src/api.reports.test.ts pnpm-lock.yaml
git commit -m "feat(web): add pdfjs-dist + enriched report api types/helpers"
```

---

## Task 5: Frontend — i18n keys for the reports page

**Files:**
- Modify: `apps/web/src/i18n/en.ts`, `fr.ts`, `pt.ts`

- [ ] **Step 1: Add the `reports` namespace + missing `common` keys to en.ts**

In `apps/web/src/i18n/en.ts`, add a top-level `reports` object (sibling of `table`, `common`, etc.) and add `previous`/`next` to `common` if missing:

```ts
  reports: {
    searchPlaceholder: 'Search reports…',
    pinned: 'Pinned',
    selectReport: 'Select a report from the library.',
    runReport: 'Run the report to see results.',
    running: 'Running…',
    run: 'Run',
    runHistory: 'Run History',
    schedules: 'Schedules',
    comingSoon: 'Coming soon',
    tabDocument: 'Document',
    tabSpreadsheet: 'Spreadsheet',
    runMeta: '{{count}} rows · {{time}}',
    all: 'All',
    download: 'Download',
    exportCsv: 'Export CSV',
    exportXlsx: 'Export XLSX',
    pdfRenderError: 'Could not render the PDF.',
    noData: 'No data for the selected filters.',
    categories: {
      amr: 'AMR / Surveillance',
      operational: 'Operational',
      quality: 'Quality',
      regulatory: 'Regulatory',
    },
  },
```

In `common`, ensure these exist (add if missing): `previous: 'Previous'`, `next: 'Next'`.

- [ ] **Step 2: Mirror into fr.ts and pt.ts**

Add the same `reports` object to `fr.ts` and `pt.ts` with translated strings (and `common.previous`/`common.next`). French:

```ts
  reports: {
    searchPlaceholder: 'Rechercher des rapports…',
    pinned: 'Épinglés',
    selectReport: 'Sélectionnez un rapport dans la bibliothèque.',
    runReport: 'Exécutez le rapport pour voir les résultats.',
    running: 'Exécution…',
    run: 'Exécuter',
    runHistory: 'Historique',
    schedules: 'Planifications',
    comingSoon: 'Bientôt disponible',
    tabDocument: 'Document',
    tabSpreadsheet: 'Tableur',
    runMeta: '{{count}} lignes · {{time}}',
    all: 'Tous',
    download: 'Télécharger',
    exportCsv: 'Exporter CSV',
    exportXlsx: 'Exporter XLSX',
    pdfRenderError: 'Impossible d’afficher le PDF.',
    noData: 'Aucune donnée pour les filtres sélectionnés.',
    categories: { amr: 'RAM / Surveillance', operational: 'Opérationnel', quality: 'Qualité', regulatory: 'Réglementaire' },
  },
```

Portuguese:

```ts
  reports: {
    searchPlaceholder: 'Pesquisar relatórios…',
    pinned: 'Fixados',
    selectReport: 'Selecione um relatório na biblioteca.',
    runReport: 'Execute o relatório para ver os resultados.',
    running: 'Executando…',
    run: 'Executar',
    runHistory: 'Histórico',
    schedules: 'Agendamentos',
    comingSoon: 'Em breve',
    tabDocument: 'Documento',
    tabSpreadsheet: 'Planilha',
    runMeta: '{{count}} linhas · {{time}}',
    all: 'Todos',
    download: 'Baixar',
    exportCsv: 'Exportar CSV',
    exportXlsx: 'Exportar XLSX',
    pdfRenderError: 'Não foi possível renderizar o PDF.',
    noData: 'Sem dados para os filtros selecionados.',
    categories: { amr: 'RAM / Vigilância', operational: 'Operacional', quality: 'Qualidade', regulatory: 'Regulatório' },
  },
```

- [ ] **Step 3: Run the parity test**

Run: `pnpm --filter @openldr/web test -- parity.test.ts`
Expected: PASS — en/fr/pt key shapes match.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/en.ts apps/web/src/i18n/fr.ts apps/web/src/i18n/pt.ts
git commit -m "feat(web): i18n keys for the reports page (en/fr/pt)"
```

---

## Task 6: Frontend — report preferences (localStorage)

**Files:**
- Create: `apps/web/src/reports/lib/report-preferences.ts`
- Test: `apps/web/src/reports/lib/report-preferences.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadPinned, savePinned, togglePinned, loadLastParams, saveLastParams } from './report-preferences';

beforeEach(() => localStorage.clear());

describe('report preferences', () => {
  it('toggles a pinned id on and off', () => {
    expect(togglePinned([], 'a')).toEqual(['a']);
    expect(togglePinned(['a'], 'a')).toEqual([]);
  });

  it('persists pinned ids to localStorage', () => {
    savePinned(['x', 'y']);
    expect(loadPinned()).toEqual(['x', 'y']);
  });

  it('round-trips last params per report', () => {
    saveLastParams({ 'amr-resistance': { from: '2026-01-01' } });
    expect(loadLastParams()['amr-resistance']).toEqual({ from: '2026-01-01' });
  });

  it('returns safe defaults when storage is empty or malformed', () => {
    localStorage.setItem('reports.pinned', 'not json');
    expect(loadPinned()).toEqual([]);
    expect(loadLastParams()).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- report-preferences.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
const PINNED_KEY = 'reports.pinned';
const LAST_PARAMS_KEY = 'reports.lastParams';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadPinned(): string[] {
  const v = readJson<string[]>(PINNED_KEY, []);
  return Array.isArray(v) ? v : [];
}

export function savePinned(ids: string[]): void {
  localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
}

export function togglePinned(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export type LastParams = Record<string, Record<string, string>>;

export function loadLastParams(): LastParams {
  const v = readJson<LastParams>(LAST_PARAMS_KEY, {});
  return v && typeof v === 'object' ? v : {};
}

export function saveLastParams(map: LastParams): void {
  localStorage.setItem(LAST_PARAMS_KEY, JSON.stringify(map));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- report-preferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/lib/report-preferences.ts apps/web/src/reports/lib/report-preferences.test.ts
git commit -m "feat(web): report preferences (pinned + last params) in localStorage"
```

---

## Task 7: Frontend — summary metric computation

**Files:**
- Create: `apps/web/src/reports/lib/report-summary.ts`
- Test: `apps/web/src/reports/lib/report-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeSummaryMetrics } from './report-summary';
import type { ReportMetricMeta } from '../../api';

const rows = [
  { antibiotic: 'AMP', percentR: 40, tested: 10 },
  { antibiotic: 'CIP', percentR: 60, tested: 30 },
];

describe('computeSummaryMetrics', () => {
  it('count returns the row count', () => {
    const m: ReportMetricMeta = { id: 'c', label: 'N', type: 'count' };
    expect(computeSummaryMetrics([m], rows)[0].value).toBe('2');
  });
  it('sum adds the column', () => {
    const m: ReportMetricMeta = { id: 's', label: 'Tested', type: 'sum', column: 'tested' };
    expect(computeSummaryMetrics([m], rows)[0].value).toBe('40');
  });
  it('avg averages the column', () => {
    const m: ReportMetricMeta = { id: 'a', label: 'Avg', type: 'avg', column: 'percentR' };
    expect(computeSummaryMetrics([m], rows)[0].value).toBe('50');
  });
  it('pct computes a matching percentage', () => {
    const m: ReportMetricMeta = { id: 'p', label: 'Pct', type: 'pct', column: 'antibiotic', match: 'AMP' };
    expect(computeSummaryMetrics([m], rows)[0].value).toBe('50%');
  });
  it('handles empty rows', () => {
    const m: ReportMetricMeta = { id: 'a', label: 'Avg', type: 'avg', column: 'percentR' };
    expect(computeSummaryMetrics([m], [])[0].value).toBe('0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- report-summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { ReportMetricMeta } from '../../api';

export interface ComputedMetric {
  id: string;
  label: string;
  value: string;
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function numbersOf(rows: Record<string, unknown>[], column: string): number[] {
  return rows.map((r) => Number(r[column])).filter((n) => Number.isFinite(n));
}

function computeOne(m: ReportMetricMeta, rows: Record<string, unknown>[]): string {
  if (m.type === 'count') return String(rows.length);
  if (m.type === 'pct') {
    if (rows.length === 0 || !m.column) return '0%';
    const hits = rows.filter((r) => String(r[m.column!]) === String(m.match ?? '')).length;
    return `${fmt((hits / rows.length) * 100)}%`;
  }
  if (!m.column) return '0';
  const nums = numbersOf(rows, m.column);
  if (nums.length === 0) return '0';
  if (m.type === 'sum') return fmt(nums.reduce((a, b) => a + b, 0));
  return fmt(nums.reduce((a, b) => a + b, 0) / nums.length); // avg
}

export function computeSummaryMetrics(
  metrics: ReportMetricMeta[],
  rows: Record<string, unknown>[],
): ComputedMetric[] {
  return metrics.map((m) => ({ id: m.id, label: m.label, value: computeOne(m, rows) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- report-summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/lib/report-summary.ts apps/web/src/reports/lib/report-summary.test.ts
git commit -m "feat(web): summary metric computation for the reports page"
```

---

## Task 8: Frontend — export helpers (CSV link + XLSX)

**Files:**
- Create: `apps/web/src/reports/lib/report-export.ts`
- Test: `apps/web/src/reports/lib/report-export.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildExportRows } from './report-export';
import type { ReportColumn } from '../../api';

const columns: ReportColumn[] = [
  { key: 'antibiotic', label: 'Antibiotic', kind: 'string' },
  { key: 'percentR', label: '%R', kind: 'percent' },
];

describe('buildExportRows', () => {
  it('maps rows to label-keyed objects in column order', () => {
    const rows = [{ antibiotic: 'AMP', percentR: 40 }];
    expect(buildExportRows(columns, rows)).toEqual([{ Antibiotic: 'AMP', '%R': 40 }]);
  });
  it('blanks null/undefined cells', () => {
    expect(buildExportRows(columns, [{ antibiotic: null }])).toEqual([{ Antibiotic: '', '%R': '' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- report-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import * as XLSX from 'xlsx';
import type { ReportColumn } from '../../api';

/** Pure: shape rows into label-keyed objects (column order preserved). Testable. */
export function buildExportRows(
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((r) =>
    Object.fromEntries(columns.map((c) => [c.label, r[c.key] ?? ''])),
  );
}

/** Triggers a client-side XLSX download of the given (already filtered) rows. */
export function exportXlsx(
  fileName: string,
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
): void {
  const ws = XLSX.utils.json_to_sheet(buildExportRows(columns, rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- report-export.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/lib/report-export.ts apps/web/src/reports/lib/report-export.test.ts
git commit -m "feat(web): report export helpers (XLSX + pure row builder)"
```

---

## Task 9: Frontend — PdfCanvasViewer (port from corlix)

**Files:**
- Create: `apps/web/src/reports/PdfCanvasViewer.tsx`
- Test: `apps/web/src/reports/PdfCanvasViewer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n/i18n-test-setup'; // if the repo has a shared i18n test setup; otherwise see note below

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 10, height: 10 }), render: () => ({ promise: Promise.resolve() }) }) }),
    destroy: () => {},
  }),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker-url' }));

import { PdfCanvasViewer } from './PdfCanvasViewer';

describe('PdfCanvasViewer', () => {
  it('renders a toolbar with a download button', async () => {
    render(<PdfCanvasViewer blob={new Blob(['%PDF'])} fileName="r.pdf" />);
    expect(await screen.findByText(/download|télécharger|baixar/i)).toBeInTheDocument();
  });
});
```

> Note: if the repo has no shared i18n test setup import, drop that import line — other web component tests in this repo show the working pattern (check `Reports.test.tsx`'s imports and copy its i18n wrapper). Use the same wrapper the existing tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- PdfCanvasViewer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (ported from corlix, JSX→TSX, i18n via react-i18next)**

```tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.2;

interface Props {
  blob: Blob;
  fileName: string;
}

export function PdfCanvasViewer({ blob, fileName }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMsg('');
    blob
      .arrayBuffer()
      .then((buf) => {
        if (cancelled) return;
        const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
        loadingTaskRef.current = task;
        return task.promise.then((doc) => {
          if (cancelled) return;
          docRef.current = doc;
          setNumPages(doc.numPages);
          setPageNum(1);
          setStatus('ready');
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      docRef.current = null;
    };
  }, [blob]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (status !== 'ready' || !doc || !canvas) return;
    let cancelled = false;
    renderTaskRef.current?.cancel();
    doc
      .getPage(pageNum)
      .then((page) => {
        if (cancelled) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        task.promise.catch(() => {});
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pageNum, scale, status]);

  const handleDownload = useCallback(() => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [blob, fileName]);

  if (status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm text-destructive">{t('reports.pdfRenderError')}</p>
        <p className="text-xs text-muted-foreground">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-[#1b1b1b] px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
            className="rounded p-1 hover:bg-[rgba(70,130,180,0.12)] disabled:opacity-30"
            aria-label={t('common.previous')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular-nums">{numPages > 0 ? `${pageNum} / ${numPages}` : '—'}</span>
          <button
            onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
            disabled={pageNum >= numPages}
            className="rounded p-1 hover:bg-[rgba(70,130,180,0.12)] disabled:opacity-30"
            aria-label={t('common.next')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale((s) => Math.max(MIN_SCALE, Math.round((s - SCALE_STEP) * 10) / 10))}
            className="rounded p-1 hover:bg-[rgba(70,130,180,0.12)]"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(MAX_SCALE, Math.round((s + SCALE_STEP) * 10) / 10))}
            className="rounded p-1 hover:bg-[rgba(70,130,180,0.12)]"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={handleDownload}
          className="ml-auto flex items-center gap-1.5 rounded px-2 py-1 hover:bg-[rgba(70,130,180,0.12)]"
        >
          <Download className="h-3.5 w-3.5" />
          {t('reports.download')}
        </button>
      </div>
      <div className="flex-1 overflow-auto bg-[#262626] p-5">
        {status === 'loading' ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : (
          <div className="flex justify-center">
            <canvas ref={canvasRef} className="shadow-lg" />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- PdfCanvasViewer.test.tsx`
Expected: PASS. If Vite's `?url` import breaks under Vitest despite the mock, add `'pdfjs-dist/build/pdf.worker.min.mjs?url'` to `test.server.deps.inline` or alias it in `vitest.config` — but the `vi.mock` above should suffice.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/PdfCanvasViewer.tsx apps/web/src/reports/PdfCanvasViewer.test.tsx
git commit -m "feat(web): PdfCanvasViewer (pdf.js canvas viewer ported from corlix)"
```

---

## Task 10: Frontend — ReportLibrary

**Files:**
- Create: `apps/web/src/reports/ReportLibrary.tsx`
- Test: `apps/web/src/reports/ReportLibrary.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportLibrary } from './ReportLibrary';
import type { ReportSummary } from '../api';

const reports: ReportSummary[] = [
  { id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [] },
  { id: 'test-volume', name: 'Test Volume', description: '', category: 'operational', parameters: [] },
];

function setup(extra?: Partial<React.ComponentProps<typeof ReportLibrary>>) {
  const onSelect = vi.fn();
  const onTogglePin = vi.fn();
  const onSearchChange = vi.fn();
  render(
    <ReportLibrary
      reports={reports}
      selectedId={null}
      onSelect={onSelect}
      pinnedIds={[]}
      onTogglePin={onTogglePin}
      search=""
      onSearchChange={onSearchChange}
      collapsed={false}
      onToggleCollapse={() => {}}
      {...extra}
    />,
  );
  return { onSelect, onTogglePin, onSearchChange };
}

describe('ReportLibrary', () => {
  it('lists reports and fires onSelect', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByText('AMR Resistance Rate'));
    expect(onSelect).toHaveBeenCalledWith('amr-resistance');
  });

  it('filters by search text (case-insensitive)', () => {
    setup({ search: 'volume' });
    expect(screen.queryByText('AMR Resistance Rate')).not.toBeInTheDocument();
    expect(screen.getByText('Test Volume')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- ReportLibrary.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReportSummary, ReportCategory } from '../api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface Props {
  reports: ReportSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const CATEGORY_ORDER: ReportCategory[] = ['amr', 'operational', 'quality', 'regulatory'];

export function ReportLibrary({
  reports, selectedId, onSelect, pinnedIds, onTogglePin,
  search, onSearchChange, collapsed, onToggleCollapse,
}: Props) {
  const { t } = useTranslation();

  const filtered = useMemo(
    () => reports.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())),
    [reports, search],
  );
  const pinned = filtered.filter((r) => pinnedIds.includes(r.id));
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: filtered.filter((r) => r.category === cat),
  })).filter((g) => g.items.length > 0);

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-r border-border py-2">
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Expand library">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </aside>
    );
  }

  const Row = ({ r }: { r: ReportSummary }) => (
    <div
      className={cn(
        'group flex cursor-pointer items-center gap-2 border-l-2 px-3 py-2 text-sm transition-colors',
        r.id === selectedId
          ? 'border-[#5A9BD6] bg-[rgba(70,130,180,0.08)] text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      onClick={() => onSelect(r.id)}
    >
      <span className="min-w-0 flex-1 truncate">{r.name}</span>
      <button
        type="button"
        aria-label={`pin-${r.id}`}
        onClick={(e) => { e.stopPropagation(); onTogglePin(r.id); }}
        className="opacity-0 transition-opacity group-hover:opacity-100 data-[pinned=true]:opacity-100"
        data-pinned={pinnedIds.includes(r.id)}
      >
        <Star className={cn('h-3.5 w-3.5', pinnedIds.includes(r.id) && 'fill-[#5A9BD6] text-[#5A9BD6]')} />
      </button>
    </div>
  );

  return (
    <aside className="flex w-[230px] shrink-0 flex-col border-r border-border">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('reports.searchPlaceholder')}
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Collapse library">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {pinned.length > 0 && (
          <div className="mb-1">
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('reports.pinned')}
            </div>
            {pinned.map((r) => <Row key={`pin-${r.id}`} r={r} />)}
          </div>
        )}
        {byCategory.map(({ cat, items }) => (
          <div key={cat} className="mb-1">
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`reports.categories.${cat}`)}
            </div>
            {items.map((r) => <Row key={r.id} r={r} />)}
          </div>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- ReportLibrary.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportLibrary.tsx apps/web/src/reports/ReportLibrary.test.tsx
git commit -m "feat(web): ReportLibrary sidebar (search, pin, categories, collapse)"
```

---

## Task 11: Frontend — ReportParametersBar

**Files:**
- Create: `apps/web/src/reports/ReportParametersBar.tsx`
- Test: `apps/web/src/reports/ReportParametersBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportParametersBar } from './ReportParametersBar';
import type { ReportSummary } from '../api';

const report: ReportSummary = {
  id: 'amr-resistance', name: 'AMR', description: '', category: 'amr',
  parameters: [
    { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
    { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
  ],
};

describe('ReportParametersBar', () => {
  it('renders a Run button that fires onRun', () => {
    const onRun = vi.fn();
    render(
      <ReportParametersBar
        report={report} params={{}} options={{ facility: ['F1'] }}
        onChange={() => {}} onRun={onRun} running={false} canRun
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /run|exécuter|executar/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it('disables Run when canRun is false', () => {
    render(
      <ReportParametersBar
        report={report} params={{}} options={{}}
        onChange={() => {}} onRun={() => {}} running={false} canRun={false}
      />,
    );
    expect(screen.getByRole('button', { name: /run|exécuter|executar/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- ReportParametersBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useTranslation } from 'react-i18next';
import type { ReportSummary, ReportParamMeta } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  report: ReportSummary;
  params: Record<string, string>;
  options: Record<string, string[]>;
  onChange: (params: Record<string, string>) => void;
  onRun: () => void;
  running: boolean;
  canRun: boolean;
}

const ALL = '__all__';

export function ReportParametersBar({ report, params, options, onChange, onRun, running, canRun }: Props) {
  const { t } = useTranslation();
  const set = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = { ...params };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') delete next[k];
      else next[k] = v;
    }
    onChange(next);
  };

  const renderControl = (p: ReportParamMeta) => {
    if (p.type === 'daterange') {
      const value = params.from || params.to ? { from: params.from ?? '', to: params.to ?? '' } : null;
      return (
        <DateRangePicker
          value={value}
          onChange={(v) => set({ from: v?.from, to: v?.to })}
          placeholder={p.label}
        />
      );
    }
    if (p.type === 'select') {
      const opts = p.optionsKey ? options[p.optionsKey] ?? [] : [];
      return (
        <Select
          value={params[p.id] ?? ALL}
          onValueChange={(v) => set({ [p.id]: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="h-9 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('reports.all')}</SelectItem>
            {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        value={params[p.id] ?? ''}
        onChange={(e) => set({ [p.id]: e.target.value })}
        placeholder={p.label}
        className="h-9 w-40 text-xs"
      />
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
      {report.parameters.map((p) => (
        <div key={p.id} className="flex flex-col gap-1">
          <Label className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {p.label}{p.required && <span className="text-destructive"> *</span>}
          </Label>
          {renderControl(p)}
        </div>
      ))}
      <Button className="ml-auto h-9" onClick={onRun} disabled={!canRun || running}>
        {running ? t('reports.running') : t('reports.run')}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- ReportParametersBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportParametersBar.tsx apps/web/src/reports/ReportParametersBar.test.tsx
git commit -m "feat(web): ReportParametersBar (daterange/select/text + Run)"
```

---

## Task 12: Frontend — ReportSummaryStrip

**Files:**
- Create: `apps/web/src/reports/ReportSummaryStrip.tsx`
- Test: `apps/web/src/reports/ReportSummaryStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportSummaryStrip } from './ReportSummaryStrip';

describe('ReportSummaryStrip', () => {
  it('renders metric label/value pairs', () => {
    render(<ReportSummaryStrip metrics={[{ id: 'a', label: 'Avg %R', value: '50' }]} />);
    expect(screen.getByText('Avg %R')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('renders nothing when there are no metrics', () => {
    const { container } = render(<ReportSummaryStrip metrics={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- ReportSummaryStrip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import type { ComputedMetric } from './lib/report-summary';

export function ReportSummaryStrip({ metrics }: { metrics: ComputedMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className="flex flex-wrap border-b border-border">
      {metrics.map((m, i) => (
        <div key={m.id} className={`px-4 py-2.5 ${i > 0 ? 'border-l border-border' : ''}`}>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
          <div className="text-lg font-semibold tabular-nums">{m.value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- ReportSummaryStrip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportSummaryStrip.tsx apps/web/src/reports/ReportSummaryStrip.test.tsx
git commit -m "feat(web): ReportSummaryStrip KPI bar"
```

---

## Task 13: Frontend — ReportActionsMenu (History/Schedules disabled in SP-1)

**Files:**
- Create: `apps/web/src/reports/ReportActionsMenu.tsx`
- Test: `apps/web/src/reports/ReportActionsMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportActionsMenu } from './ReportActionsMenu';

describe('ReportActionsMenu', () => {
  it('shows History and Schedules items, both disabled (coming soon)', async () => {
    render(<ReportActionsMenu />);
    fireEvent.click(screen.getByRole('button', { name: /actions|more/i }));
    const history = await screen.findByText(/run history|historique|histórico/i);
    expect(history.closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- ReportActionsMenu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

/**
 * SP-1: History and Schedules are placeholders (disabled). They are wired live
 * in SP-2 (Run History) and SP-3 (Scheduling).
 */
export function ReportActionsMenu() {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('common.actions')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled title={t('reports.comingSoon')}>
          {t('reports.runHistory')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled title={t('reports.comingSoon')}>
          {t('reports.schedules')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- ReportActionsMenu.test.tsx`
Expected: PASS. (If the shadcn `DropdownMenuItem` renders `data-disabled` instead of `aria-disabled`, adjust the test assertion to match the actual attribute — inspect `components/ui/dropdown-menu.tsx`.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportActionsMenu.tsx apps/web/src/reports/ReportActionsMenu.test.tsx
git commit -m "feat(web): ReportActionsMenu (History/Schedules placeholders)"
```

---

## Task 14: Frontend — ReportDocumentTab

**Files:**
- Create: `apps/web/src/reports/ReportDocumentTab.tsx`
- Test: `apps/web/src/reports/ReportDocumentTab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div>pdf-viewer</div> }));
vi.mock('../api', () => ({ fetchReportPdf: vi.fn(async () => new Blob(['%PDF'])) }));

import { ReportDocumentTab } from './ReportDocumentTab';

describe('ReportDocumentTab', () => {
  it('fetches the PDF and renders the viewer', async () => {
    render(<ReportDocumentTab reportId="amr-resistance" params={{ from: '2026-01-01' }} />);
    expect(await screen.findByText('pdf-viewer')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- ReportDocumentTab.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchReportPdf } from '../api';
import { PdfCanvasViewer } from './PdfCanvasViewer';

interface Props {
  reportId: string;
  params: Record<string, string>;
}

export function ReportDocumentTab({ reportId, params }: Props) {
  const { t } = useTranslation();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const key = `${reportId}?${new URLSearchParams(params).toString()}`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setBlob(null);
    fetchReportPdf(reportId, params)
      .then((b) => { if (active) { setBlob(b); setLoading(false); } })
      .catch((e: unknown) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('common.loading')}</div>;
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm text-destructive">{t('reports.pdfRenderError')}</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!blob) return null;
  return <PdfCanvasViewer blob={blob} fileName={`${reportId}.pdf`} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- ReportDocumentTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportDocumentTab.tsx apps/web/src/reports/ReportDocumentTab.test.tsx
git commit -m "feat(web): ReportDocumentTab (server PDF → canvas viewer)"
```

---

## Task 15: Frontend — ReportSpreadsheetTab

**Files:**
- Create: `apps/web/src/reports/ReportSpreadsheetTab.tsx`
- Test: `apps/web/src/reports/ReportSpreadsheetTab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportSpreadsheetTab } from './ReportSpreadsheetTab';
import type { ReportResult } from '../api';

const result: ReportResult = {
  columns: [
    { key: 'antibiotic', label: 'Antibiotic', kind: 'string' },
    { key: 'percentR', label: '%R', kind: 'percent' },
  ],
  rows: [{ antibiotic: 'AMP', percentR: 40 }, { antibiotic: 'CIP', percentR: 60 }],
  chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
  meta: { generatedAt: '2026-01-01', rowCount: 2 },
};

describe('ReportSpreadsheetTab', () => {
  it('renders rows and a CSV export link', () => {
    render(<ReportSpreadsheetTab reportId="amr-resistance" result={result} params={{ from: '2026-01-01' }} />);
    expect(screen.getByText('AMP')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    const csv = screen.getByRole('link', { name: /csv/i });
    expect(csv).toHaveAttribute('href', '/api/reports/amr-resistance.csv?from=2026-01-01');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- ReportSpreadsheetTab.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import type { ReportResult, ReportColumn } from '../api';
import { csvUrl } from '../api';
import { exportXlsx } from './lib/report-export';
import { useTableState } from '@/components/data-table/useTableState';
import { applyTableState } from '@/components/data-table/applyTableState';
import { DataTableToolbar } from '@/components/data-table/DataTableToolbar';
import type { ColumnDef, ColumnType } from '@/components/data-table/types';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

type Row = Record<string, unknown>;

function formatCell(v: unknown, kind: ReportColumn['kind']): string {
  if (v === null || v === undefined || v === '') return '—';
  if (kind === 'percent') return `${v}%`;
  return String(v);
}

function colType(kind: ReportColumn['kind']): ColumnType {
  return kind === 'number' || kind === 'percent' ? 'number' : kind === 'date' ? 'date' : 'text';
}

interface Props {
  reportId: string;
  result: ReportResult;
  params: Record<string, string>;
}

export function ReportSpreadsheetTab({ reportId, result, params }: Props) {
  const { t } = useTranslation();

  const columns = useMemo<ColumnDef<Row>[]>(
    () => result.columns.map((c) => ({
      id: c.key,
      labelKey: c.label, // plain label; i18n returns the key unchanged when no translation exists
      accessor: (row: Row) => formatCell(row[c.key], c.kind),
      type: colType(c.kind),
      defaultVisible: true,
      sortable: true,
      filterable: true,
    })),
    [result.columns],
  );

  const state = useTableState<Row>({ columns, defaultPageSize: 25 });
  const { rows, total } = useMemo(
    () => applyTableState(result.rows, state, columns),
    [result.rows, state, columns],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <DataTableToolbar
          columns={columns}
          filters={state.filters}
          onFiltersChange={state.setFilters}
          sorts={state.sorts}
          onSortsChange={state.setSorts}
          visibleIds={state.visibleIds}
          onVisibleIdsChange={state.setVisibleIds}
          onResetColumns={state.resetColumns}
          onResetAll={state.resetAll}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">
                  <Download className="mr-1.5 h-3.5 w-3.5" />{t('common.actions')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={csvUrl(reportId, params)}>{t('reports.exportCsv')}</a>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => exportXlsx(reportId, result.columns, applyTableState(result.rows, { ...state, page: 0, pageSize: result.rows.length || 1 }, columns).rows)}
                >
                  {t('reports.exportXlsx')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>{state.visibleColumns.map((c) => <TableHead key={c.id}>{t(c.labelKey)}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={state.visibleColumns.length} className="text-muted-foreground">
                  {t('reports.noData')}
                </TableCell>
              </TableRow>
            ) : rows.map((r, i) => (
              <TableRow key={i}>
                {state.visibleColumns.map((c) => <TableCell key={c.id}>{c.accessor(r)}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        page={state.page}
        pageSize={state.pageSize}
        total={total}
        onPageChange={state.setPage}
        onPageSizeChange={state.setPageSize}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- ReportSpreadsheetTab.test.tsx`
Expected: PASS. (The XLSX export branch isn't exercised by this test — `exportXlsx` triggers a download and is covered by Task 8's pure-function test.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportSpreadsheetTab.tsx apps/web/src/reports/ReportSpreadsheetTab.test.tsx
git commit -m "feat(web): ReportSpreadsheetTab (data-table grid + CSV/XLSX export)"
```

---

## Task 16: Frontend — assemble the Reports page; drop /reports/:id; retire ReportView

**Files:**
- Rewrite: `apps/web/src/pages/Reports.tsx`
- Rewrite: `apps/web/src/pages/Reports.test.tsx`
- Modify: `apps/web/src/App.tsx` (remove the `/reports/:id` route + import)
- Delete: `apps/web/src/pages/ReportDetail.tsx`
- Delete (conditional): `apps/web/src/reports/ReportView.tsx`, `apps/web/src/reports/ReportView.test.tsx`, `apps/web/src/reports/useReport.ts`

- [ ] **Step 1: Check ReportView/useReport usage before deleting**

Run:
```bash
grep -rn "ReportView\|useReport\|ReportDetail" apps/web/src --include=*.ts --include=*.tsx | grep -v "reports/ReportView\|reports/useReport\|pages/ReportDetail"
```
Expected: only references inside the reports page / detail you're replacing. If `ReportView`/`useReport` are imported elsewhere (e.g. dashboard), do NOT delete them — just stop using them on the reports page. Record what you find.

- [ ] **Step 2: Write the failing page test**

Replace `apps/web/src/pages/Reports.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  fetchReports: vi.fn(async () => [
    { id: 'amr-resistance', name: 'AMR Resistance Rate', description: 'desc', category: 'amr', parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }], summaryMetrics: [{ id: 'antibiotics', label: 'Antibiotics', type: 'count' }] },
  ]),
  fetchReport: vi.fn(async () => ({
    columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }],
    rows: [{ antibiotic: 'AMP' }],
    chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
    meta: { generatedAt: '2026-01-01', rowCount: 1 },
  })),
  fetchReportOptions: vi.fn(async () => ({})),
  fetchReportPdf: vi.fn(async () => new Blob(['%PDF'])),
  csvUrl: (id: string) => `/api/reports/${id}.csv`,
}));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div>pdf-viewer</div> }));

import { Reports } from './Reports';

beforeEach(() => localStorage.clear());

describe('Reports page', () => {
  it('lists reports; selecting + running shows the document tab', async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('AMR Resistance Rate'));
    fireEvent.click(await screen.findByRole('button', { name: /run|exécuter|executar/i }));
    await waitFor(() => expect(screen.getByText('pdf-viewer')).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- Reports.test.tsx`
Expected: FAIL — current `Reports.tsx` has the old card-grid shape.

- [ ] **Step 4: Rewrite Reports.tsx**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../shell/AppShell';
import {
  fetchReports, fetchReport, fetchReportOptions,
  type ReportSummary, type ReportResult,
} from '../api';
import { ReportLibrary } from '../reports/ReportLibrary';
import { ReportParametersBar } from '../reports/ReportParametersBar';
import { ReportSummaryStrip } from '../reports/ReportSummaryStrip';
import { ReportActionsMenu } from '../reports/ReportActionsMenu';
import { ReportDocumentTab } from '../reports/ReportDocumentTab';
import { ReportSpreadsheetTab } from '../reports/ReportSpreadsheetTab';
import { computeSummaryMetrics } from '../reports/lib/report-summary';
import {
  loadPinned, savePinned, togglePinned, loadLastParams, saveLastParams,
} from '../reports/lib/report-preferences';

type Tab = 'document' | 'spreadsheet';

export function Reports() {
  const { t } = useTranslation();
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [params, setParams] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('document');
  const [error, setError] = useState<string>();

  const selected = reports.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    fetchReports().then(setReports).catch((e) => setError(String(e)));
    setPinnedIds(loadPinned());
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setResult(null);
    setActiveTab('document');
    setParams(loadLastParams()[id] ?? {});
    setOptions({});
    fetchReportOptions(id).then(setOptions).catch(() => setOptions({}));
  }, []);

  const handleTogglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = togglePinned(prev, id);
      savePinned(next);
      return next;
    });
  }, []);

  const canRun = useMemo(() => {
    if (!selected) return false;
    return selected.parameters
      .filter((p) => p.required)
      .every((p) => (p.type === 'daterange' ? Boolean(params.from && params.to) : Boolean(params[p.id])));
  }, [selected, params]);

  const handleRun = useCallback(async () => {
    if (!selectedId) return;
    setRunning(true);
    setError(undefined);
    try {
      const res = await fetchReport(selectedId, params);
      setResult(res);
      setRanAt(new Date().toLocaleString());
      const next = { ...loadLastParams(), [selectedId]: params };
      saveLastParams(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [selectedId, params]);

  const metrics = useMemo(
    () => (selected?.summaryMetrics && result ? computeSummaryMetrics(selected.summaryMetrics, result.rows) : []),
    [selected, result],
  );

  return (
    <AppShell title={t('nav.reports')} fullBleed>
      <div className="flex h-full min-h-0">
        <ReportLibrary
          reports={reports}
          selectedId={selectedId}
          onSelect={handleSelect}
          pinnedIds={pinnedIds}
          onTogglePin={handleTogglePin}
          search={search}
          onSearchChange={setSearch}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('reports.selectReport')}
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold">{selected.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">{selected.description}</p>
                </div>
                <ReportActionsMenu />
              </div>

              <ReportParametersBar
                report={selected}
                params={params}
                options={options}
                onChange={setParams}
                onRun={handleRun}
                running={running}
                canRun={canRun}
              />

              <ReportSummaryStrip metrics={metrics} />

              {error && <div className="border-b border-border px-4 py-3 text-sm text-destructive">{error}</div>}

              {!result ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  {running ? t('reports.running') : t('reports.runReport')}
                </div>
              ) : (
                <>
                  <div className="flex items-center border-b border-border px-4">
                    {(['document', 'spreadsheet'] as Tab[]).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] transition-colors ${
                          activeTab === tab
                            ? 'border-[#5A9BD6] text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {tab === 'document' ? t('reports.tabDocument') : t('reports.tabSpreadsheet')}
                      </button>
                    ))}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {t('reports.runMeta', { count: result.meta.rowCount, time: ranAt })}
                    </span>
                  </div>

                  <div className="min-h-0 flex-1">
                    {activeTab === 'document' ? (
                      <ReportDocumentTab reportId={selected.id} params={params} />
                    ) : (
                      <ReportSpreadsheetTab reportId={selected.id} result={result} params={params} />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 5: Remove the `/reports/:id` route**

In `apps/web/src/App.tsx`: delete the import line `import { ReportDetail } from './pages/ReportDetail';` and the route `<Route path="/reports/:id" element={<ReportDetail />} />`.

- [ ] **Step 6: Delete dead files**

```bash
git rm apps/web/src/pages/ReportDetail.tsx
```
If Step 1 confirmed `ReportView`/`useReport` are unused elsewhere, also:
```bash
git rm apps/web/src/reports/ReportView.tsx apps/web/src/reports/ReportView.test.tsx apps/web/src/reports/useReport.ts
```
Otherwise leave them. Run `grep` again to confirm no dangling imports remain.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @openldr/web test -- Reports.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/Reports.tsx apps/web/src/pages/Reports.test.tsx apps/web/src/App.tsx
git add -u apps/web/src/pages apps/web/src/reports
git commit -m "feat(web): assemble corlix-parity reports page; drop /reports/:id detail route"
```

---

## Task 17: Full gate + memory update

- [ ] **Step 1: Run the full monorepo gate**

Run: `pnpm -w turbo typecheck lint test build`
Expected: all green. If `@openldr/web#test` flakes (known Dhis2/Terminology parallel flake), re-run in isolation: `pnpm --filter @openldr/web test`. Fix any real type/lint errors surfaced by the new code (e.g. unused imports, `ReportView` leftovers).

- [ ] **Step 2: Dependency-cruiser check**

Run: `pnpm -w depcruise` (or the repo's configured depcruise script — check `package.json`).
Expected: clean. The web `reports/` modules must only import from `@/components/*`, `../api`, `react-i18next`, `lucide-react`, `pdfjs-dist`, `xlsx`.

- [ ] **Step 3: Update project memory**

Append a line to `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\MEMORY.md` and create a `reports-page-workstream.md` memory noting: SP-1 (reports page corlix-parity core) DONE — enriched catalog metadata + `/api/reports/:id/options` + full reports page (library/params/summary/Document PDF viewer via pdfjs-dist/Spreadsheet) merged to local `main`; SP-2 (Run History) and SP-3 (Scheduling) still pending; `/reports/:id` route removed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(reports): SP-1 gate green + memory update"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** §1 catalog enrichment → Tasks 1–3; §2 layout → Tasks 10–13, 16; §3 PDF viewer → Tasks 9, 14; §4 spreadsheet → Tasks 8, 15; §5 no live charts → enforced (no chart component on the page); §6 routing → Task 16; §7 files → all tasks; §8 testing → every task is TDD + Task 17 gate.
- **Type consistency:** `ReportSummary`/`ReportParamMeta`/`ReportMetricMeta` shapes are identical in `packages/reporting/src/types.ts` (Task 1) and `apps/web/src/api.ts` (Task 4). `ComputedMetric` is defined once (Task 7) and consumed by `ReportSummaryStrip` (Task 12) and `Reports.tsx` (Task 16). `ReportingApi.options` added in Task 3 is consumed by the route in the same task.
- **Known risk:** the `data-table` `ColumnDef.labelKey` is normally an i18n key; here we pass the plain column label and rely on i18next returning the key unchanged when no translation exists (default behavior). If the project's i18n config throws on missing keys, wrap labels in a tiny passthrough instead. Verify during Task 15.
