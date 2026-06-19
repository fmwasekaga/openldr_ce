# Forms Corlix-Parity — SP-C (Edit Field Slide-Out Sheet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Replace the builder's minimal inline properties with the Corlix "Edit Field" slide-out sheet (General / Options / Codes / Translations / Mapping / Visibility), editing the selected `FormField` with history.

**Architecture:** A `FieldEditorSheet` (shadcn `Sheet`) composes focused section components under `apps/web/src/forms-builder/field-editor/`. Each section gets the current `FormField` + an `onUpdate(patch: Partial<FormField>)` callback. `FormBuilderPage` opens the sheet when a field is selected and applies patches to the `FormSchema` (via `useTemplateHistory`).

**Tech Stack:** React/Vite, TS, Vitest + Testing Library, shadcn (`sheet`, `select`, `input`, `checkbox`, `button`, `badge`), `@openldr/forms/pure` types, terminology `TermPicker`.

**References (copy exactly):** Corlix `FieldEditor` in `D:/Projects/Repositories/corlix/apps/desktop/src/renderer/pages/FormBuilderPage.tsx` (~L541–1374); `corlix/.../components/VisibilityRuleEditor.tsx`. Spec: `docs/superpowers/specs/2026-06-19-forms-corlix-builder-sp-c-design.md`.

**Model (from `@openldr/forms/pure`):** `FormField` { id, displayLabel, description, fieldType, required, enabled, section?, groupId?, placeholder?, unit?, fhirPath:string|null, apiProperty?, observationExtract?, valueSetUrl?, bindingStrength?, valueSetOptions?:{code,display,translations?}[], code?:{system,code,display?}[], translations?:Record<locale,{label?,description?}>, constraints?:{min?,max?,maxLength?,decimalPlaces?}, referenceTarget?/referenceDisplayField?/referenceValueField?/referenceMultiple?/referenceSearchable?, repeatable?/minItems?/maxItems?, adminNote?, visibility?:{combinator:'all'|'any',conditions:{fieldId,operator,value?}[]} }; `FieldType`; `FormSchema` { fields, sections, languages? }.

**Branch:** `feat/forms-corlix-sp-a`. Keep `@openldr/web` typecheck+build green after every task. Scope all cmds with `-C "D:/Projects/Repositories/openldr_ce/.worktrees/forms-corlix-sp-a"` and commit with `git -C … -c commit.gpgsign=false`. Ensure `git status --short` clean after each commit.

---

## Task 1: FieldEditorSheet shell + General section

**Files:** Create `apps/web/src/forms-builder/FieldEditorSheet.tsx` (+ test).

- [ ] **Step 1: Test** — render `FieldEditorSheet` with a `FormField`, `allFields`, `sections`, and `onUpdate` spy, `open=true`. Assert: header shows "Edit Field" + the field's displayLabel; Display Label input edits → `onUpdate({displayLabel})`; Field Type `Select` change → `onUpdate({fieldType})`; Section `Select` (incl. "No section") → `onUpdate({section})`; Group `Select` over group-type fields (+ "No group") → `onUpdate({groupId})`; Placeholder → `onUpdate({placeholder})`; Unit → `onUpdate({unit})`; Required checkbox → `onUpdate({required})`; Enabled checkbox → `onUpdate({enabled})`; close (X / onOpenChange) calls `onOpenChange(false)`.
- [ ] **Step 2:** Run → FAIL: `pnpm -C "…" --filter @openldr/web test FieldEditorSheet`
- [ ] **Step 3:** Implement using shadcn `Sheet`/`SheetContent`. Props `{ field: FormField | null; allFields: FormField[]; sections: FormSchema['sections']; open: boolean; onOpenChange:(o:boolean)=>void; onUpdate:(p:Partial<FormField>)=>void }`. Render the **General** block (above controls). Section/Group selects derive options from `sections` and `allFields.filter(f=>f.fieldType==='group')`. Leave placeholder slots/comments for Options/Codes/Translations/Mapping/Visibility (added in Tasks 2–6). If `field` is null render nothing.
- [ ] **Step 4:** Run → PASS; `pnpm -C "…" --filter @openldr/web typecheck` clean.
- [ ] **Step 5: Commit** `…-m "feat(web): field editor sheet + general section"`

---

## Task 2: Options editor (select/multiselect)

**Files:** Create `apps/web/src/forms-builder/field-editor/OptionsEditor.tsx` (+ test); wire into `FieldEditorSheet` (render only when `field.fieldType` is `select`/`multiselect`).

- [ ] **Step 1: Test** — render `OptionsEditor` with a `select` field having `valueSetOptions:[{code:'a',display:'A'}]` + `onUpdate`. Assert: the row renders; editing code/display calls `onUpdate({valueSetOptions:[...]})`; "Add option" appends `{code:'',display:''}`; remove drops the row. (TermPicker "pull" may be present; not required to drive in this test.)
- [ ] **Step 2:** Run → FAIL: `pnpm -C "…" --filter @openldr/web test OptionsEditor`
- [ ] **Step 3:** Implement (port Corlix L832–910): editable rows for `valueSetOptions`, Add/remove, optional `TermPicker` to append `{code: term.code, display: term.displayName}`. Wire into `FieldEditorSheet` conditionally.
- [ ] **Step 4:** Run → PASS; typecheck clean (run `test OptionsEditor FieldEditorSheet`).
- [ ] **Step 5: Commit** `…-m "feat(web): field options editor"`

---

## Task 3: Codes editor (terminology anchors)

**Files:** Create `apps/web/src/forms-builder/field-editor/CodesEditor.tsx` (+ test); wire into sheet.

