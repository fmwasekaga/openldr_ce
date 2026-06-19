# Forms Corlix-Parity — SP-B (Builder Shell + Header + Field-List) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the OpenLDR CE form builder's three-pane shell, header controls (FHIR Version / Target pages / Resource Type / language), and left field-list pane (sortable field cards) on top of SP-A's Corlix flat model — a faithful port of Corlix's builder shell.

**Architecture:** Decompose the builder into focused components (`BuilderHeader`, `LanguageControl`, `FieldListPane`, `SortableFieldRow`) composed by `FormBuilderPage`. All edits mutate an in-memory `FormSchema` (flat `fields[]` with `order`/`section`/`enabled`). Reuse SP-A's `useTemplateHistory`, `useBuilderKeyboard`, `LintSummary`, `CompareDialog`, and the web API client. The Edit Field sheet (SP-C) and live Preview (SP-D) are deferred — SP-B keeps SP-A's minimal inline properties panel in the right region so the page stays usable.

**Tech Stack:** React/Vite, TypeScript, Vitest + Testing Library, shadcn/Radix primitives, `@dnd-kit/core` + `@dnd-kit/sortable`, `@openldr/forms/pure`.

**References (read-only, copy exactly):**
- Builder shell/header/field-row: `D:/Projects/Repositories/corlix/apps/desktop/src/renderer/pages/FormBuilderPage.tsx` (page shell, header bar, `SortableFieldRow`, `SortableSectionListRow`).
- Spec: `docs/superpowers/specs/2026-06-19-forms-corlix-builder-sp-b-design.md`.
- Model + helpers (import from `@openldr/forms/pure`): `FormSchema`, `FormField`, `FieldType`, `lintFormSchema`, `FormLintIssue`, `validateTemplateTargets`, `PAGE_TARGETS`, `normalizeFormSchema`, `diffFormSchemas`.

**Defaults (from spec open questions):** right pane keeps SP-A's minimal inline properties (page stays usable); Resource Type / FHIR Version option lists are copied from Corlix's builder verbatim.

