# Report Designer — Persistence Design Spec

**Date:** 2026-07-08
**Status:** Design approved; implementation not started
**Builds on:** the completed looks-first shell + interactive canvas + editable properties + finish-the-editor slices (`714547f1`). This is the first **backend** slice — templates now persist.
**Reference pattern:** report-builder persistence — `@openldr/report-builder` (`store.ts`, `/pure` `schema.ts`) + `packages/db` `report_templates` table + `packages/bootstrap` wiring + `apps/server/src/report-templates-routes.ts` + `apps/studio/src/api.ts` + `packages/cli/src/report-template.ts`.

---

## 1. Purpose

The Report Designer edits an in-memory `MOCK_TEMPLATES` array that vanishes on refresh; Save/Delete are `noop`. This slice makes designs **durable**: a real store + CRUD API, seeded defaults, a `/report-designer/:id` deep-link route, and wired Save/New/Delete. Editing stays local (undo/redo local); **Save is explicit** (mirrors the existing Save button + report-builder). No data-binding/export/preview yet.

The persisted entity is a **report design** (`ReportDesign`) — renamed from the studio-internal `ReportTemplate` to disambiguate from report-builder's `ReportTemplate`. It is a **separate** resource from report-builder's report templates (different model, different table, different routes).

---

## 2. New package `@openldr/report-designer`

Mirrors `@openldr/report-builder`. `packages/report-designer/`:

