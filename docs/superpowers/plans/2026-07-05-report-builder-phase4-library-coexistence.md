# Report Builder — Phase 4: Library Coexistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface published report templates in the Reports library with a "Custom" badge and full run-history / schedule / download support, restricted to PDF.

**Architecture:** A `source` discriminator on `ReportSummary` + a new PDF-only error code; a template-aware reporting service (`listAll()` merges catalog + published templates; `renderPdf`/`run`/`options` branch on template ids); routes use the merged list for listing + existence; the reports page branches custom reports to a PDF-only experience.

**Tech Stack:** TypeScript, Fastify, Zod, Vitest + RTL, `@openldr/reporting`, `@openldr/bootstrap`, `@openldr/report-builder`, `@openldr/core`.

**Spec:** `docs/superpowers/specs/2026-07-05-report-builder-phase4-library-coexistence-design.md`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `packages/reporting/src/types.ts` | `ReportSummary.source` | Modify |
| `packages/reporting/src/catalog.ts` | `reportSummaries()` sets `source:'catalog'` | Modify |
| `packages/core/src/error-catalog.ts` | `RP0005` PDF-only code | Modify |
| `packages/bootstrap/src/index.ts` | `ReportingApi.listAll` + template-aware run/renderPdf/options/findSummary | Modify |
| `packages/bootstrap/src/*.test.ts` | reporting service unit tests | Modify/Create |
| `apps/server/src/reports-routes.ts` | list→listAll; existence via findSummary | Modify |
| `apps/server/src/reports-routes.test.ts` | template listing/schedule/PDF-only tests | Modify |
| `apps/studio/src/reports/ReportLibrary.tsx` | "Custom" badge | Modify |
| `apps/studio/src/pages/Reports.tsx` (orchestrator) + tabs/ScheduleDialog | custom → PDF-only branch | Modify |

---

## Task 1: `ReportSummary.source` + `RP0005` PDF-only code