**Branch:** continue on `feat/forms-corlix-sp-a` (SP-B builds on SP-A). Keep `@openldr/web` typecheck + build green after every task.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/web/src/forms-builder/BuilderHeader.tsx` (+ test) | Form Name/Version inputs; FHIR Version / Target pages / Resource Type selects; language control mount; lifecycle ⋯ menu; lint banner |
| `apps/web/src/forms-builder/LanguageControl.tsx` (+ test) | globe popover to add/remove `languages[]` |
| `apps/web/src/forms-builder/SortableFieldRow.tsx` (+ test) | one field card: drag handle, enabled checkbox, label + required asterisk, fhirPath subtitle, type badge, section badge, lint marker, per-row ⋯ menu |
| `apps/web/src/forms-builder/FieldListPane.tsx` (+ test) | "N fields (N enabled)" counter, search, Sections dropdown, DnD list of `SortableFieldRow` |
| `apps/web/src/forms-builder/FormBuilderPage.tsx` (+ test) | three-pane shell composing header + field-list + minimal inline properties (right) |
| reuse: `builderModel.ts`, `useTemplateHistory.ts`, `useBuilderKeyboard.ts`, `LintSummary.tsx`, `CompareDialog.tsx` | from SP-A |

After each task: `pnpm -C <worktree> --filter @openldr/web typecheck` clean (the builder must keep compiling; other components may be placeholder-wired). DnD interactions are button-driven in unit tests; drag is covered by e2e later (SP-D/E).

---

## Task 1: Builder Header — Form-Level Controls

**Files:** Create `apps/web/src/forms-builder/BuilderHeader.tsx` (+ `BuilderHeader.test.tsx`).

- [ ] **Step 1: Write the failing test** (`BuilderHeader.test.tsx`): render `BuilderHeader` with a `FormSchema` (new model) and spy callbacks `onChange(patch: Partial<FormSchema>)`, `onSave`, `onPublish`, `onCompare`. Assert:
  - editing the Form Name input calls `onChange({ name })`; Version input calls `onChange({ versionLabel })`.
  - the FHIR Version `Select` lists Corlix's versions (at least `R4`) and selecting one calls `onChange({ fhirVersion })`.
  - the Resource Type `Select` selecting a value calls `onChange({ fhirResourceType })`.
  - the Target pages control toggling `users` calls `onChange({ targetPages: [...] })` including `users` (options come from `PAGE_TARGETS`).
  - a `LintSummary` banner renders when `issues` is non-empty.
  - the lifecycle ⋯ (aria-label "Builder actions") menu exposes Save/Publish/Compare items wired to the callbacks (mirror SP-A's kebab; menu items per spec: Add field, Save, Publish, Compare, Archive, Export, Close, Disable, Delete — Save/Publish/Compare wired now, others may be present-but-stub with TODO comments to be wired in SP-F).
- [ ] **Step 2:** Run `pnpm -C "D:/Projects/Repositories/openldr_ce/.worktrees/forms-corlix-sp-a" --filter @openldr/web test BuilderHeader` → FAIL.
- [ ] **Step 3:** Implement `BuilderHeader.tsx` — props `{ schema: FormSchema; issues: FormLintIssue[]; onChange: (p: Partial<FormSchema>) => void; onSave; onPublish; onCompare; onAddField; canPublish: boolean; languageSlot?: React.ReactNode }`. Use shadcn `Input`/`Select`/`DropdownMenu`/`Badge`. FHIR Version + Resource Type option lists copied from Corlix's builder. Target pages: a small popover/dropdown of `PAGE_TARGETS` checkboxes (build a simple inline multiselect — no new primitive needed). Render `<LanguageControl ... />` via `languageSlot` (mounted by the page in Task 2) or inline. Render `<LintSummary issues={issues} />`.
- [ ] **Step 4:** Run the test → PASS. Then `pnpm -C "…" --filter @openldr/web typecheck` clean.
- [ ] **Step 5: Commit** `git -C "…" add apps/web/src/forms-builder/BuilderHeader.tsx apps/web/src/forms-builder/BuilderHeader.test.tsx && git -C "…" -c commit.gpgsign=false commit -m "feat(web): builder header with fhir/target/resource controls"`

---

## Task 2: Language Control

**Files:** Create `apps/web/src/forms-builder/LanguageControl.tsx` (+ test).

- [ ] **Step 1: Test** — render `LanguageControl` with `languages={['fr']}` and `onChange`. Assert: it shows the current languages; opening the globe popover and adding `pt` calls `onChange(['fr','pt'])`; removing `fr` calls `onChange([...])` without `fr`. (Languages are ISO-639-1 codes excluding the base; copy Corlix's add/remove UX.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement using shadcn `Popover` + a small language picker (a curated ISO-639-1 list copied from Corlix). Props `{ languages: string[]; onChange: (langs: string[]) => void }`.
- [ ] **Step 4:** Test → PASS; typecheck clean.
- [ ] **Step 5: Commit** `…-m "feat(web): builder language control"`

---

## Task 3: Sortable Field Row (field card)

**Files:** Create `apps/web/src/forms-builder/SortableFieldRow.tsx` (+ test).

- [ ] **Step 1: Test** — render a `SortableFieldRow` (inside a `DndContext`+`SortableContext` test wrapper) for a `FormField` with `required:true`, `fieldType:'select'`, `section:'main'`, `fhirPath:'name'`. Assert it shows: the displayLabel, a required asterisk, the fhirPath subtitle, a type badge ("select"), a section badge ("main"), an enabled checkbox (toggling calls `onToggleEnabled`), a select button (calls `onSelect`), and a per-row ⋯ menu (aria-label `Actions for <label>`) with Duplicate / Required toggle / Delete (calling `onDuplicate`/`onToggleRequired`/`onDelete`). If `lintIssueForField` is set, a lint marker (! or ?) shows.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `@dnd-kit/sortable` `useSortable` (mirror SP-A's deleted `FieldRow` + Corlix's `SortableFieldRow`). Props `{ field: FormField; selected: boolean; lintIssue?: FormLintIssue; onSelect; onToggleEnabled; onToggleRequired; onDuplicate; onDelete }`.
- [ ] **Step 4:** Test → PASS; typecheck clean.
- [ ] **Step 5: Commit** `…-m "feat(web): sortable field card for builder"`

---

## Task 4: Field-List Pane

**Files:** Create `apps/web/src/forms-builder/FieldListPane.tsx` (+ test).

- [ ] **Step 1: Test** — render `FieldListPane` with a schema of 3 fields (2 enabled), `onReorder`/`onSelect`/etc. Assert: the "3 fields (2 enabled)" counter; typing in the search filters cards by label/fhirPath; the "Sections (n)" dropdown lists distinct `field.section` values and selecting one filters to that section; the field cards render; a drag-end (simulate via the `onReorder(activeId, overId)` callback) reorders. (DnD wiring tested via the callback; real drag is e2e.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: counter from `fields.length` / `fields.filter(f=>f.enabled).length`; search `Input`; Sections `DropdownMenu`/`Select` over distinct sections; `DndContext` + `SortableContext` (verticalListSortingStrategy) over filtered fields rendering `SortableFieldRow`; `onReorder` reorders by updating `order`.
- [ ] **Step 4:** Test → PASS; typecheck clean.
- [ ] **Step 5: Commit** `…-m "feat(web): builder field-list pane"`

---

## Task 5: Compose the Three-Pane Page

**Files:** Modify `apps/web/src/forms-builder/FormBuilderPage.tsx` (+ test).

- [ ] **Step 1: Update the page test** (`FormBuilderPage.test.tsx`) to the three-pane shell: header present (Form name input); add a field via the header ⋯ "Add field" → a card appears in the field-list pane; select the card → the minimal inline properties (right) shows it; edit its Display Label; toggle enabled; delete; Save draft (via header ⋯) calls `createForm`/`updateForm`. Keep `publishes/compares` behavior (header ⋯ Publish → `publishForm`; Compare → `CompareDialog`).
- [ ] **Step 2:** Run `pnpm -C "…" --filter @openldr/web test FormBuilderPage` → FAIL.
- [ ] **Step 3:** Implement `FormBuilderPage` as a three-pane grid: `<BuilderHeader>` (top, with `<LanguageControl>` mounted), `<FieldListPane>` (left/center), and the SP-A minimal inline properties (right) for the selected field. Wire state to a single `FormSchema`, reusing `useTemplateHistory`/`useBuilderKeyboard`; compute `issues = lintFormSchema(schema)`; `canPublish = issues.every(i=>i.severity!=='error')`. Header actions call the existing web API client. Keep `CompareDialog`.
- [ ] **Step 4:** Get green: `pnpm -C "…" --filter @openldr/web test FormBuilderPage BuilderHeader FieldListPane SortableFieldRow LanguageControl` PASS; `pnpm -C "…" --filter @openldr/web typecheck` clean; `pnpm -C "…" --filter @openldr/web build` succeeds.
- [ ] **Step 5: Commit** `…-m "feat(web): compose three-pane corlix builder shell"`

---

## Task 6: Full Gates

- [ ] **Step 1:** `pnpm -C "…" --filter @openldr/web test` ALL pass.
- [ ] **Step 2:** `pnpm turbo typecheck build --filter=@openldr/web` clean + build succeeds.
- [ ] **Step 3:** `pnpm depcruise` no violations.
- [ ] **Step 4: Commit** any fixups `…-m "chore(web): SP-B builder gate fixups"` (skip if none).

---

## Done Criteria (SP-B)

- [ ] Three-pane builder shell renders on the new model.
- [ ] Header edits Form Name/Version + FHIR Version + Target pages (forms/users/facilities) + Resource Type + languages, and exposes the lifecycle ⋯ menu (Save/Publish/Compare wired).
- [ ] Field-list pane: counter, search, Sections dropdown, sortable field cards (drag/enable/label/required/fhirPath/type+section badges/⋯), reorder + undo/redo.
- [ ] Lint banner surfaces target-contract + field issues.
- [ ] `@openldr/web` typecheck + build + tests green; depcruise clean.
- [ ] Deferred: Edit Field sheet (SP-C), live Preview (SP-D), section/group editing + translation tabs (SP-E), lifecycle gating/archive/export polish (SP-F).
