# Reporting Layer + Dashboard SPA — Design Spec

**PRD mapping:** §8 build-sequence step 6 — P1-REP-1 (multi-driver reporting via Kysely over the external DB), P1-REP-2 (Metabase-style dashboard, reimplementing the Corlix design), P1-REP-3 (all reports through the query abstraction; raw SQL flagged + isolated). Stands up the React+Vite SPA shell (P1-UI-1) as the dashboard host. CLI report commands (P1-CLI-1/2).

**Status:** Approved design (2026-06-13). One combined sub-project (reporting backend + dashboard SPA).

---

## 1. Key decisions (locked during brainstorming)

1. **Combined sub-project** — the `@openldr/reporting` query layer AND the React dashboard SPA in one spec→plan→build cycle.
2. **Curated, parameterized report definitions** — a fixed typed catalog (NOT a generic Metabase-style query builder). Each report is a Kysely query builder over the flat tables taking validated params.
3. **Four reports** — `amr-resistance`, `test-volume`, `patient-demographics`, `turnaround-time`.
4. **Unauthenticated, single-deployable** — `apps/server` serves the built SPA as static assets + exposes the report API; no login flow yet (the reverse proxy owns the trust boundary, P1-NFR-7; real OIDC login lands with the users/audit sub-project).
5. **Reimplement the Corlix design system** (dark-mode-native, steelblue accent, borders-not-shadows) — design + architecture only; no Corlix source copied (PRD §10).

## 2. Architecture & topology

```
                         apps/web (React+Vite SPA, Corlix theme)
                                  │  fetch /api/reports/...
apps/server (Fastify) ── /api/reports route ──▶ reporting context (bootstrap)
                                  │
                @openldr/reporting (catalog of ReportDefinition)
                                  │  run(db, params)
                Kysely<ExternalSchema>  ◀── injected by bootstrap from createDbStore
                                  │
                external/analytics DB (flat tables: patients, specimens,
                service_requests, diagnostic_reports, observations, organizations, locations)
```

- **`@openldr/reporting`** (fills the placeholder): imports only `@openldr/db` (`ExternalSchema` + Kysely types) and `@openldr/core` (`Logger`, `errorMessage`). **No adapter import** (DP-1; bootstrap injects the external Kysely). Exposes a report catalog.
- **`@openldr/bootstrap`**: a `createReportingContext(cfg)` (or extend an existing context) wiring `createDbStore` → `Kysely<ExternalSchema>` + the reporting catalog; exposes `listReports()` / `runReport(id, params)`.
- **`apps/server`**: report API routes.
- **`apps/web`** (NEW): the SPA, served static by the server in prod.
- **`@openldr/cli`**: `report list` / `report run`.

All report queries go through Kysely (P1-REP-3). Any raw SQL is the documented exception — isolated in a clearly-named helper and flagged in a comment; of the four reports only `turnaround-time` needs one (the date-diff cast).

## 3. Reporting layer (`@openldr/reporting`)

### 3.1 Types

```ts
export type ChartHint =
  | { type: 'bar'; x: string; y: string; series?: string }
  | { type: 'line'; x: string; y: string; series?: string }
  | { type: 'pie'; label: string; value: string }
  | { type: 'stat'; value: string; label: string };

export interface ReportColumn { key: string; label: string; kind: 'string' | 'number' | 'percent' | 'date' }
export interface ReportResult { columns: ReportColumn[]; rows: Record<string, unknown>[]; chart: ChartHint; meta: { generatedAt: string; rowCount: number } }

export interface ReportDefinition<P = unknown> {
  id: string;
  name: string;
  description: string;
  params: ZodType<P>;             // validated before run
  run(db: Kysely<ExternalSchema>, params: P): Promise<Omit<ReportResult, 'meta'>>;
}

export function reportCatalog(): ReportDefinition[];      // the 4 below
export function getReport(id: string): ReportDefinition | undefined;
```

`generatedAt` is stamped by the caller (server/CLI) — `run` stays free of clock access so it is deterministically testable.

### 3.2 The four reports (over columns the flat schema actually exposes)

- **`amr-resistance`** — `observations` where `interpretation_code in ('S','I','R')`, grouped by `code_text` (antibiotic). Computes tested / R / I / S counts and `%R`. Params: `{ from?, to? (effective_date_time), facility?, organism? }`. Facility filters via `subject_ref → patients.managing_organization`; organism filters to specimens whose organism observation matches. Chart: `bar` (x=antibiotic, y=percentR).
- **`test-volume`** — count `service_requests` grouped by `code_text` and month bucket of `authored_on`; optional facility. Params: `{ from?, to?, facility?, groupBy?: 'test'|'month' (default 'month') }`. Chart: `line` (x=month, y=count, series=test) or `bar`.
- **`patient-demographics`** — `patients` count by `gender` and age band derived from `birth_date` (bands: 0–4, 5–14, 15–24, 25–49, 50+, unknown). Params: `{ facility? }`. Chart: `pie` (label=band, value=count); gender as a series toggle in the table.
- **`turnaround-time`** — per `diagnostic_reports`, hours from the linked `specimens.received_time` to `diagnostic_reports.issued`; aggregate count + avg by `code_text` (test) or facility. Params: `{ from?, to?, facility?, by?: 'test'|'facility' }`. Chart: `stat` (overall avg hours) + table. **Flagged portability:** the flat date columns are nullable strings; the date-diff cast is an isolated `sql` fragment (the single raw-SQL exception, commented). **Median is intentionally avoided** — `percentile_cont` is Postgres-specific and would break the multi-driver goal; we report portable `avg` (and `count`/`min`/`max`). If a median is wanted later it is computed in JS from returned rows, not in SQL.

