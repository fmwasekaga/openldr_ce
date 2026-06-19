# Forms Corlix-Parity — SP-F (Lifecycle Parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Wire the builder's Archive / Disable / Delete / Export lifecycle actions and enforce the per-target-page publish contract.

**Branch:** `feat/forms-corlix-sp-a`. Keep `@openldr/web` (+ `@openldr/forms` if touched) typecheck+build green after each task. Scope cmds with `-C "D:/Projects/Repositories/openldr_ce/.worktrees/forms-corlix-sp-a"`; commit `-c commit.gpgsign=false`; `git status --short` clean after each commit. Spec: `docs/superpowers/specs/2026-06-19-forms-corlix-builder-sp-f-design.md`.

**API client (`apps/web/src/api.ts`):** `setFormStatus(id, status)`, `deleteForm(id)`, `publishForm(id, {versionLabel})`, `formQuestionnaireUrl(id)`. Lint: `lintFormSchema(schema)` (`@openldr/forms/pure`) emits `FormLintIssue` incl. code `target-contract-violation`. shadcn `@/components/ui/*` incl. `ConfirmDialog` (`@/components/ui/confirm-dialog`) and `DropdownMenu` exist.

---

## Task 1: Lifecycle actions in BuilderHeader + publish gating

**Files:** Modify `apps/web/src/forms-builder/BuilderHeader.tsx` (+ test). Optionally `packages/forms/src/lint.ts` (+ test) if the target-contract severity needs to be `error`.

- [ ] **Step 1: Verify lint severity.** Read `packages/forms/src/lint.ts`: confirm the `target-contract-violation` issue has `severity: 'error'`. If it is `warning`, change it to `error` and update `lint.test.ts` to assert `severity:'error'` (run `pnpm -C "…" --filter @openldr/forms test lint` green).
- [ ] **Step 2: Test (BuilderHeader).** Extend `BuilderHeader.test.tsx`: open the ⋯ 'Builder actions' menu and assert items Archive / Disable / Delete / Export call `onArchive`/`onDisable`/`onDelete`/`onExport` respectively; these four items are DISABLED when a new `formId` prop is undefined/null; Publish item is disabled when `canPublish` is false. Use the existing Radix-menu open pattern.
- [ ] **Step 3:** Run → FAIL: `pnpm -C "…" --filter @openldr/web test BuilderHeader`
- [ ] **Step 4: Implement.** Add props `formId: string | null; onArchive: () => void; onDisable: () => void; onDelete: () => void; onExport: () => void` to `BuilderHeader`. Wire the menu items (currently stubbed `/* TODO SP-F */`): Archive/Disable/Delete/Export call the callbacks; set each `disabled={!formId}`. Keep Publish `disabled={!canPublish}` and Save/Compare/Add field as-is. (Export may be a simple item or a small submenu "Questionnaire (FHIR)"; a single item calling `onExport` is sufficient.)
- [ ] **Step 5:** Run → PASS; `pnpm -C "…" --filter @openldr/web typecheck` clean.
- [ ] **Step 6: Commit** `git -C "…" add -A apps/web/src/forms-builder/BuilderHeader.tsx apps/web/src/forms-builder/BuilderHeader.test.tsx packages/forms/src/lint.ts packages/forms/src/lint.test.ts && git -C "…" -c commit.gpgsign=false commit -m "feat(web): wire builder lifecycle menu + publish gating"` (omit the forms paths from `add` if you didn't change lint).

---

## Task 2: Wire handlers in the page + gates

**Files:** Modify `apps/web/src/forms-builder/FormBuilderPage.tsx` (+ test).

- [ ] **Step 1: Test (FormBuilderPage).** Extend the test: mock the api client. Assert: opening ⋯ → Archive calls `setFormStatus(formId, 'archived')` (load an existing form via `/forms/:id/builder` so `formId` is set, or save first); ⋯ → Delete opens a confirm, confirming calls `deleteForm(formId)` and navigates to `/forms`; ⋯ → Export triggers the questionnaire download (assert an anchor/href to `formQuestionnaireUrl(formId)` is used, or that a download is initiated — you may stub `formQuestionnaireUrl`); when the schema has a target-contract lint error (e.g. `targetPages:['users']` but no field with `apiProperty:'email'`), Publish is disabled. Keep prior add/select/save/publish/compare/preview/sections assertions.
- [ ] **Step 2:** Run → FAIL: `pnpm -C "…" --filter @openldr/web test FormBuilderPage`
- [ ] **Step 3: Implement.** In `FormBuilderPage.tsx`: pass `formId` + the four handlers to `BuilderHeader`. Implement: `archive` → `await setFormStatus(formId, 'archived')` (update local status); `disable` → `await setFormStatus(formId, 'archived')` OR toggle `active` (pick `setFormStatus(formId,'archived')` if no active endpoint — keep it simple and note it); `del` → open a `ConfirmDialog`; on confirm `await deleteForm(formId)` then `navigate('/forms')`; `exportForm` → trigger a download of `formQuestionnaireUrl(formId)` (e.g. create a temporary anchor with `href=formQuestionnaireUrl(formId)` + `download`, or `window.open`). Ensure `canPublish` passed to the header is `!lintFormSchema(schema).some(i => i.severity === 'error')` (already computed — confirm target-contract errors are included).
- [ ] **Step 4: Gates:** `pnpm -C "…" --filter @openldr/web test` ALL pass; `pnpm -C "…" --filter @openldr/web typecheck` clean; `pnpm -C "…" --filter @openldr/web build` succeeds; `pnpm -C "…" depcruise` clean.
- [ ] **Step 5: Commit** `git -C "…" add -A apps/web/src/forms-builder && git -C "…" -c commit.gpgsign=false commit -m "feat(web): wire builder archive/delete/export handlers"`

---

## Done Criteria (SP-F)
- [ ] Archive / Disable / Delete (confirm + navigate) / Export menu actions work; disabled when the form is unsaved.
- [ ] Publish is blocked while any lint error (incl. target-contract violation) exists, with the reason shown in the banner.
- [ ] `@openldr/web` (+ `@openldr/forms`) typecheck+build+tests green; depcruise clean.
- [ ] After SP-F: only the field-list drag-all bug remains (end-of-run fix), then the branch is ready to merge to `main`.
