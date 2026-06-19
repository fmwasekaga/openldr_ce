# Forms Corlix-Parity — SP-E (Sections & Groups Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Add section CRUD (SectionsManager) and grouped field-list rendering (section headers + group-child nesting) to the builder.

**Branch:** `feat/forms-corlix-sp-a`. Keep `@openldr/web` typecheck+build green after each task. Scope cmds with `-C "D:/Projects/Repositories/openldr_ce/.worktrees/forms-corlix-sp-a"`; commit `-c commit.gpgsign=false`; `git status --short` clean after each commit. Spec: `docs/superpowers/specs/2026-06-19-forms-corlix-builder-sp-e-design.md`.

**Model (`@openldr/forms/pure`):** `FormSchema { fields: FormField[]; sections: FormSection[] }`; `FormSection { id: string; label: string; order: number; fhirResourceType?: string; visibility? }`; `FormField { id, displayLabel, fieldType, section?, groupId?, order, enabled, ... }`. shadcn `@/components/ui/*` (input, button, dropdown-menu) exist.

---

## Task 1: SectionsManager

**Files:** Create `apps/web/src/forms-builder/SectionsManager.tsx` (+ `SectionsManager.test.tsx`).

- [ ] **Step 1: Test.** Render `<SectionsManager sections={[{id:'main',label:'Main',order:0}]} onChange={spy} onFieldsClearSection={spy2} />`. Assert:
  - the 'Main' section renders with an editable label; editing it → `onChange([{...,label:'<typed>'}])`.
  - "Add section" appends a new section (`onChange` with 2 sections; new one has a generated id, label like 'Section 2', next `order`).
  - delete on 'Main' → `onChange([])` AND `onFieldsClearSection('main')` (so the page can clear `field.section` for fields in it).
  - move-up/move-down (or reorder) updates `order` (assert `onChange` with swapped order). (Buttons are fine; no DnD needed.)
- [ ] **Step 2:** Run → FAIL: `pnpm -C "…" --filter @openldr/web test SectionsManager`
- [ ] **Step 3:** Implement `SectionsManager.tsx` (props `{ sections: FormSection[]; onChange: (s: FormSection[]) => void; onFieldsClearSection: (sectionId: string) => void }`): a list of section rows (label `Input`, move up/down buttons, delete button) + an "Add section" button. Generate ids via a slug of the label or `section-${n}`; keep `order` contiguous. Mirror Corlix `SortableSectionListRow` styling (no DnD required — up/down buttons).
- [ ] **Step 4:** Run → PASS; `pnpm -C "…" --filter @openldr/web typecheck` clean.
- [ ] **Step 5: Commit** `git -C "…" add -A apps/web/src/forms-builder/SectionsManager.tsx apps/web/src/forms-builder/SectionsManager.test.tsx && git -C "…" -c commit.gpgsign=false commit -m "feat(web): builder sections manager"`

---

## Task 2: Grouped field list + wire into page + gates

**Files:** Modify `apps/web/src/forms-builder/FieldListPane.tsx` (+ test); modify `apps/web/src/forms-builder/FormBuilderPage.tsx` (+ test).

- [ ] **Step 1: Tests.**
  - `FieldListPane.test.tsx` (extend): with fields across sections 'main' and 'extra' (+ one with no section) and a `group`-type field with a child (`groupId`), assert: a section header renders per distinct section (+ a "No section" header when applicable); the group's child field is rendered nested/indented under the group field (e.g. the child row has a data attribute or extra padding class indicating nesting, OR appears immediately after its group). Keep existing counter/search/section-filter/reorder tests.
  - `FormBuilderPage.test.tsx` (extend): `SectionsManager` is present (e.g. an "Add section" button); clicking it adds a section and the field-list shows the new section header (or the section appears in the Sections dropdown).
- [ ] **Step 2:** Run → FAIL: `pnpm -C "…" --filter @openldr/web test FieldListPane FormBuilderPage`
- [ ] **Step 3:** Implement:
  - `FieldListPane.tsx`: group the (filtered, order-sorted) fields by `section` (distinct sections in `order`, then "No section"); render a header per group; within a group, render top-level fields and indent fields whose `groupId` matches a group field in the list (render group children right after their group, with an indent class). Keep the DnD `SortableContext` over the visible field ids (do not regress reorder).
  - `FormBuilderPage.tsx`: mount `<SectionsManager sections={schema.sections} onChange={(sections)=>patchSchemaWithHistory({sections})} onFieldsClearSection={(id)=>setFieldsSectionCleared(id)} />` (place it above/within the field-list column). `onFieldsClearSection` maps over `schema.fields` setting `section: undefined` where it equals the deleted id (with history).
- [ ] **Step 4: Gates:** `pnpm -C "…" --filter @openldr/web test` ALL pass; `pnpm -C "…" --filter @openldr/web typecheck` clean; `pnpm -C "…" --filter @openldr/web build` succeeds; `pnpm -C "…" depcruise` clean.
- [ ] **Step 5: Commit** `git -C "…" add -A apps/web/src/forms-builder && git -C "…" -c commit.gpgsign=false commit -m "feat(web): grouped field list + sections in builder"`

---

## Done Criteria (SP-E)
- [ ] Sections can be added/renamed/deleted/reordered; deleting clears its fields' `section`.
- [ ] Field-list renders section headers and nests group children.
- [ ] `@openldr/web` typecheck+build+tests green; depcruise clean.
- [ ] Deferred: lifecycle gating (SP-F); field-list drag-all bug (end-of-run fix).