**Files:**
- Modify: `packages/reporting/src/types.ts`, `packages/reporting/src/catalog.ts`
- Modify: `packages/core/src/error-catalog.ts`
- Test: `packages/reporting/src/catalog.test.ts`, `packages/core/src/error-catalog.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/reporting/src/catalog.test.ts`:
```ts
import { reportSummaries } from './catalog';
it('marks catalog reports with source "catalog"', () => {
  expect(reportSummaries().every((s) => s.source === 'catalog')).toBe(true);
});
```
Add to `packages/core/src/error-catalog.test.ts`:
```ts
it('has the RP0005 pdf-only code', () => {
  expect(CATALOG.RP0005.domain).toBe('reports');
  expect(CATALOG.RP0005.httpStatus).toBe(400);
});
```
(`CATALOG` is already imported in that test file.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @openldr/reporting exec vitest run src/catalog.test.ts` — FAIL (no `source`).
Run: `pnpm --filter @openldr/core exec vitest run src/error-catalog.test.ts` — FAIL (no RP0005).

- [ ] **Step 3: Implement**

In `packages/reporting/src/types.ts`, add to `ReportSummary`:
```ts
  source?: 'catalog' | 'builder';
```
In `packages/reporting/src/catalog.ts`, `reportSummaries()` maps each report with `source: 'catalog'`:
```ts
export function reportSummaries(): ReportSummary[] {
  return REPORTS.map((r) => ({
    id: r.id, name: r.name, description: r.description, category: r.category,
    parameters: r.parameters, summaryMetrics: r.summaryMetrics, source: 'catalog',
  }));
}
```
In `packages/core/src/error-catalog.ts`, add after the `RP0004` line:
```ts
  { code: 'RP0005', domain: 'reports', httpStatus: 400, message: 'report is PDF-only and has no tabular data' },
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @openldr/reporting exec vitest run src/catalog.test.ts` — PASS.
Run: `pnpm --filter @openldr/core exec vitest run src/error-catalog.test.ts` — PASS.
Run: `pnpm --filter @openldr/reporting exec tsc --noEmit` and `pnpm --filter @openldr/core exec tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/types.ts packages/reporting/src/catalog.ts packages/reporting/src/catalog.test.ts packages/core/src/error-catalog.ts packages/core/src/error-catalog.test.ts
git commit -m "feat(reporting,core): ReportSummary.source + RP0005 pdf-only code"
```

---

## Task 2: Template-aware reporting service (`listAll` + branches)

**Files:**
- Modify: `packages/bootstrap/src/index.ts`
- Test: `packages/bootstrap/src/reporting-templates.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/reporting-templates.test.ts`. Because the full `buildContext` is heavy, test the reporting-service *shape* by extracting a pure factory is overkill — instead test through a thin unit: the plan implements the template branches as small helpers you CAN unit-test. Add helper functions to `index.ts` (exported) and test them:

```ts
import { describe, it, expect } from 'vitest';
import { templateToSummary, isPublished } from './index';

const tpl = { id: 'rt-1', name: 'Custom AMR', description: 'd', category: 'amr', status: 'published', parameters: [{ id: 'from', label: 'From', type: 'daterange', required: false }], rows: [] } as never;

describe('reporting template helpers', () => {
  it('maps a template to a builder-source ReportSummary', () => {
    const s = templateToSummary(tpl);
    expect(s).toMatchObject({ id: 'rt-1', name: 'Custom AMR', category: 'amr', source: 'builder' });
    expect(s.parameters).toHaveLength(1);
  });
  it('isPublished only accepts published status', () => {
    expect(isPublished({ status: 'published' } as never)).toBe(true);
    expect(isPublished({ status: 'draft' } as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/reporting-templates.test.ts`
Expected: FAIL — `templateToSummary`/`isPublished` not exported.

- [ ] **Step 3: Implement the helpers + wire the service**

In `packages/bootstrap/src/index.ts`:

1. Add imports (with the existing `@openldr/report-builder` store import): `import { renderReportTemplatePdf } from '@openldr/report-builder';` and the template type `import type { ReportTemplate } from '@openldr/report-builder/pure';`. Ensure `appError` from `@openldr/core` is imported (it is used elsewhere; add if missing).

2. Add exported helpers near the top-level (module scope):
```ts
export function isPublished(t: { status: string }): boolean { return t.status === 'published'; }
export function templateToSummary(t: ReportTemplate): ReportSummary {
  return { id: t.id, name: t.name, description: t.description, category: t.category, parameters: t.parameters, source: 'builder' };
}
```
(`ReportSummary` is already imported in `index.ts`.)

3. Add `listAll` to the `ReportingApi` interface (after `list()`):
```ts
  listAll(): Promise<ReportSummary[]>;
  findSummary(id: string): Promise<ReportSummary | undefined>;
```

4. In the `reporting` object, add the new methods and template branches. Note `reportTemplateStore` and `runDashboardQuery` are `const`s declared just below `reporting`; the method closures run at request time (after those consts initialize), so referencing them is safe — do NOT reorder the file. Add:
```ts
    async listAll() {
      const templates = (await reportTemplateStore.list()).filter(isPublished).map(templateToSummary);
      return [...reportSummaries(), ...templates];
    },
    async findSummary(id) {
      const cat = reportSummaries().find((s) => s.id === id);
      if (cat) return cat;
      const t = await reportTemplateStore.get(id);
      return t && isPublished(t) ? templateToSummary(t) : undefined;
    },
```
And modify `renderPdf`, `run` (via `runReport`), and `options` to branch:
```ts
    async renderPdf(id, rawParams) {
      const t = await reportTemplateStore.get(id);
      if (t && isPublished(t)) return renderReportTemplatePdf(t, (rawParams ?? {}) as Record<string, string>, runDashboardQuery);
      // …existing catalog path (runReport + renderReportPdf) unchanged…
    },
    async options(id) {
      if (await reportTemplateStore.get(id)) return {};
      // …existing catalog options path…
    },
```
For `run`: wrap `runReport` at the service boundary — change the `run: runReport` entry to:
```ts
    async run(id, rawParams) {
      if (await reportTemplateStore.get(id)) throw appError('RP0005', { message: `report is PDF-only: ${id}` });
      return runReport(id, rawParams);
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/reporting-templates.test.ts` — PASS.
Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/reporting-templates.test.ts
git commit -m "feat(bootstrap): template-aware reporting service (listAll + pdf/run/options branches)"
```

---

## Task 3: Server routes use the merged list + existence

**Files:**
- Modify: `apps/server/src/reports-routes.ts`
- Test: `apps/server/src/reports-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

The route test uses `appWith({ reporting })` with a mock. Add tests (extend the mock reporting with `listAll`/`findSummary`):
```ts
it('GET /api/reports lists via listAll (includes custom templates)', async () => {
  const app = appWith({
    listAll: async () => [{ id: 'amr', name: 'AMR', description: 'd', source: 'catalog' }, { id: 'rt-1', name: 'Custom', description: 'c', source: 'builder' }],
    run: vi.fn(),
  });
  const res = await app.inject({ method: 'GET', url: '/api/reports' });
  expect(res.statusCode).toBe(200);
  expect(res.json().map((r: { id: string }) => r.id)).toContain('rt-1');
});

it('records a run beacon for a template id (existence via findSummary)', async () => {
  const record = vi.fn(async () => {});
  const app = appWith2({ // helper that also wires ctx.reportRuns — see note
    reporting: { findSummary: async (id: string) => (id === 'rt-1' ? { id: 'rt-1', name: 'Custom', source: 'builder' } : undefined), list: () => [] },
    reportRuns: { record },
  });
  const res = await app.inject({ method: 'POST', url: '/api/reports/rt-1/runs', payload: { format: 'pdf' } });
  expect(res.statusCode).toBe(201);
  expect(record).toHaveBeenCalled();
});
```
NOTE: the existing test's `appWith` only wires `reporting`. For the beacon test you need `ctx.reportRuns`. Add a small `appWith2({ reporting, reportRuns })` helper in the test file (mirror `appWith` but merge more ctx fields), or extend `appWith` to accept a full ctx object. Read the existing test to match its style.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @openldr/server exec vitest run src/reports-routes.test.ts`
Expected: FAIL — `/api/reports` still calls `list()` (mock has no `list` returning rt-1), and the beacon existence uses `ctx.reporting.list()` (sync) so a template id 404s.

- [ ] **Step 3: Update the routes**

In `apps/server/src/reports-routes.ts`:
- `GET /api/reports`: change `async () => ctx.reporting.list()` to `async () => ctx.reporting.listAll()`.
- Run-history beacon (`POST /api/reports/:id/runs`): replace `const def = ctx.reporting.list().find((r) => r.id === id);` with:
```ts
    const def = await ctx.reporting.findSummary(id);
    if (!def) throw appError('RP0002', { message: `report not found: ${id}` });
```
  (and use `def.name` for `reportName` as before).
- Schedule-create (`POST /api/reports/:id/schedules`): replace `if (!ctx.reporting.list().find((r) => r.id === id))` with `if (!(await ctx.reporting.findSummary(id)))`.
- Leave `/:id.pdf` (uses `renderPdf` — now template-aware) and `/:id`/`.csv` (their `run` now throws RP0005 for templates) unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @openldr/server exec vitest run src/reports-routes.test.ts`
Expected: PASS (new + existing — the existing `/api/reports` list test may need its mock updated to provide `listAll`; update those mocks to add `listAll: async () => [...]` returning the same data as the old `list`).
Run: `pnpm --filter @openldr/server exec tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/reports-routes.ts apps/server/src/reports-routes.test.ts
git commit -m "feat(server): reports routes list templates via listAll + template-aware existence"
```

---

## Task 4: Reports page — Custom badge + PDF-only branch

**Files:**
- Modify: `apps/studio/src/reports/ReportLibrary.tsx` (badge)
- Modify: the reports page orchestrator + tabs + `ScheduleDialog.tsx` (PDF-only for custom)
- Test: the matching `.test.tsx` files

- [ ] **Step 1: READ the reports UI**

Read `apps/studio/src/reports/ReportLibrary.tsx`, the reports page orchestrator (find it: `apps/studio/src/pages/Reports.tsx` or wherever `ReportLibrary`/`ReportDocumentTab`/`ReportSpreadsheetTab` are composed), `ReportDocumentTab.tsx` (PDF view), `ReportSpreadsheetTab.tsx` (tabular), `ReportActionsMenu.tsx`, `ScheduleDialog.tsx`, and the `ReportSummary` type in `apps/studio/src/api.ts` (add `source?: 'catalog' | 'builder'` there to mirror the server type if not already present).

- [ ] **Step 2: Failing test — badge + PDF-only**

`ReportLibrary.test.tsx`: a report with `source: 'builder'` renders a "Custom" badge; a `'catalog'` (or absent) one does not:
```tsx
it('shows a Custom badge for builder-source reports', () => {
  render(<ReportLibrary reports={[{ id: 'rt-1', name: 'Custom', description: 'c', category: 'amr', parameters: [], source: 'builder' }]} /* + the component's other required props: selectedId/onSelect/etc — match the file */ />);
  expect(screen.getByText(/custom/i)).toBeInTheDocument();
});
```
Reports-orchestrator/tab test: for a selected custom report, the spreadsheet/CSV/xlsx affordances are NOT rendered and the PDF/Document view IS. (Write against the actual orchestrator: assert the Spreadsheet tab / CSV button is absent and the Document/Preview PDF present for a `source:'builder'` selection.)
`ScheduleDialog.test.tsx`: when the report is custom (pass a `source`/`pdfOnly` prop), only the PDF format option is offered.

- [ ] **Step 3: Implement**

- `apps/studio/src/api.ts`: add `source?: 'catalog' | 'builder';` to the `ReportSummary`/`ReportParamMeta`-bearing summary interface if missing.
- `ReportLibrary.tsx`: when `report.source === 'builder'`, render a small "Custom" badge (reuse an existing badge style in the file / a shadcn `Badge` if present).
- Reports orchestrator: derive `const isCustom = selectedReport?.source === 'builder';`. When `isCustom`: render only the Document (PDF) tab/panel — Preview PDF (via `PdfCanvasViewer` fed by `/api/reports/:id.pdf` with the param bar values) + Download PDF + Schedule; DO NOT render the Spreadsheet tab, CSV, or xlsx actions. Keep the params bar (`ReportParametersBar`) — templates have params. Catalog reports unchanged.
- `ReportActionsMenu.tsx`: hide CSV/xlsx items when the report is custom (pass an `isCustom`/`pdfOnly` prop).
- `ScheduleDialog.tsx`: accept a `pdfOnly` prop; when true, lock `outputFormat` to `pdf` and hide the other format choices.

Use `t()` for any NEW user-facing strings (the "Custom" badge label → add `reports.custom` or `reportBuilder`-adjacent key to en/fr/pt; keep en value 'Custom' so tests match, and add fr/pt). If you add an i18n key, update en/fr/pt together (parity).

- [ ] **Step 4: Verify**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports src/i18n`
Expected: all green (new custom-report tests + existing reports tests + parity if you touched i18n).
Run: `pnpm --filter @openldr/studio exec tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports apps/studio/src/api.ts apps/studio/src/i18n
git commit -m "feat(studio): reports library shows custom templates with a PDF-only experience + Custom badge"
```

---

## Task 5: Full gate — forced typecheck + suites

- [ ] **Step 1: Forced cross-package typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: all 31 packages pass (the `ReportSummary.source` change ripples to every consumer — reporting, bootstrap, server, studio, plugin-broker; `source` is optional so it's additive).

- [ ] **Step 2: Run affected suites**

Run:
```bash
pnpm --filter @openldr/reporting exec vitest run
pnpm --filter @openldr/core exec vitest run src/error-catalog.test.ts
pnpm --filter @openldr/bootstrap exec vitest run src/reporting-templates.test.ts
pnpm --filter @openldr/server exec vitest run src/reports-routes.test.ts
pnpm --filter @openldr/studio exec vitest run src/reports src/i18n
```
Expected: all green. (The pre-existing `apps/studio/src/api.test.ts` vitest-dedupe flake is a different path.)

- [ ] **Step 3: Final commit (only if lint/format touch-ups were needed)**

```bash
git add -A
git commit -m "chore(report-builder): P4 library coexistence gate green"
```

---

## Self-Review Notes (verify during execution)

- **Spec coverage:** `source` + RP0005 (Task 1) · `listAll`/`renderPdf`/`run`/`options`/`findSummary` template-aware (Task 2) · routes list+existence (Task 3) · page custom branch (badge + PDF-only actions + PDF-locked schedule) (Task 4). All spec sections covered.
- **Sync `list()` untouched:** only `listAll()`/`findSummary()` added to `ReportingApi`; the plugin-broker's sync `reports.list` path is unchanged (Task 2).
- **Published-only:** `isPublished` filter in `listAll`/`findSummary`/`renderPdf` (a draft template id 404s / isn't listed).
- **PDF-only enforced server-side:** `run` throws `RP0005` for template ids, so `/:id` + `.csv` fail loudly even if the client ignores the badge (Task 2/3).
- **Reuse:** `renderReportTemplatePdf(t, params, runDashboardQuery)` is the exact call `report-templates-routes.ts` preview uses — reused in `reporting.renderPdf`, not reinvented.
- **Type consistency:** `source: 'catalog' | 'builder'` identical across reporting `ReportSummary`, bootstrap `templateToSummary`, and studio `api.ts`; `findSummary`/`listAll` return `ReportSummary`.
- **Out of scope:** tabular/CSV/xlsx for templates (impossible), template select-option resolution (`options`→`{}`), sync-list-async.
- **Cross-package:** reporting + core + bootstrap + server + studio — forced typecheck (Task 5) is the guard.
```