- **`src/pure.ts`** (exported as `@openldr/report-designer/pure`) — the model, **moved out of** `apps/studio/src/report-designer/types.ts`:
  - Types: `ElementKind`, `Paper`, `Orientation`, `TextAlign`, `Rect`, `ElementStyle`, `Margins`, `DesignElement`, `DesignPage`, `TemplateParam`, and **`ReportDesign`** (was `ReportTemplate`), plus `createdAt?`/`updatedAt?`.
  - **`ReportDesignSchema`** (Zod) validating the whole shape (elements' optional `style`/`src`/`text`/`columns`/`rows`/`boundReport`; page `margins`; string `parameters`). Lenient enough to round-trip what the editor produces; unknown-key-stripping.
- **`src/store.ts`** — `createReportDesignStore(db: Kysely<InternalSchema>): ReportDesignStore` with `list/get/create/update/remove`, `toRow`/`fromRow` (JSON columns), idempotent `create` (`onConflict … doNothing`), Zod-parse on read. Copy report-builder's `store.ts` structure.
- **`src/seed.ts`** — `seedReportDesigns(store)`: the three former `MOCK_TEMPLATES` (AMR summary, Monthly caseload, Lab TAT) as seed rows, created idempotently (skip if present). Returns a count.
- **`src/index.ts`** — re-export store + seed (+ types via a barrel); `package.json` exports map (`.` and `./pure`) mirroring `@openldr/report-builder`.

The studio module keeps `model.ts` / `geometry.ts` / `mockTemplates.ts` etc., but they now **import types from `@openldr/report-designer/pure`** (the `ReportTemplate` → `ReportDesign` rename ripples through the studio `report-designer/*` files — mechanical). `mockTemplates.ts`'s `MOCK_TEMPLATES` moves into the package's seed (studio no longer seeds local state from it; see §6). Studio's local `api.ts` type mirrors (if any) reference the package.

---

## 3. Database (`@openldr/db`)

- Add a **`report_designs`** table to `InternalSchema` (typed) mirroring `report_templates`: `id` (pk, text), `name` (text), `paper` (text), `orientation` (text), `pages` (json/text), `parameters` (json/text), `margins` (json/text, nullable), `created_at`, `updated_at` (timestamps with defaults).
- Add a **migration** creating it (follow the existing `report_templates` migration; both Postgres internal DB and any SQLite dev path the repo already supports).

---

## 4. Bootstrap (`packages/bootstrap`)

- `AppContext` gains `reportDesigns: ReportDesignStore`.
- Construct `const reportDesignStore = createReportDesignStore(internal.db);` and expose it on `ctx`.
- **Seed** on first run: call `seedReportDesigns(reportDesignStore)` in the seed path (`seed.ts`), alongside the existing report-template/dashboard seeds.

---

## 5. Server routes (`apps/server`)

New `src/report-designs-routes.ts`, registered in `app.ts` (mirror `report-templates-routes.ts`, minus the SQL authoring gate — the designer has no SQL):

- `GET  /api/report-designs` → `ctx.reportDesigns.list()`
- `GET  /api/report-designs/:id` → get or 404
- `POST /api/report-designs` (`requireRole('lab_admin','lab_manager')`) → Zod parse (400 on fail) → `create` → audit `report-design.create` → 201
- `PUT  /api/report-designs/:id` (MANAGE) → Zod parse → 404 if missing → `update` → audit `report-design.update`
- `DELETE /api/report-designs/:id` (MANAGE) → 404 if missing → `remove` → audit `report-design.delete` → 204

Audit rows: `entityType: 'report-design'`, before/after per the report-template routes.

---

## 6. Studio (`apps/studio`)

**`api.ts`** — client fns, all through **`authFetch`** (bare `fetch` → 401 under Keycloak; dev-bypass masks it):
`listReportDesigns()`, `getReportDesign(id)`, `createReportDesign(d)`, `updateReportDesign(id, d)`, `deleteReportDesign(id)`. Types from `@openldr/report-designer/pure` (or the studio mirror, kept in sync).

**Routing (`App.tsx`)** — add `/report-designer/:id` alongside `/report-designer`, both role-gated `lab_admin`/`lab_manager` (matches the routes). `/report-designer/new` optional (or transient-id in state).

**`ReportDesignerPage.tsx`** — replace `MOCK_TEMPLATES` local seeding with the store:
- **Load list** on mount (`listReportDesigns`) → the Templates explorer shows persisted designs (metadata: name + `paper · orientation · pages`). Loading/error states (thin inline, per house style).
- **Open**: clicking a template in the explorer navigates to `/report-designer/:id`; the `:id` effect loads the full design (`getReportDesign`) into editor state (`templates`/`selectedId` become the single open design + the list). (Keep the current in-editor `template` shape; the explorer list is separate metadata.)
- **New**: `newTemplate` creates a transient (unsaved) design in state with a fresh id; on first **Save** → `createReportDesign` → navigate to `/report-designer/:id` (mirrors `ReportBuilderPage`). New-designer canvas starts from the empty template as today.
- **Save** (kebab, was `noop`): if the open design is transient → `createReportDesign`; else `updateReportDesign`. On success: refresh the list, show a success toast (sonner, already in studio), keep editing. Errors → inline/toast.
- **Delete** (kebab, was `noop`): confirm via the shared `ConfirmDialog`/`AlertDialog` → `deleteReportDesign` → navigate to `/report-designer`, refresh list.
- Undo/redo, interactive canvas, and property editing are unchanged — they mutate the open design in local state; Save serializes the current local design to the API.

The explorer's existing "New template" (now in the kebab) and card list keep their look; only the data source changes (API instead of mock).

---

## 7. CLI (`packages/cli`)

New `src/report-design.ts` (mirror `report-template.ts`), for operator parity ([[cli-operator-parity]]): at minimum `openldr report-design list` (id · name · paper · orientation · pages), sharing logic via `@openldr/bootstrap`'s `ctx.reportDesigns`. `get`/`delete` optional. Register in the CLI entry.

---

## 8. Explicitly out of scope (fast-follows)

- **Autosave** / dirty-state indicator (explicit Save this pass).
- Design **versioning**, folders/**categories**, duplicate-to-new.
- Real **data binding** (tables → connectors/params), **PDF/Excel export**, the **Preview modal** — future slices; the package is where their code will live.
- Multi-user concurrency / optimistic-locking on Save.
- Migrating the deferred `status`/`description` concepts from report-builder (designs have none yet).

---

## 9. Testing

- **Package pure:** `ReportDesignSchema` round-trips a full design (with style/margins/all element kinds); rejects a malformed one; strips unknown keys.
- **Package store:** `create`/`get`/`list`/`update`/`remove` against an in-memory/SQLite `InternalSchema` (mirror `report-builder/src/store.test.ts`); idempotent create; `fromRow` JSON parse.
- **Seed:** `seedReportDesigns` inserts the 3 defaults; idempotent on a second run.
- **Server routes:** CRUD happy-path + 404 + 400 (bad body) + RBAC (403 without role) + audit rows written (mirror `report-templates-routes.test.ts`).
- **Studio:** `api.ts` calls hit the right URLs via `authFetch` (mirror `api.reportTemplates.test.ts`); `ReportDesignerPage` — list loads into the explorer, opening `/:id` loads a design, Save calls create/update, Delete calls delete + navigates. Mock the api module.
- **DB migration** applies cleanly; **bootstrap** seed runs once.
- **CLI:** `report-design list` prints seeded rows.
- i18n: any new strings (save/delete toasts, load errors) get en/fr/pt with `EnShape` parity.
- Gate: `pnpm --filter @openldr/studio test` + `pnpm --filter @openldr/report-designer test` + `pnpm --filter @openldr/server test` + typechecks; ignore the known `api.test.ts` flake.

---

## 10. Reference

- Persistence pattern to copy end-to-end: `@openldr/report-builder` `src/store.ts` + `src/schema.ts`; `apps/server/src/report-templates-routes.ts`(+`.test`); `apps/studio/src/api.ts` report-template fns (+`api.reportTemplates.test.ts`); `packages/bootstrap/src/index.ts` + `seed.ts`; `packages/cli/src/report-template.ts`; the `report_templates` table + migration in `@openldr/db`; `ReportBuilderPage.tsx` for the New→Save→navigate + Delete flow.
- Designer model to move/rename: `apps/studio/src/report-designer/types.ts` (+ `mockTemplates.ts` for the seed).