- [ ] **Step 1: Test** — render `CodesEditor` with `code:[{system:'http://loinc.org',code:'718-7',display:'Hgb'}]` + `onUpdate`. Assert: the code chip renders (system/code/display); removing it calls `onUpdate({code:[]})`; (adding via `TermPicker` appends a `FormFieldCoding` — assert the add handler shape, mocking TermPicker's onPick if needed).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: list `code[]` as chips with remove; a `TermPicker`/`ValueSetPicker` (from `@/terminology/...`) whose pick appends `{system, code, display}` to `code`. Wire into sheet.
- [ ] **Step 4:** Run → PASS; typecheck clean.
- [ ] **Step 5: Commit** `…-m "feat(web): field codes editor"`

---

## Task 4: Translations editor

**Files:** Create `apps/web/src/forms-builder/field-editor/TranslationsEditor.tsx` (+ test); wire into sheet.

- [ ] **Step 1: Test** — render with `field.translations={fr:{label:'Nom'}}`, `languages=['fr','pt']`, `onUpdate`. Assert: a label input per language; editing the 'pt' label calls `onUpdate({translations:{fr:{label:'Nom'}, pt:{label:'<typed>'}}})`. If `languages` is empty, show the "No translation languages yet. Add one with the language control in the form header." message.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: for each locale in `languages`, a label (and placeholder) input bound to `field.translations[locale]`; merge updates immutably.
- [ ] **Step 4:** Run → PASS; typecheck clean.
- [ ] **Step 5: Commit** `…-m "feat(web): field translations editor"`

---

## Task 5: Mapping editor (+ Advanced)

**Files:** Create `apps/web/src/forms-builder/field-editor/MappingEditor.tsx` (+ test); wire into sheet.

- [ ] **Step 1: Test** — render with a field + `onUpdate`. Assert: FHIR path input → `onUpdate({fhirPath})`; apiProperty input → `onUpdate({apiProperty})`; observationExtract checkbox → `onUpdate({observationExtract})`; valueSetUrl input → `onUpdate({valueSetUrl})`; bindingStrength Select → `onUpdate({bindingStrength})`. Advanced (collapsible): constraints min/max/maxLength/decimalPlaces numeric inputs → `onUpdate({constraints:{...}})`; adminNote textarea → `onUpdate({adminNote})`. (Reference/repetition fields present; assert at least referenceTarget input → `onUpdate({referenceTarget})`.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: a Mapping block (fhirPath/apiProperty/observationExtract/valueSetUrl/bindingStrength) + an Advanced collapsible (constraints, reference config for reference/facility types, repetition repeatable/minItems/maxItems, adminNote). Use plain shadcn inputs. Wire into sheet.
- [ ] **Step 4:** Run → PASS; typecheck clean.
- [ ] **Step 5: Commit** `…-m "feat(web): field mapping editor"`

---

## Task 6: Visibility rule editor

**Files:** Create `apps/web/src/forms-builder/field-editor/VisibilityRuleEditor.tsx` (+ test); wire into sheet.

- [ ] **Step 1: Test** — render with `allFields` (≥2 fields), a field with no visibility + `onUpdate`. Assert: a combinator Select (all/any); "Add condition" creates a condition; choosing a controlling field (Select over other field ids) + operator (Select: equals/notEquals/oneOf/isEmpty/isNotEmpty/gt/lt/gte/lte) + value input calls `onUpdate({visibility:{combinator,conditions:[{fieldId,operator,value}]}})`; removing the last condition clears visibility (`onUpdate({visibility: undefined})`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (port Corlix `VisibilityRuleEditor.tsx`): combinator + a list of condition rows (field Select excluding self, operator Select, value Input hidden for isEmpty/isNotEmpty), add/remove. Wire into sheet.
- [ ] **Step 4:** Run → PASS; typecheck clean.
- [ ] **Step 5: Commit** `…-m "feat(web): field visibility rule editor"`

---

## Task 7: Wire sheet into the page + gates

**Files:** Modify `apps/web/src/forms-builder/FormBuilderPage.tsx` (+ test).

- [ ] **Step 1: Update page test** — selecting a field in the field-list pane opens the `FieldEditorSheet` (header "Edit Field"); editing Display Label there updates the field card; closing the sheet keeps the field. Keep the existing add/save/publish/compare assertions.
- [ ] **Step 2:** Run → FAIL: `pnpm -C "…" --filter @openldr/web test FormBuilderPage`
- [ ] **Step 3:** Replace the right-pane minimal inline properties with `<FieldEditorSheet field={selectedField} allFields={schema.fields} sections={schema.sections} open={selectedId!==null} onOpenChange={(o)=>!o && setSelectedId(null)} onUpdate={(p)=>updateField(selectedId!, p)} />`. `updateField(id, patch)` maps over `schema.fields` applying the patch with history (`recordEdit`).
- [ ] **Step 4: Gates** — `pnpm -C "…" --filter @openldr/web test` ALL pass; `pnpm -C "…" --filter @openldr/web typecheck` clean; `pnpm -C "…" --filter @openldr/web build` succeeds; `pnpm depcruise` clean.
- [ ] **Step 5: Commit** `…-m "feat(web): open edit-field sheet from builder"`

---

## Done Criteria (SP-C)

- [ ] Selecting a field opens a slide-out "Edit Field" sheet (not hardcoded right pane).
- [ ] General/Options/Codes/Translations/Mapping/Visibility sections edit the field, each via `onUpdate` patches with undo/redo.
- [ ] `@openldr/web` typecheck+build+tests green; depcruise clean.
- [ ] Deferred: live Preview (SP-D), section/group create-manage + language tabs polish (SP-E), lifecycle gating (SP-F).