### 3.3 Error posture
Invalid params → the caller returns 400 (zod parse throws, caught at the boundary). A query failure throws → caller returns 500 + structured log; the process never crashes. Empty result set → `rows: []` (not an error). The external DB being unreachable surfaces as a 503 from the report endpoint (degraded) while the server stays up.

## 4. Server API (`apps/server`)

- `GET /api/reports` → `[{ id, name, description, params: <json-schema-ish> }]`.
- `GET /api/reports/:id?from=&to=&facility=&...` → `ReportResult` JSON (params parsed via the report's zod schema; 400 on invalid; 404 unknown id).
- `GET /api/reports/:id.csv?...` → `text/csv` of columns+rows (same params).
- Static: in production the server serves `apps/web/dist` (SPA fallback to `index.html` for client routes); `/api/*` and `/health` take precedence. In dev the SPA runs on the Vite dev server proxying `/api` → server.

## 5. CLI (`@openldr/cli`)

- `openldr report list [--json]` — the catalog.
- `openldr report run <id> [--param key=value ...] [--json|--csv]` — runs via the reporting context; human table by default, `--json` / `--csv` for machine output. Unknown id → exit 1 with message. (P1-CLI-1/2.)

## 6. Dashboard SPA (`apps/web`)

**Stack:** React + Vite + TypeScript, React Router, **Recharts**, design tokens as CSS custom properties (no heavy UI kit). Vitest + Testing Library for component tests.

**Corlix design system (reimplemented as tokens; dark-mode-native + light toggle):**
- Surfaces: page `#171717`, sidebar `#1a1a1a`, card `#1e1e1e` (light: `#ffffff` / `#fafafa` / `#ffffff`). Depth via border hierarchy (`#2e2e2e` → `#363636`; light `#e4e4e7` → `#d4d4d8`) — **no box-shadows** except focus rings (`0 0 0 2px rgba(70,130,180,0.5)`).
- Brand steelblue `#4682B4`, link `#5A9BD6`, used sparingly (logo, active nav, links, accent borders). Active nav item: `rgba(70,130,180,0.15)` bg + `#5A9BD6` text.
- Semantic: success `#22c55e`, warning `#f59e0b`, danger `#ef4444`, info steelblue — used for AST interpretation (R=danger, I=warning, S=success) and status badges.
- Typography: Inter / system stack, 14px base, headings weight ≤600 (no 700), monospace for IDs/timestamps. Radii: 4px inputs, 6px buttons/sidebar items, 8px cards, 9999px primary CTAs + badges. Spacing base 4px; content padding 24px.

**Shell & screens** (layout: sidebar 240px collapsible→64px + top navbar 48px + 24px content):
- **App shell** — sidebar: OpenLDR wordmark; nav items Dashboard, Reports (Forms / Users / Audit shown disabled for later sub-projects); bottom: theme toggle + user placeholder. Top navbar: page title/breadcrumb.
- **Dashboard overview** (`/`) — a global filter bar (date range, facility) + a responsive grid of 4 report cards; each card fetches `/api/reports/:id` and renders its compact chart with loading/empty/error states.
- **Report detail** (`/reports/:id`) — a param bar (date range, facility, organism where relevant, + Export menu → CSV/JSON hitting the `.csv`/JSON endpoints), the chart, then the data table. A single reusable `<ReportView>` renders any report from its `ChartHint` + columns/rows, so all four share it.
- A small typed `api` client wraps `fetch('/api/...')`.

## 7. Testing & acceptance

**Unit (hermetic):**
- reporting: each report's `params` zod schema (valid/invalid); pure shaping helpers (age-band bucketing, %R computation) where extracted.
- SPA: `<ReportView>` renders bar/line/pie/stat + table from canned `ReportResult`; dashboard grid renders 4 cards; shell renders nav + theme toggle. (Vitest + Testing Library, jsdom.)
- server: report routes via Fastify `inject` against a fake reporting context (200 shape, 400 invalid params, 404 unknown, 503 when the context throws a connection error).

**Integration (docker):**
- Seed/ingest the WHONET sample (from sub-project 5) into the external DB, then `GET /api/reports/amr-resistance` returns the expected %R per antibiotic; `test-volume` and `demographics` return non-empty; `turnaround-time` runs without error (may be sparse). `report run amr-resistance --json` matches. Build `apps/web` and confirm the server serves `index.html` + assets at `/`.

**Final gate:** `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` (now including `apps/web` build) green; depcruise confirms `@openldr/reporting` imports no `adapter-*`.

## 8. Done criteria (maps to PRD §5.6)

- [ ] `@openldr/reporting` multi-driver Kysely layer over the external flat tables; the 4 curated reports; all via the query abstraction, raw SQL isolated+flagged (P1-REP-1/3).
- [ ] Report API (`/api/reports`, `/api/reports/:id`, `.csv`) + CLI `report list|run --json` (P1-CLI-1/2).
- [ ] React+Vite dashboard SPA (P1-UI-1 shell) reimplementing the Corlix design system, served by `apps/server`; overview grid + report detail over the 4 reports (P1-REP-2).
- [ ] DP-1 intact (reporting imports no adapter; bootstrap injects the external Kysely); graceful degradation on external-DB failure; server never crashes on a report error.
- [ ] Workspace gate green incl. `apps/web` build; live docker acceptance shows AMR %R from the ingested WHONET data.

## 9. Out of scope (deferred)

- Authentication / OIDC login flow (users/audit sub-project).
- Generic ad-hoc query builder, saved/custom reports, scheduled report emails.
- The forms-driven capture screens (P1-FORM-2), users (P1-USER), audit (P1-AUD) surfaces — the shell stubs their nav entries as disabled.
- Playwright E2E + visual-verification harness (§8 step 9).
- PDF report export (Corlix has a `report-pdf` package; CE can add later).
