# Forms Corlix-Parity — SP-D (Live Preview Pane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Add the Corlix live Preview pane (right pane) reusing `FormRuntime`, with Fill example / Reset and per-field warning markers.

**Branch:** `feat/forms-corlix-sp-a`. Keep `@openldr/web` typecheck+build green after each task. Scope cmds with `-C "D:/Projects/Repositories/openldr_ce/.worktrees/forms-corlix-sp-a"`; commit `-c commit.gpgsign=false`; ensure `git status --short` clean after each commit. Spec: `docs/superpowers/specs/2026-06-19-forms-corlix-builder-sp-d-design.md`.

**Model/helpers (`@openldr/forms/pure`):** `FormSchema`, `FormField`, `FieldType`, `lintFormSchema`, `FormLintIssue`. Runtime: `apps/web/src/forms-runtime/FormRuntime.tsx` (props: schema, submitLabel, onSubmit, footer; owns `answers` state via `useState({})`), `runtime.ts` (`visibleIds`, `validate`, `fieldLabel`), `types.ts` (`RuntimeAnswers`).

---

## Task 1: FormRuntime preview hooks + example answers

**Files:** Modify `apps/web/src/forms-runtime/FormRuntime.tsx` (+ test); create `apps/web/src/forms-runtime/example.ts` (+ `example.test.ts`).

- [ ] **Step 1: Tests.** `example.test.ts`: `makeExampleAnswers(schema)` returns, for a schema with a required `text` field 'name', a `number` field 'age', a `boolean` 'ok', and a `select` with options, an answers object with a string for name, a number for age, `true` for ok, and the first option's code for the select (only for enabled fields). Extend `FormRuntime.test.tsx`: passing `initialAnswers={{ name:'X' }}` pre-fills the 'name' input; passing `fieldWarnings={{ name:'error' }}` renders a marker (e.g. an element with title/aria containing 'error' or a '!' near the field).
- [ ] **Step 2:** Run → FAIL: `pnpm -C "…" --filter @openldr/web test example FormRuntime`
- [ ] **Step 3:** Implement `example.ts` `makeExampleAnswers(schema: FormSchema): RuntimeAnswers` — for each enabled field, a plausible value by `fieldType`: text/phone/email/identifier/address→'Example'; number→1; boolean→true; date→'2026-01-01'; datetime→'2026-01-01T00:00'; select→first `valueSetOptions?.[0]?.code`; multiselect→`[first code]`; reference/facility/organism/antibiogram→'example'; others omitted. Extend `FormRuntime` props with optional `initialAnswers?: RuntimeAnswers` (`useState(initialAnswers ?? {})`) and `fieldWarnings?: Record<string, 'error'|'warning'>` (render a small marker next to each field whose id is in the map; error → destructive '!', warning → amber '?'), and make `submitLabel` optional (default '' ) since preview passes `footer={null}`.
- [ ] **Step 4:** Run → PASS; `pnpm -C "…" --filter @openldr/web typecheck` clean.
- [ ] **Step 5: Commit** `git -C "…" add -A apps/web/src/forms-runtime && git -C "…" -c commit.gpgsign=false commit -m "feat(web): form runtime preview hooks + example answers"`

---

## Task 2: PreviewPane

**Files:** Create `apps/web/src/forms-builder/PreviewPane.tsx` (+ `PreviewPane.test.tsx`).

- [ ] **Step 1: Test.** Render `<PreviewPane schema={schema} />` (schema with a required text field 'Patient name' and a `select` field with options). Assert: a "Preview" header; the field renders (label 'Patient name'); clicking **Fill example** populates the inputs (e.g. the text input now has a value); clicking **Reset** clears them; when `lintFormSchema(schema)` would flag a field (e.g. a `select` with no options → choice-missing-options), a per-field warning marker shows in the preview.
- [ ] **Step 2:** Run → FAIL: `pnpm -C "…" --filter @openldr/web test PreviewPane`
- [ ] **Step 3:** Implement `PreviewPane.tsx` (props `{ schema: FormSchema }`): a header row ("Preview" + Fill example + Reset buttons); local state `answers` + a `remountKey` number; "Fill example" sets `answers = makeExampleAnswers(schema)` and bumps `remountKey`; "Reset" sets `answers = {}` and bumps key. Compute `fieldWarnings` from `lintFormSchema(schema)` (map each issue's `fieldId` → its `severity`). Render `<FormRuntime key={remountKey} schema={schema} footer={null} onSubmit={() => {}} initialAnswers={answers} fieldWarnings={fieldWarnings} />` inside a scroll container.
- [ ] **Step 4:** Run → PASS; typecheck clean.
- [ ] **Step 5: Commit** `git -C "…" add -A apps/web/src/forms-builder/PreviewPane.tsx apps/web/src/forms-builder/PreviewPane.test.tsx && git -C "…" -c commit.gpgsign=false commit -m "feat(web): builder live preview pane"`

---

## Task 3: Wire Preview into the page + gates

**Files:** Modify `apps/web/src/forms-builder/FormBuilderPage.tsx` (+ test).

- [ ] **Step 1: Test.** The page renders a two-pane body: the field-list pane AND the `PreviewPane` (assert a "Preview" header is present). Keep existing add/select(sheet)/save/publish/compare assertions.
- [ ] **Step 2:** Run → FAIL: `pnpm -C "…" --filter @openldr/web test FormBuilderPage`
- [ ] **Step 3:** In `FormBuilderPage.tsx`, lay out the body as two columns: left `<FieldListPane …>`, right `<PreviewPane schema={schema} />`. The `<FieldEditorSheet>` (SP-C) stays as the slide-out overlay (rendered at page level, opens on select). Header stays on top.
- [ ] **Step 4: Gates:** `pnpm -C "…" --filter @openldr/web test` ALL pass; `pnpm -C "…" --filter @openldr/web typecheck` clean; `pnpm -C "…" --filter @openldr/web build` succeeds; `pnpm -C "…" depcruise` clean.
- [ ] **Step 5: Commit** `git -C "…" add -A apps/web/src/forms-builder && git -C "…" -c commit.gpgsign=false commit -m "feat(web): add live preview pane to builder"`

---

## Done Criteria (SP-D)
- [ ] Right pane shows a live Preview of the form (all 17 types via FormRuntime).
- [ ] Fill example populates plausible answers; Reset clears.
- [ ] Per-field warning markers from lint show in the preview.
- [ ] `@openldr/web` typecheck+build+tests green; depcruise clean.
- [ ] Deferred: section/group editing + translation tabs (SP-E), lifecycle gating (SP-F), and the field-list drag-all bug (end-of-run fix).
