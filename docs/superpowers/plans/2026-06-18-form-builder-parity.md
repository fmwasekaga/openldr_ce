# Form Builder Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full Corlix-style OpenLDR CE Form Builder slice, excluding marketplace, ending with version diff/compare.

**Architecture:** Add immutable form version snapshots under the existing forms store, then build original CE builder utilities and UI modules around `FormSchema`. The web builder uses a three-pane layout with reusable renderer/preview logic, pure lint/diff/history helpers, and Fastify lifecycle routes for save, publish, duplicate, versions, and compare inputs.

**Tech Stack:** TypeScript, React/Vite, Vitest, Fastify inject tests, Kysely migrations, Radix/shadcn primitives, lucide-react, `@dnd-kit/core`, `@dnd-kit/sortable`.

**Reference:** `docs/superpowers/specs/2026-06-18-form-builder-parity-design.md`

---

## Scope Check

This plan intentionally implements one large product slice because the approved design chose Option C. The plan still splits the work into reviewable commits with testable seams: database/versioning, pure forms helpers, API routes, shared renderer, builder shell, rich builder interactions, terminology/visibility/runtime parity, and diff/compare.

Marketplace form packages, install/update/drift, registry publishing, multi-user collaboration, and arbitrary FHIRPath evaluation are excluded.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/db/src/migrations/internal/019_form_versions.ts` | Create/drop immutable `form_versions` table |
| `packages/db/src/migrations/internal/019_form_versions.test.ts` | Migration regression test |
| `packages/db/src/migrations/internal/index.ts` | Register migration 019 |
| `packages/db/src/schema/internal.ts` | Kysely table types for `form_versions` and typed JSON columns |
| `packages/forms/src/lifecycle.ts` | Pure publish/version/content-change helpers |
| `packages/forms/src/lifecycle.test.ts` | Lifecycle helper tests |
| `packages/forms/src/diff.ts` | Deterministic form schema diff helpers |
| `packages/forms/src/diff.test.ts` | Diff helper tests |
| `packages/forms/src/lint.ts` | Pure template linting |
| `packages/forms/src/lint.test.ts` | Lint tests |
| `packages/forms/src/normalize.ts` | Backward-compatible schema normalization |
| `packages/forms/src/normalize.test.ts` | Normalization tests |
| `packages/forms/src/visibility.ts` | Upgrade simple visibility into normalized evaluator while preserving old API |
| `packages/forms/src/visibility.test.ts` | Visibility tests |
| `packages/forms/src/store.ts` | Version-aware store methods |
| `packages/forms/src/store.test.ts` | Store lifecycle tests |
| `packages/forms/src/index.ts` | Export new helpers/types |
| `apps/server/src/forms-routes.ts` | Publish/duplicate/version routes and audit calls |
| `apps/server/src/forms-routes.test.ts` | Route tests |
| `apps/web/src/api.ts` | Typed forms lifecycle client functions |
| `apps/web/src/api.forms.test.ts` | API client tests |
| `apps/web/src/forms-runtime/types.ts` | Runtime form value types shared by capture/preview |
| `apps/web/src/forms-runtime/FormRuntime.tsx` | Shared renderer used by capture and builder preview |
| `apps/web/src/forms-runtime/runtime.ts` | Shared client validation/visibility/answer cleanup |
| `apps/web/src/forms-runtime/FormRuntime.test.tsx` | Runtime rendering tests |
| `apps/web/src/pages/FormCapture.tsx` | Refactor to use shared runtime |
| `apps/web/src/forms-builder/useTemplateHistory.ts` | Undo/redo history hook |
| `apps/web/src/forms-builder/useTemplateHistory.test.ts` | History tests |
| `apps/web/src/forms-builder/useBuilderKeyboard.ts` | Builder-local shortcut hook |
| `apps/web/src/forms-builder/builderModel.ts` | Builder state helpers, ids, default form factory |
| `apps/web/src/forms-builder/builderModel.test.ts` | Builder model tests |
| `apps/web/src/forms-builder/FormBuilderPage.tsx` | Page composition and data flow |
| `apps/web/src/forms-builder/FormBuilderPage.test.tsx` | Page/component integration tests |
| `apps/web/src/forms-builder/FieldPalette.tsx` | Left pane field palette/search |
| `apps/web/src/forms-builder/BuilderCanvas.tsx` | Center pane sections/fields/DnD |
| `apps/web/src/forms-builder/FieldRow.tsx` | Sortable selectable field row |
| `apps/web/src/forms-builder/SectionRow.tsx` | Sortable section row |
| `apps/web/src/forms-builder/PropertiesSheet.tsx` | Right pane/sheet editor |
| `apps/web/src/forms-builder/VisibilityRuleEditor.tsx` | Field/section visibility editor |
| `apps/web/src/forms-builder/ValueSetBindingEditor.tsx` | ValueSet binding and option pulling |
| `apps/web/src/forms-builder/BulkActionBar.tsx` | Multi-select bulk actions |
| `apps/web/src/forms-builder/CompareDialog.tsx` | Version compare UI |
| `apps/web/src/forms-builder/LintSummary.tsx` | Lint banner and grouped issues |
| `apps/web/src/pages/Forms.tsx` | Enable builder actions |
| `apps/web/src/pages/Forms.test.tsx` | Forms list action tests |
| `apps/web/src/App.tsx` | Add builder routes before capture route |
| `apps/web/package.json` | Add DnD dependencies |
| `e2e/tests/forms-builder.spec.ts` | Browser create-to-compare smoke |

---

## Task 1: Migration And Types For Published Form Versions

**Files:**
- Create: `packages/db/src/migrations/internal/019_form_versions.ts`
- Create: `packages/db/src/migrations/internal/019_form_versions.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Write the failing migration test**

Add `packages/db/src/migrations/internal/019_form_versions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createMigratedInternalDb } from './test-helpers';

describe('019_form_versions migration', () => {
  it('creates immutable published form snapshot storage', async () => {
    const { db, destroy } = await createMigratedInternalDb();
    try {
      await db
        .insertInto('form_versions')
        .values({
          id: 'fv-1',
          form_id: 'form-1',
          version: 1,
          version_label: 'v1',
          name: 'Specimen intake',
          fhir_resource_type: 'Questionnaire',
          schema: JSON.stringify({ id: 'specimen-intake', sections: [] }) as never,
          target_pages: JSON.stringify(['forms']) as never,
          questionnaire: JSON.stringify({ resourceType: 'Questionnaire', status: 'active' }) as never,
          published_at: sql`now()` as never,
          published_by: 'system',
        } as never)
        .execute();

      const row = await db.selectFrom('form_versions').selectAll().where('form_id', '=', 'form-1').executeTakeFirstOrThrow();
      expect(row.version).toBe(1);
      expect(row.version_label).toBe('v1');
      expect(row.published_by).toBe('system');
    } finally {
      await destroy();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/db test 019_form_versions`

Expected: FAIL with an error that `form_versions` does not exist or the migration file is not registered.

- [ ] **Step 3: Create the migration**

Create `packages/db/src/migrations/internal/019_form_versions.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('form_versions')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('form_id', 'text', (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addColumn('version_label', 'text')
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('fhir_resource_type', 'text')
    .addColumn('schema', 'jsonb', (c) => c.notNull())
    .addColumn('target_pages', 'jsonb')
    .addColumn('questionnaire', 'jsonb', (c) => c.notNull())
    .addColumn('published_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('published_by', 'text')
    .execute();

  await db.schema
    .createIndex('form_versions_form_version')
    .ifNotExists()
    .on('form_versions')
    .columns(['form_id', 'version'])
    .unique()
    .execute();

  await db.schema
    .createIndex('form_versions_form_id')
    .ifNotExists()
    .on('form_versions')
    .column('form_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('form_versions').ifExists().execute();
}
```

- [ ] **Step 4: Register the migration**

Modify `packages/db/src/migrations/internal/index.ts`:

```ts
import * as m019 from './019_form_versions';
```

Add to `internalMigrations` after `018_snomed_code_system`:

```ts
'019_form_versions': { up: m019.up, down: m019.down },
```

- [ ] **Step 5: Add schema types**

Modify `packages/db/src/schema/internal.ts` by adding:

```ts
export interface FormVersionsTable {
  id: string;
  form_id: string;
  version: number;
  version_label: string | null;
  name: string;
  fhir_resource_type: string | null;
  schema: JSONColumnType<unknown>;
  target_pages: JSONColumnType<string[]> | null;
  questionnaire: JSONColumnType<Record<string, unknown>>;
  published_at: Generated<Date>;
  published_by: string | null;
}
```

Add to `InternalSchema`:

```ts
form_versions: FormVersionsTable;
```

- [ ] **Step 6: Run the migration test and typecheck**

Run: `pnpm --filter @openldr/db test 019_form_versions && pnpm --filter @openldr/db typecheck`

Expected: PASS for the migration test and clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/019_form_versions.ts packages/db/src/migrations/internal/019_form_versions.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git -c commit.gpgsign=false commit -m "feat(forms): add published form version storage"
```

---

## Task 2: Pure Lifecycle, Normalization, Lint, Visibility, And Diff Helpers

**Files:**
- Create: `packages/forms/src/lifecycle.ts`
- Create: `packages/forms/src/lifecycle.test.ts`
- Create: `packages/forms/src/normalize.ts`
- Create: `packages/forms/src/normalize.test.ts`
- Create: `packages/forms/src/lint.ts`
- Create: `packages/forms/src/lint.test.ts`
- Create: `packages/forms/src/diff.ts`
- Create: `packages/forms/src/diff.test.ts`
- Modify: `packages/forms/src/visibility.ts`
- Modify: `packages/forms/src/visibility.test.ts`
- Modify: `packages/forms/src/schema/form-schema.ts`
- Modify: `packages/forms/src/index.ts`

- [ ] **Step 1: Write lifecycle tests**

Create `packages/forms/src/lifecycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeNextFormVersion, formContentChanged, makeDuplicateName } from './lifecycle';
import type { FormDefinition } from './store';

const form = {
  id: 'form-1',
  name: 'Specimen intake',
  versionLabel: 'v1',
  fhirResourceType: 'Questionnaire',
  status: 'published',
  active: true,
  targetPages: ['forms'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  schema: {
    id: 'specimen-intake',
    name: 'Specimen intake',
    title: { en: 'Specimen intake' },
    status: 'active',
    languages: ['en'],
    sections: [{ id: 'main', title: { en: 'Main' }, fields: [] }],
  },
} satisfies FormDefinition;

describe('forms lifecycle helpers', () => {
  it('computes the next published version', () => {
    expect(computeNextFormVersion([])).toBe(1);
    expect(computeNextFormVersion([1, 3, 2])).toBe(4);
  });

  it('detects meaningful content changes', () => {
    expect(formContentChanged(form, { ...form, versionLabel: 'v2' })).toBe(false);
    expect(formContentChanged(form, { ...form, name: 'Specimen intake revised' })).toBe(true);
    expect(formContentChanged(form, { ...form, schema: { ...form.schema, title: { en: 'Revised' } } })).toBe(true);
  });

  it('builds duplicate names without mutating the original', () => {
    expect(makeDuplicateName('Specimen intake')).toBe('Specimen intake copy');
  });
});
```

- [ ] **Step 2: Run lifecycle tests to verify failure**

Run: `pnpm --filter @openldr/forms test lifecycle`

Expected: FAIL because `./lifecycle` does not exist.

- [ ] **Step 3: Implement lifecycle helpers**

Create `packages/forms/src/lifecycle.ts`:

```ts
import type { FormDefinition } from './store';

export function computeNextFormVersion(versions: number[]): number {
  return versions.reduce((max, version) => Math.max(max, version), 0) + 1;
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

export function formContentChanged(before: FormDefinition, after: FormDefinition): boolean {
  return before.name !== after.name ||
    before.fhirResourceType !== after.fhirResourceType ||
    stable(before.targetPages ?? null) !== stable(after.targetPages ?? null) ||
    stable(before.schema) !== stable(after.schema);
}

export function makeDuplicateName(name: string): string {
  return `${name} copy`;
}
```

- [ ] **Step 4: Write normalization tests**

Create `packages/forms/src/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeFormSchema } from './normalize';

describe('normalizeFormSchema', () => {
  it('adds missing languages and stable title from name', () => {
    const schema = normalizeFormSchema({ id: 'f', name: 'F', sections: [] });
    expect(schema).toMatchObject({
      id: 'f',
      name: 'F',
      title: { en: 'F' },
      status: 'active',
      languages: ['en'],
      sections: [],
    });
  });

  it('normalizes legacy visibility into current simple rule shape', () => {
    const schema = normalizeFormSchema({
      id: 'f',
      name: 'F',
      title: { en: 'F' },
      status: 'active',
      languages: ['en'],
      sections: [{
        id: 's',
        title: { en: 'S' },
        fields: [{ id: 'b', type: 'boolean', label: { en: 'B' } }, { id: 'x', type: 'string', label: { en: 'X' }, visibility: { whenField: 'b', equals: true } }],
      }],
    });
    expect(schema.sections[0].fields[1].visibility).toEqual({ whenField: 'b', equals: true });
  });
});
```

- [ ] **Step 5: Implement normalization**

Create `packages/forms/src/normalize.ts`:

```ts
import { FormSchema, type FormSchema as FormSchemaType } from './schema/form-schema';

function text(value: unknown, fallback: string): { en: string; fr?: string; pt?: string } {
  if (value && typeof value === 'object' && typeof (value as { en?: unknown }).en === 'string') {
    return value as { en: string; fr?: string; pt?: string };
  }
  return { en: fallback };
}

export function normalizeFormSchema(input: unknown): FormSchemaType {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Untitled form';
  const candidate = {
    ...raw,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    name,
    title: text(raw.title, name),
    status: raw.status === 'draft' || raw.status === 'retired' || raw.status === 'active' ? raw.status : 'active',
    languages: Array.isArray(raw.languages) && raw.languages.length > 0 ? raw.languages : ['en'],
    sections: Array.isArray(raw.sections) ? raw.sections : [],
  };
  return FormSchema.parse(candidate);
}
```

- [ ] **Step 6: Write lint tests**

Create `packages/forms/src/lint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lintFormSchema } from './lint';
import type { FormSchema } from './schema/form-schema';

const base: FormSchema = {
  id: 'f',
  name: 'F',
  title: { en: 'F' },
  status: 'active',
  languages: ['en'],
  sections: [{ id: 's', title: { en: 'S' }, fields: [{ id: 'a', type: 'string', label: { en: 'A' }, fhirPath: 'name.0.family' }] }],
};

describe('lintFormSchema', () => {
  it('reports duplicate field ids and duplicate fhir paths', () => {
    const form: FormSchema = {
      ...base,
      sections: [{ id: 's', title: { en: 'S' }, fields: [
        { id: 'a', type: 'string', label: { en: 'A' }, fhirPath: 'name.0.family' },
        { id: 'a', type: 'string', label: { en: 'A2' }, fhirPath: 'name.0.family' },
      ] }],
    };
    const issues = lintFormSchema(form);
    expect(issues.some((issue) => issue.code === 'duplicate_id')).toBe(true);
    expect(issues.some((issue) => issue.code === 'duplicate_fhir_path')).toBe(true);
  });

  it('blocks choice fields without options or value set binding', () => {
    const form: FormSchema = { ...base, sections: [{ id: 's', title: { en: 'S' }, fields: [{ id: 'choice', type: 'choice', label: { en: 'Choice' } as never }] }] };
    expect(lintFormSchema(form).some((issue) => issue.code === 'choice_without_options')).toBe(true);
  });

  it('reports visibility references to missing fields', () => {
    const form: FormSchema = { ...base, sections: [{ id: 's', title: { en: 'S' }, fields: [{ id: 'x', type: 'string', label: { en: 'X' }, visibility: { whenField: 'missing', equals: 'yes' } }] }] };
    expect(lintFormSchema(form).some((issue) => issue.code === 'dangling_visibility')).toBe(true);
  });
});
```

- [ ] **Step 7: Implement lint helper**

Create `packages/forms/src/lint.ts`:

```ts
import type { FormSchema, FormField } from './schema/form-schema';

export type LintSeverity = 'error' | 'warning';
export type LintCode =
  | 'duplicate_id'
  | 'duplicate_fhir_path'
  | 'choice_without_options'
  | 'observation_without_code'
  | 'invalid_cardinality'
  | 'dangling_visibility';

export interface LintIssue {
  severity: LintSeverity;
  code: LintCode;
  message: string;
  fieldId?: string;
  sectionId?: string;
}

function hasOptions(field: FormField): boolean {
  return Array.isArray(field.options) && field.options.length > 0;
}

export function lintFormSchema(form: FormSchema): LintIssue[] {
  const issues: LintIssue[] = [];
  const ids = new Set<string>();
  const fieldIds = new Set<string>();
  const fhirPaths = new Map<string, string>();

  for (const section of form.sections) {
    if (ids.has(section.id)) issues.push({ severity: 'error', code: 'duplicate_id', message: `Duplicate id ${section.id}`, sectionId: section.id });
    ids.add(section.id);
    for (const field of section.fields) {
      if (ids.has(field.id)) issues.push({ severity: 'error', code: 'duplicate_id', message: `Duplicate id ${field.id}`, fieldId: field.id });
      ids.add(field.id);
      fieldIds.add(field.id);
      if ((field.type === 'choice' || field.type === 'open-choice') && !hasOptions(field)) {
        issues.push({ severity: 'error', code: 'choice_without_options', message: `Choice field ${field.id} needs options`, fieldId: field.id });
      }
      if (field.observationExtract && !field.code) {
        issues.push({ severity: 'error', code: 'observation_without_code', message: `Observation field ${field.id} needs a code`, fieldId: field.id });
      }
      if (field.cardinality?.min !== undefined && field.cardinality?.max !== undefined && field.cardinality.min > field.cardinality.max) {
        issues.push({ severity: 'error', code: 'invalid_cardinality', message: `Field ${field.id} min cardinality exceeds max`, fieldId: field.id });
      }
      if (field.fhirPath) {
        const previous = fhirPaths.get(field.fhirPath);
        if (previous) issues.push({ severity: 'warning', code: 'duplicate_fhir_path', message: `FHIR path ${field.fhirPath} is also used by ${previous}`, fieldId: field.id });
        else fhirPaths.set(field.fhirPath, field.id);
      }
    }
  }

  for (const section of form.sections) {
    for (const field of section.fields) {
      if (field.visibility && !fieldIds.has(field.visibility.whenField)) {
        issues.push({ severity: 'warning', code: 'dangling_visibility', message: `Visibility references missing field ${field.visibility.whenField}`, fieldId: field.id });
      }
    }
  }
  return issues;
}
```

- [ ] **Step 8: Write diff tests**

Create `packages/forms/src/diff.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diffFormSchemas } from './diff';
import type { FormSchema } from './schema/form-schema';

const before: FormSchema = {
  id: 'f',
  name: 'F',
  title: { en: 'F' },
  status: 'active',
  languages: ['en'],
  sections: [{ id: 's', title: { en: 'Main' }, fields: [{ id: 'a', type: 'string', label: { en: 'A' }, fhirPath: 'name.0.family' }] }],
};

describe('diffFormSchemas', () => {
  it('groups metadata, section, and field changes', () => {
    const after: FormSchema = {
      ...before,
      title: { en: 'F revised' },
      sections: [{ id: 's', title: { en: 'Main revised' }, fields: [{ id: 'a', type: 'date', label: { en: 'A revised' }, fhirPath: 'birthDate' }, { id: 'b', type: 'boolean', label: { en: 'B' } }] }],
    };
    const changes = diffFormSchemas(before, after);
    expect(changes.map((change) => change.kind)).toContain('metadata_changed');
    expect(changes.map((change) => change.kind)).toContain('section_changed');
    expect(changes.map((change) => change.kind)).toContain('field_changed');
    expect(changes.map((change) => change.kind)).toContain('field_added');
  });
});
```

- [ ] **Step 9: Implement diff helper**

Create `packages/forms/src/diff.ts`:

```ts
import type { FormSchema, FormField, FormSection } from './schema/form-schema';

export type FormDiffKind =
  | 'metadata_changed'
  | 'section_added'
  | 'section_removed'
  | 'section_changed'
  | 'field_added'
  | 'field_removed'
  | 'field_changed';

export interface FormDiffChange {
  kind: FormDiffKind;
  path: string;
  label: string;
  before?: unknown;
  after?: unknown;
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

function fieldMap(sections: FormSection[]): Map<string, FormField> {
  const map = new Map<string, FormField>();
  for (const section of sections) for (const field of section.fields) map.set(field.id, field);
  return map;
}

export function diffFormSchemas(before: FormSchema, after: FormSchema): FormDiffChange[] {
  const changes: FormDiffChange[] = [];
  if (before.name !== after.name || stable(before.title) !== stable(after.title) || stable(before.languages) !== stable(after.languages)) {
    changes.push({ kind: 'metadata_changed', path: 'metadata', label: 'Metadata changed', before: { name: before.name, title: before.title, languages: before.languages }, after: { name: after.name, title: after.title, languages: after.languages } });
  }

  const beforeSections = new Map(before.sections.map((section) => [section.id, section]));
  const afterSections = new Map(after.sections.map((section) => [section.id, section]));
  for (const [id, section] of afterSections) {
    const old = beforeSections.get(id);
    if (!old) changes.push({ kind: 'section_added', path: `sections.${id}`, label: `Section added: ${section.title.en}`, after: section });
    else if (stable({ ...old, fields: undefined }) !== stable({ ...section, fields: undefined })) changes.push({ kind: 'section_changed', path: `sections.${id}`, label: `Section changed: ${section.title.en}`, before: old, after: section });
  }
  for (const [id, section] of beforeSections) {
    if (!afterSections.has(id)) changes.push({ kind: 'section_removed', path: `sections.${id}`, label: `Section removed: ${section.title.en}`, before: section });
  }

  const beforeFields = fieldMap(before.sections);
  const afterFields = fieldMap(after.sections);
  for (const [id, field] of afterFields) {
    const old = beforeFields.get(id);
    if (!old) changes.push({ kind: 'field_added', path: `fields.${id}`, label: `Field added: ${field.label.en}`, after: field });
    else if (stable(old) !== stable(field)) changes.push({ kind: 'field_changed', path: `fields.${id}`, label: `Field changed: ${field.label.en}`, before: old, after: field });
  }
  for (const [id, field] of beforeFields) {
    if (!afterFields.has(id)) changes.push({ kind: 'field_removed', path: `fields.${id}`, label: `Field removed: ${field.label.en}`, before: field });
  }
  return changes;
}
```

- [ ] **Step 10: Extend schema for builder-compatible metadata**

Modify `packages/forms/src/schema/form-schema.ts` with backward-compatible optional fields:

```ts
export const ValueSetBinding = z.object({
  valueSetId: z.string().optional(),
  url: z.string(),
  strength: z.enum(['required', 'extensible', 'preferred', 'example']).optional(),
  expandedAt: z.string().optional(),
});
export type ValueSetBinding = z.infer<typeof ValueSetBinding>;
```

Add optional fields to `FormField`:

```ts
enabled: z.boolean().optional(),
helpText: TranslatableText.optional(),
placeholder: TranslatableText.optional(),
valueSetBinding: ValueSetBinding.optional(),
```

Add optional section visibility only if the current `VisibilityRule` type remains simple:

```ts
visibility: VisibilityRule.optional(),
```

- [ ] **Step 11: Upgrade visibility tests**

Modify or create `packages/forms/src/visibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeVisibility } from './visibility';
import type { FormSchema } from './schema/form-schema';

const form: FormSchema = {
  id: 'f',
  name: 'F',
  title: { en: 'F' },
  status: 'active',
  languages: ['en'],
  sections: [{ id: 's', title: { en: 'S' }, fields: [
    { id: 'hasNotes', type: 'boolean', label: { en: 'Has notes' } },
    { id: 'notes', type: 'text', label: { en: 'Notes' }, visibility: { whenField: 'hasNotes', equals: true } },
  ] }],
};

describe('computeVisibility', () => {
  it('hides fields when their simple rule is not satisfied', () => {
    expect(computeVisibility(form, { hasNotes: false }).get('notes')).toBe(false);
    expect(computeVisibility(form, { hasNotes: true }).get('notes')).toBe(true);
  });
});
```

- [ ] **Step 12: Export helpers**

Modify `packages/forms/src/index.ts`:

```ts
export * from './lifecycle';
export * from './normalize';
export * from './lint';
export * from './diff';
```

- [ ] **Step 13: Run forms tests and typecheck**

Run: `pnpm --filter @openldr/forms test lifecycle normalize lint diff visibility && pnpm --filter @openldr/forms typecheck`

Expected: PASS for the focused tests and clean typecheck.

- [ ] **Step 14: Commit**

```bash
git add packages/forms/src/lifecycle.ts packages/forms/src/lifecycle.test.ts packages/forms/src/normalize.ts packages/forms/src/normalize.test.ts packages/forms/src/lint.ts packages/forms/src/lint.test.ts packages/forms/src/diff.ts packages/forms/src/diff.test.ts packages/forms/src/visibility.ts packages/forms/src/visibility.test.ts packages/forms/src/schema/form-schema.ts packages/forms/src/index.ts
git -c commit.gpgsign=false commit -m "feat(forms): add builder lifecycle lint diff helpers"
```

---

## Task 3: Version-Aware Form Store

**Files:**
- Modify: `packages/forms/src/store.ts`
- Modify: `packages/forms/src/store.test.ts`

- [ ] **Step 1: Add failing store lifecycle tests**

Append to `packages/forms/src/store.test.ts`:

```ts
it('publishes immutable version snapshots and lists them newest first', async () => {
  const store = createFormStore(db);
  const created = await store.create({
    name: 'Specimen intake',
    versionLabel: 'v1',
    fhirResourceType: 'Questionnaire',
    targetPages: ['forms'],
    schema: sampleForm,
  });

  const published = await store.publish(created.id, { actorId: 'u1', versionLabel: 'v1' });
  expect(published.status).toBe('published');

  await store.update(created.id, { ...created, name: 'Specimen intake revised', schema: { ...sampleForm, title: { en: 'Revised' } } });
  const republished = await store.publish(created.id, { actorId: 'u1', versionLabel: 'v2' });
  expect(republished.versionLabel).toBe('v2');

  const versions = await store.listVersions(created.id);
  expect(versions.map((version) => version.version)).toEqual([2, 1]);
  expect(versions[0].name).toBe('Specimen intake revised');
  expect((await store.getVersion(created.id, 1))?.versionLabel).toBe('v1');
});

it('duplicates a form as a draft copy', async () => {
  const store = createFormStore(db);
  const created = await store.create({ name: 'Specimen intake', schema: sampleForm, targetPages: ['forms'] });
  const copy = await store.duplicate(created.id);
  expect(copy.id).not.toBe(created.id);
  expect(copy.name).toBe('Specimen intake copy');
  expect(copy.status).toBe('draft');
  expect(copy.schema).toEqual(created.schema);
});
```

If `store.test.ts` uses different setup variable names than `db` or `sampleForm`, place these tests inside the existing `describe` block and reuse the helper names already present in the file.

- [ ] **Step 2: Run store tests to verify failure**

Run: `pnpm --filter @openldr/forms test store`

Expected: FAIL because `publish`, `listVersions`, `getVersion`, and `duplicate` are missing.

- [ ] **Step 3: Add version types**

Modify `packages/forms/src/store.ts`:

```ts
export interface FormVersionSummary {
  id: string;
  formId: string;
  version: number;
  versionLabel: string | null;
  name: string;
  fhirResourceType: string | null;
  targetPages: string[] | null;
  publishedAt: string;
  publishedBy: string | null;
}

export interface FormVersion extends FormVersionSummary {
  schema: FormSchema;
  questionnaire: unknown;
}

export interface PublishInput {
  actorId?: string | null;
  versionLabel?: string | null;
}
```

- [ ] **Step 4: Add row mappers**

Add near `FormRow` in `packages/forms/src/store.ts`:

```ts
type FormVersionRow = {
  id: string;
  form_id: string;
  version: number;
  version_label: string | null;
  name: string;
  fhir_resource_type: string | null;
  schema: unknown;
  target_pages: unknown | null;
  questionnaire: unknown;
  published_at: unknown;
  published_by: string | null;
};
```

Add mapper functions inside `createFormStore`:

```ts
const toVersion = (r: FormVersionRow): FormVersion => ({
  id: r.id,
  formId: r.form_id,
  version: r.version,
  versionLabel: r.version_label,
  name: r.name,
  fhirResourceType: r.fhir_resource_type,
  schema: parseJson(r.schema) as FormSchema,
  targetPages: r.target_pages ? (parseJson(r.target_pages) as string[]) : null,
  questionnaire: parseJson(r.questionnaire),
  publishedAt: toTimestamp(r.published_at),
  publishedBy: r.published_by,
});

const toVersionSummary = (r: FormVersionRow): FormVersionSummary => {
  const v = toVersion(r);
  return {
    id: v.id,
    formId: v.formId,
    version: v.version,
    versionLabel: v.versionLabel,
    name: v.name,
    fhirResourceType: v.fhirResourceType,
    targetPages: v.targetPages,
    publishedAt: v.publishedAt,
    publishedBy: v.publishedBy,
  };
};
```

- [ ] **Step 5: Implement store methods**

Import helpers at top:

```ts
import { toQuestionnaire } from './to-questionnaire';
import { computeNextFormVersion, makeDuplicateName } from './lifecycle';
```

Add methods to returned store object:

```ts
async publish(id: string, input: PublishInput = {}): Promise<FormDefinition> {
  const form = await get(id);
  if (!form) throw new Error('form not found');
  const existing = await db.selectFrom('form_versions').select(['version']).where('form_id', '=', id).execute();
  const nextVersion = computeNextFormVersion(existing.map((row) => Number(row.version)));
  await db
    .insertInto('form_versions')
    .values({
      id: `fv-${randomUUID()}`,
      form_id: id,
      version: nextVersion,
      version_label: input.versionLabel ?? form.versionLabel,
      name: form.name,
      fhir_resource_type: form.fhirResourceType,
      schema: JSON.stringify(form.schema) as never,
      target_pages: form.targetPages ? (JSON.stringify(form.targetPages) as never) : null,
      questionnaire: JSON.stringify(toQuestionnaire(form.schema)) as never,
      published_by: input.actorId ?? null,
    } as never)
    .execute();
  await db.updateTable('form_definitions')
    .set({ status: 'published', version_label: input.versionLabel ?? form.versionLabel, updated_at: sql`now()` })
    .where('id', '=', id)
    .execute();
  return (await get(id))!;
},

async duplicate(id: string): Promise<FormDefinition> {
  const form = await get(id);
  if (!form) throw new Error('form not found');
  return this.create({
    name: makeDuplicateName(form.name),
    versionLabel: form.versionLabel,
    fhirResourceType: form.fhirResourceType,
    status: 'draft',
    active: true,
    schema: { ...form.schema, id: `${form.schema.id}-copy`, name: makeDuplicateName(form.schema.name), title: { ...form.schema.title, en: makeDuplicateName(form.schema.title.en) } },
    targetPages: form.targetPages,
  });
},

async listVersions(id: string): Promise<FormVersionSummary[]> {
  const rows = await db.selectFrom('form_versions').selectAll().where('form_id', '=', id).orderBy('version', 'desc').execute();
  return rows.map((row) => toVersionSummary(row as FormVersionRow));
},

async getVersion(id: string, version: number): Promise<FormVersion | null> {
  const row = await db.selectFrom('form_versions').selectAll().where('form_id', '=', id).where('version', '=', version).executeTakeFirst();
  return row ? toVersion(row as FormVersionRow) : null;
},
```

Define `create`, `update`, `setStatus`, `deleteForm`, `publish`, `duplicate`, `listVersions`, and `getVersion` as named functions before the return object. Return them at the bottom as `{ get, list, listPublished, create, update, setStatus, delete: deleteForm, publish, duplicate, listVersions, getVersion }`. Do not call `this.create` from inside the object literal.

- [ ] **Step 6: Ensure update flips published forms to draft on content change**

Modify `update` in `packages/forms/src/store.ts` so it checks the existing form:

```ts
const existing = await get(id);
const nextStatus = existing?.status === 'published' ? 'draft' : existing?.status;
```

Include `status: nextStatus` in the update set only when `nextStatus` is defined:

```ts
status: nextStatus,
```

- [ ] **Step 7: Run store tests**

Run: `pnpm --filter @openldr/forms test store && pnpm --filter @openldr/forms typecheck`

Expected: PASS for store tests and clean typecheck.

- [ ] **Step 8: Commit**

```bash
git add packages/forms/src/store.ts packages/forms/src/store.test.ts
git -c commit.gpgsign=false commit -m "feat(forms): add version-aware form store"
```

---

## Task 4: Forms API Lifecycle Routes And Audit

**Files:**
- Modify: `apps/server/src/forms-routes.ts`
- Modify: `apps/server/src/forms-routes.test.ts`

- [ ] **Step 1: Add failing route tests**

Extend `apps/server/src/forms-routes.test.ts` to include store fakes for `publish`, `duplicate`, `listVersions`, and `getVersion`, then add:

```ts
it('publishes, duplicates, and returns form versions', async () => {
  const app = Fastify();
  registerFormsRoutes(app, fakeCtx());

  const created = await app.inject({
    method: 'POST',
    url: '/api/forms',
    payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
  });
  const id = created.json().id as string;

  const published = await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: { versionLabel: 'v1' } });
  expect(published.statusCode).toBe(200);
  expect(published.json()).toMatchObject({ status: 'published', versionLabel: 'v1' });

  const versions = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions` });
  expect(versions.statusCode).toBe(200);
  expect(versions.json()).toMatchObject([{ version: 1, versionLabel: 'v1' }]);

  const version = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions/1` });
  expect(version.statusCode).toBe(200);
  expect(version.json()).toMatchObject({ version: 1, schema: sampleSchema });

  const duplicate = await app.inject({ method: 'POST', url: `/api/forms/${id}/duplicate` });
  expect(duplicate.statusCode).toBe(201);
  expect(duplicate.json()).toMatchObject({ status: 'draft' });
});
```

- [ ] **Step 2: Run route tests to verify failure**

Run: `pnpm --filter @openldr/server test forms-routes`

Expected: FAIL with 404 for `/publish`, `/duplicate`, or `/versions`.

- [ ] **Step 3: Add request schemas**

Modify `apps/server/src/forms-routes.ts`:

```ts
const publishInput = z.object({
  versionLabel: z.string().nullish(),
});
```

- [ ] **Step 4: Add routes**

Add before `app.delete('/api/forms/:id'...)`:

```ts
app.post('/api/forms/:id/publish', async (req, reply) => {
  const p = publishInput.safeParse(req.body ?? {});
  if (!p.success) {
    reply.code(400);
    return { error: p.error.message };
  }
  const id = (req.params as { id: string }).id;
  if (!(await ctx.forms.get(id))) {
    reply.code(404);
    return { error: 'not found' };
  }
  return ctx.forms.publish(id, { versionLabel: p.data.versionLabel ?? null, actorId: null });
});

app.post('/api/forms/:id/duplicate', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!(await ctx.forms.get(id))) {
    reply.code(404);
    return { error: 'not found' };
  }
  const copy = await ctx.forms.duplicate(id);
  reply.code(201);
  return copy;
});

app.get('/api/forms/:id/versions', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!(await ctx.forms.get(id))) {
    reply.code(404);
    return { error: 'not found' };
  }
  return ctx.forms.listVersions(id);
});

app.get('/api/forms/:id/versions/:version', async (req, reply) => {
  const { id, version } = req.params as { id: string; version: string };
  const parsedVersion = Number.parseInt(version, 10);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    reply.code(400);
    return { error: 'version must be a positive integer' };
  }
  const snapshot = await ctx.forms.getVersion(id, parsedVersion);
  if (!snapshot) {
    reply.code(404);
    return { error: 'not found' };
  }
  return snapshot;
});
```

- [ ] **Step 5: Add audit calls**

`AppContext` exposes `audit`, so add `await ctx.audit.safeRecord(...)` after create/update/publish/duplicate/status/delete/response operations. Use action strings:

```ts
'form.create'
'form.update'
'form.publish'
'form.duplicate'
'form.status'
'form.delete'
'form.response.submit'
```

Use this helper inside `registerFormsRoutes`:

```ts
async function audit(action: string, entityId: string, before: unknown, after: unknown, metadata: Record<string, unknown> = {}) {
  await ctx.audit.safeRecord({
    actorType: 'system',
    actorId: null,
    actorName: 'System',
    action,
    entityType: 'form',
    entityId,
    before: before as Record<string, unknown> | null,
    after: after as Record<string, unknown> | null,
    metadata,
  });
}
```

For delete, load `before` with `ctx.forms.get(id)` before deletion and pass `after: null`. For create and duplicate, pass `before: null` and `after` as the returned form. For response submission, pass `before: null`, `after` as the built QuestionnaireResponse, and metadata `{ formId: f.id }`.

- [ ] **Step 6: Run route tests and typecheck**

Run: `pnpm --filter @openldr/server test forms-routes && pnpm --filter @openldr/server typecheck`

Expected: PASS for forms route tests and clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts
git -c commit.gpgsign=false commit -m "feat(server): add form lifecycle routes"
```

---

## Task 5: Web API Client And Routing

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.forms.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add failing API client tests**

Modify `apps/web/src/api.forms.test.ts`:

```ts
import { createForm, deleteForm, duplicateForm, formQuestionnaireUrl, getForm, getFormVersion, listFormVersions, listForms, publishForm, setFormStatus, submitFormResponse, updateForm } from './api';
```

Inside the existing endpoint test, add:

```ts
await updateForm('form-1', { name: 'Specimen intake', schema: { sections: [] } });
await publishForm('form-1', { versionLabel: 'v1' });
await duplicateForm('form-1');
await listFormVersions('form-1');
await getFormVersion('form-1', 1);
```

Update expected fetch calls accordingly:

```ts
expect(fetch).toHaveBeenNthCalledWith(4, '/api/forms/form-1', expect.objectContaining({ method: 'PUT' }));
expect(fetch).toHaveBeenNthCalledWith(5, '/api/forms/form-1/publish', expect.objectContaining({ method: 'POST' }));
expect(fetch).toHaveBeenNthCalledWith(6, '/api/forms/form-1/duplicate', expect.objectContaining({ method: 'POST' }));
expect(fetch).toHaveBeenNthCalledWith(7, '/api/forms/form-1/versions');
expect(fetch).toHaveBeenNthCalledWith(8, '/api/forms/form-1/versions/1');
```

Renumber later existing assertions.

- [ ] **Step 2: Run API test to verify failure**

Run: `pnpm --filter @openldr/web test api.forms`

Expected: FAIL because the new functions are not exported.

- [ ] **Step 3: Add API types and functions**

Modify `apps/web/src/api.ts` near Forms:

```ts
export interface UpdateFormInput extends CreateFormInput {}
export interface PublishFormInput { versionLabel?: string | null }
export interface FormVersionSummary {
  id: string;
  formId: string;
  version: number;
  versionLabel: string | null;
  name: string;
  fhirResourceType: string | null;
  targetPages: string[] | null;
  publishedAt: string;
  publishedBy: string | null;
}
export interface FormVersion extends FormVersionSummary {
  schema: unknown;
  questionnaire: unknown;
}
```

Add functions:

```ts
export const updateForm = (id: string, i: UpdateFormInput): Promise<FormDefinition> =>
  fetch(`/api/forms/${id}`, jbody(i, 'PUT')).then((r) => okJson<FormDefinition>(r, 'update form'));
export const publishForm = (id: string, i: PublishFormInput = {}): Promise<FormDefinition> =>
  fetch(`/api/forms/${id}/publish`, jbody(i, 'POST')).then((r) => okJson<FormDefinition>(r, 'publish form'));
export const duplicateForm = (id: string): Promise<FormDefinition> =>
  fetch(`/api/forms/${id}/duplicate`, jbody({}, 'POST')).then((r) => okJson<FormDefinition>(r, 'duplicate form'));
export const listFormVersions = (id: string): Promise<FormVersionSummary[]> =>
  apiGet(`/api/forms/${id}/versions`, 'list form versions');
export const getFormVersion = (id: string, version: number): Promise<FormVersion> =>
  apiGet(`/api/forms/${id}/versions/${version}`, 'get form version');
```

- [ ] **Step 4: Add builder routes**

Modify `apps/web/src/App.tsx`:

```ts
import { FormBuilderPage } from './forms-builder/FormBuilderPage';
```

Add routes before `/forms/:id`:

```tsx
<Route path="/forms/new" element={<FormBuilderPage />} />
<Route path="/forms/:id/builder" element={<FormBuilderPage />} />
```

- [ ] **Step 5: Add DnD dependencies**

Run:

```bash
pnpm --filter @openldr/web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected: `apps/web/package.json` and `pnpm-lock.yaml` update.

- [ ] **Step 6: Run focused web checks**

Run: `pnpm --filter @openldr/web test api.forms && pnpm --filter @openldr/web typecheck`

Expected: API test passes. Typecheck may fail because `FormBuilderPage` is not created yet; if so, create a temporary exported component:

```ts
export function FormBuilderPage(): JSX.Element {
  return <div />;
}
```

Then rerun typecheck.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/api.forms.test.ts apps/web/src/App.tsx apps/web/package.json pnpm-lock.yaml apps/web/src/forms-builder/FormBuilderPage.tsx
git -c commit.gpgsign=false commit -m "feat(web): add form builder routes and API client"
```

---

## Task 6: Shared Form Runtime For Capture And Preview

**Files:**
- Create: `apps/web/src/forms-runtime/types.ts`
- Create: `apps/web/src/forms-runtime/runtime.ts`
- Create: `apps/web/src/forms-runtime/FormRuntime.tsx`
- Create: `apps/web/src/forms-runtime/FormRuntime.test.tsx`
- Modify: `apps/web/src/pages/FormCapture.tsx`
- Modify: `apps/web/src/pages/FormCapture.test.tsx`

- [ ] **Step 1: Write runtime rendering test**

Create `apps/web/src/forms-runtime/FormRuntime.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormRuntime } from './FormRuntime';
import type { RuntimeFormSchema } from './types';

const form: RuntimeFormSchema = {
  id: 'f',
  name: 'F',
  title: { en: 'F' },
  sections: [{
    id: 'main',
    title: { en: 'Main' },
    fields: [
      { id: 'patientId', type: 'string', label: { en: 'Patient ID' }, required: true },
      { id: 'hasNotes', type: 'boolean', label: { en: 'Add notes?' } },
      { id: 'notes', type: 'text', label: { en: 'Notes' }, visibility: { whenField: 'hasNotes', equals: true } },
    ],
  }],
};

describe('FormRuntime', () => {
  it('renders fields, applies visibility, and submits cleaned answers', async () => {
    const onSubmit = vi.fn();
    render(<FormRuntime schema={form} submitLabel="Submit" onSubmit={onSubmit} />);
    expect(screen.getByLabelText('Patient ID')).toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Patient ID'), { target: { value: 'P-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add notes?' }));
    expect(await screen.findByLabelText('Notes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Visible note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'P-1', hasNotes: true, notes: 'Visible note' }));
  });
});
```

- [ ] **Step 2: Run runtime test to verify failure**

Run: `pnpm --filter @openldr/web test FormRuntime`

Expected: FAIL because runtime modules do not exist.

- [ ] **Step 3: Create runtime types**

Create `apps/web/src/forms-runtime/types.ts`:

```ts
export type RuntimeAnswerValue =
  | string
  | number
  | boolean
  | { code: string; display?: string; system?: string }
  | { value?: number; unit?: string };

export type RuntimeAnswers = Record<string, RuntimeAnswerValue | RuntimeAnswerValue[]>;

export interface RuntimeFormSchema {
  id: string;
  name: string;
  title: { en: string; fr?: string; pt?: string };
  sections: RuntimeSection[];
}

export interface RuntimeSection {
  id: string;
  title: { en: string; fr?: string; pt?: string };
  repeats?: boolean;
  fields: RuntimeField[];
}

export interface RuntimeField {
  id: string;
  type: 'string' | 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'dateTime' | 'choice' | 'open-choice' | 'reference' | 'quantity';
  label: { en: string; fr?: string; pt?: string };
  required?: boolean;
  repeats?: boolean;
  cardinality?: { min?: number; max?: number };
  options?: Array<{ code: string; display: { en: string; fr?: string; pt?: string }; system?: string }>;
  visibility?: { whenField: string; equals: string | number | boolean };
  unit?: string;
  placeholder?: { en: string; fr?: string; pt?: string };
  helpText?: { en: string; fr?: string; pt?: string };
}
```

- [ ] **Step 4: Move pure runtime helpers**

Create `apps/web/src/forms-runtime/runtime.ts` by moving pure helpers from `FormCapture.tsx`: `answerComparable`, `visibleFieldIds`, `isEmpty`, `typeOk`, `validateClient`, `cleanAnswers`, `formatFieldValue`, and `fieldValue`. Export:

```ts
export { visibleFieldIds, validateClient, cleanAnswers, formatFieldValue, fieldValue };
```

Use imports from `./types`.

- [ ] **Step 5: Create shared runtime component**

Create `apps/web/src/forms-runtime/FormRuntime.tsx` by moving `FieldInput`, `FieldControl`, and the form sections rendering from `FormCapture.tsx`. Public props:

```ts
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RuntimeAnswers, RuntimeAnswerValue, RuntimeField, RuntimeFormSchema } from './types';
import { cleanAnswers, fieldValue, formatFieldValue, validateClient, visibleFieldIds } from './runtime';

export function FormRuntime({
  schema,
  submitLabel,
  onSubmit,
  footer,
}: {
  schema: RuntimeFormSchema;
  submitLabel: string;
  onSubmit: (answers: RuntimeAnswers) => void | Promise<void>;
  footer?: React.ReactNode;
}): JSX.Element {
  const [answers, setAnswers] = useState<RuntimeAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const visible = useMemo(() => visibleFieldIds(schema, answers), [schema, answers]);

  const submit = async () => {
    const nextErrors = validateClient(schema, answers);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    await onSubmit(cleanAnswers(schema, answers));
  };

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {schema.sections.map((section) => {
        const fields = section.fields.filter((field) => visible.has(field.id));
        if (fields.length === 0) return null;
        return (
          <section key={section.id} className="space-y-3">
            <div className="border-b border-border pb-2">
              <h2 className="text-sm font-semibold">{section.title.en}</h2>
            </div>
            <div className="grid gap-4">
              {fields.map((field) => (
                <div key={field.id} className="grid gap-1.5 md:grid-cols-[12rem_minmax(0,1fr)] md:items-start">
                  <Label htmlFor={field.id} className="pt-2 text-sm">
                    {field.label.en}
                    {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
                  </Label>
                  <FieldControl
                    field={field}
                    answers={answers}
                    error={errors[field.id]}
                    onChange={(fieldId, value) => {
                      setAnswers((prev) => {
                        const next = { ...prev };
                        if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[fieldId];
                        else next[fieldId] = value;
                        return next;
                      });
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next[fieldId];
                        return next;
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {footer ?? <Button type="submit">{submitLabel}</Button>}
    </form>
  );
}
```

Add these two local components below `FormRuntime` in the same file:

```tsx
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: RuntimeField;
  value: RuntimeAnswerValue | undefined;
  onChange: (value: RuntimeAnswerValue | undefined) => void;
}) {
  if (field.type === 'boolean') {
    return <Checkbox id={field.id} checked={Boolean(value)} onCheckedChange={(checked) => onChange(Boolean(checked))} aria-label={field.label.en} />;
  }
  if (field.type === 'choice') {
    return (
      <Select value={formatFieldValue(field, value)} onValueChange={(next) => onChange(fieldValue(field, next))}>
        <SelectTrigger id={field.id} aria-label={field.label.en}><SelectValue placeholder="Select..." /></SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((option) => <SelectItem key={option.code} value={option.code}>{option.display.en}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  const type = field.type === 'integer' || field.type === 'decimal' || field.type === 'quantity'
    ? 'number'
    : field.type === 'date'
      ? 'date'
      : field.type === 'dateTime'
        ? 'datetime-local'
        : 'text';
  return (
    <div className="flex items-center gap-2">
      <Input
        id={field.id}
        type={type}
        value={formatFieldValue(field, value)}
        placeholder={field.placeholder?.en}
        onChange={(event) => onChange(fieldValue(field, event.target.value))}
        aria-label={field.label.en}
      />
      {field.unit ? <span className="text-xs text-muted-foreground">{field.unit}</span> : null}
    </div>
  );
}

function FieldControl({
  field,
  answers,
  error,
  onChange,
}: {
  field: RuntimeField;
  answers: RuntimeAnswers;
  error?: string;
  onChange: (fieldId: string, value: RuntimeAnswerValue | RuntimeAnswerValue[] | undefined) => void;
}) {
  const raw = answers[field.id];
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];

  if (field.repeats) {
    const nextValues = values.length > 0 ? values : [undefined];
    return (
      <div className="space-y-2">
        {nextValues.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="flex-1">
              <FieldInput
                field={field}
                value={value}
                onChange={(next) => {
                  const copy = [...nextValues];
                  if (next === undefined) copy.splice(index, 1);
                  else copy[index] = next;
                  onChange(field.id, copy.filter((item): item is RuntimeAnswerValue => item !== undefined));
                }}
              />
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${field.label.en} ${index + 1}`} onClick={() => onChange(field.id, nextValues.filter((_, i) => i !== index) as RuntimeAnswerValue[])}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onChange(field.id, [...values, ''] as RuntimeAnswerValue[])}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <FieldInput field={field} value={values[0]} onChange={(next) => onChange(field.id, next)} />
      {field.helpText?.en ? <p className="mt-1 text-xs text-muted-foreground">{field.helpText.en}</p> : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 6: Refactor capture page**

Modify `apps/web/src/pages/FormCapture.tsx` to remove the local runtime helpers and render:

```tsx
<FormRuntime
  schema={schema}
  submitLabel="Submit"
  onSubmit={async (cleaned) => {
    await submitFormResponse(id, cleaned);
    setSuccess(true);
  }}
  footer={null}
/>
```

Keep the existing page header, loading/error/success state, and bottom action bar. The bottom Submit button can trigger a form submit by placing it inside `FormRuntime` footer or by passing a footer with Submit/Cancel buttons.

- [ ] **Step 7: Run capture and runtime tests**

Run: `pnpm --filter @openldr/web test FormRuntime FormCapture && pnpm --filter @openldr/web typecheck`

Expected: PASS for runtime and capture tests, clean typecheck.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/forms-runtime apps/web/src/pages/FormCapture.tsx apps/web/src/pages/FormCapture.test.tsx
git -c commit.gpgsign=false commit -m "feat(web): share form runtime for capture and preview"
```

---

## Task 7: Builder Model, History, And Keyboard Foundation

**Files:**
- Create: `apps/web/src/forms-builder/builderModel.ts`
- Create: `apps/web/src/forms-builder/builderModel.test.ts`
- Create: `apps/web/src/forms-builder/useTemplateHistory.ts`
- Create: `apps/web/src/forms-builder/useTemplateHistory.test.ts`
- Create: `apps/web/src/forms-builder/useBuilderKeyboard.ts`

- [ ] **Step 1: Write builder model tests**

Create `apps/web/src/forms-builder/builderModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDefaultFormSchema, newField, newSection, reindexFields } from './builderModel';

describe('builderModel', () => {
  it('creates a runnable default form schema', () => {
    const schema = createDefaultFormSchema('Specimen intake');
    expect(schema.name).toBe('Specimen intake');
    expect(schema.languages).toEqual(['en']);
    expect(schema.sections[0].fields).toHaveLength(0);
  });

  it('creates fields and sections with stable ids', () => {
    expect(newSection('Patient details').id).toBe('patient-details');
    expect(newField('Patient ID', 'string').id).toBe('patient-id');
  });

  it('reindexes fields without changing their content', () => {
    const fields = [newField('B', 'string'), newField('A', 'date')];
    expect(reindexFields(fields)).toEqual(fields);
  });
});
```

- [ ] **Step 2: Implement builder model**

Create `apps/web/src/forms-builder/builderModel.ts`:

```ts
import type { FormField, FormSchema, FormSection, FieldType } from '@openldr/forms';

export function slugify(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return slug || 'item';
}

export function createDefaultFormSchema(name: string): FormSchema {
  const id = slugify(name);
  return {
    id,
    name,
    title: { en: name },
    status: 'active',
    languages: ['en'],
    sections: [{ id: 'main', title: { en: 'Main' }, fields: [] }],
  };
}

export function newSection(label: string): FormSection {
  return { id: slugify(label), title: { en: label }, fields: [] };
}

export function newField(label: string, type: FieldType): FormField {
  return { id: slugify(label), type, label: { en: label }, enabled: true };
}

export function reindexFields<T extends FormField>(fields: T[]): T[] {
  return fields.map((field) => ({ ...field }));
}
```

- [ ] **Step 3: Write history tests**

Create `apps/web/src/forms-builder/useTemplateHistory.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTemplateHistory } from './useTemplateHistory';

describe('useTemplateHistory', () => {
  it('undoes and redoes snapshots', () => {
    let state = { name: 'A' };
    const { result } = renderHook(() => useTemplateHistory(() => state));
    act(() => result.current.reset(state));
    act(() => result.current.pushHistory());
    state = { name: 'B' };
    expect(result.current.undo()).toEqual({ name: 'A' });
    expect(result.current.redo()).toEqual({ name: 'B' });
  });

  it('coalesces debounced edits', () => {
    vi.useFakeTimers();
    let state = { name: 'A' };
    const { result } = renderHook(() => useTemplateHistory(() => state));
    act(() => result.current.reset(state));
    act(() => result.current.recordEdit());
    state = { name: 'AB' };
    act(() => result.current.recordEdit());
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.undo()).toEqual({ name: 'A' });
    vi.useRealTimers();
  });
});
```

- [ ] **Step 4: Implement history hook**

Create `apps/web/src/forms-builder/useTemplateHistory.ts`:

```ts
import { useCallback, useRef, useState } from 'react';

export interface UseTemplateHistory<T> {
  pushHistory: () => void;
  recordEdit: () => void;
  undo: () => T | null;
  redo: () => T | null;
  canUndo: boolean;
  canRedo: boolean;
  reset: (state: T) => void;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function useTemplateHistory<T>(currentState: () => T): UseTemplateHistory<T> {
  const historyRef = useRef<T[]>([]);
  const indexRef = useRef(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, force] = useState(0);
  const refresh = () => force((value) => value + 1);

  const pushHistory = useCallback(() => {
    const snapshot = clone(currentState());
    const next = historyRef.current.slice(0, indexRef.current + 1);
    next.push(snapshot);
    while (next.length > 50) next.shift();
    historyRef.current = next;
    indexRef.current = next.length - 1;
    refresh();
  }, [currentState]);

  const recordEdit = useCallback(() => {
    if (!timerRef.current) pushHistory();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
    }, 500);
  }, [pushHistory]);

  const undo = useCallback(() => {
    if (indexRef.current < 0) return null;
    const current = clone(currentState());
    if (indexRef.current === historyRef.current.length - 1) historyRef.current.push(current);
    const snapshot = historyRef.current[indexRef.current];
    indexRef.current -= 1;
    refresh();
    return clone(snapshot);
  }, [currentState]);

  const redo = useCallback(() => {
    const nextIndex = indexRef.current + 2;
    if (nextIndex >= historyRef.current.length) return null;
    indexRef.current += 1;
    refresh();
    return clone(historyRef.current[nextIndex]);
  }, []);

  const reset = useCallback((state: T) => {
    historyRef.current = [clone(state)];
    indexRef.current = -1;
    refresh();
  }, []);

  return {
    pushHistory,
    recordEdit,
    undo,
    redo,
    canUndo: indexRef.current >= 0,
    canRedo: indexRef.current + 2 < historyRef.current.length,
    reset,
  };
}
```

- [ ] **Step 5: Implement keyboard hook**

Create `apps/web/src/forms-builder/useBuilderKeyboard.ts`:

```ts
import { useEffect } from 'react';

export interface BuilderKeyboardHandlers {
  focusSearch: () => void;
  next: () => void;
  previous: () => void;
  open: () => void;
  toggle: () => void;
  duplicate: () => void;
  remove: () => void;
  selectAll: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable;
}

export function useBuilderKeyboard(handlers: BuilderKeyboardHandlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); handlers.focusSearch(); return; }
      if (mod && event.key.toLowerCase() === 'z' && event.shiftKey) { event.preventDefault(); handlers.redo(); return; }
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); handlers.undo(); return; }
      if (isTypingTarget(event.target)) return;
      if (event.key === 'j' || event.key === 'ArrowDown') handlers.next();
      else if (event.key === 'k' || event.key === 'ArrowUp') handlers.previous();
      else if (event.key === 'Enter') handlers.open();
      else if (event.key === ' ') { event.preventDefault(); handlers.toggle(); }
      else if (event.key.toLowerCase() === 'd' && mod) { event.preventDefault(); handlers.duplicate(); }
      else if (event.key.toLowerCase() === 'd') handlers.remove();
      else if (event.key.toLowerCase() === 'a' && mod) { event.preventDefault(); handlers.selectAll(); }
      else if (event.key === 'Escape') handlers.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @openldr/web test builderModel useTemplateHistory && pnpm --filter @openldr/web typecheck`

Expected: PASS and clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/forms-builder/builderModel.ts apps/web/src/forms-builder/builderModel.test.ts apps/web/src/forms-builder/useTemplateHistory.ts apps/web/src/forms-builder/useTemplateHistory.test.ts apps/web/src/forms-builder/useBuilderKeyboard.ts
git -c commit.gpgsign=false commit -m "feat(web): add form builder state foundations"
```

---

## Task 8: Builder Page Shell, Forms List Actions, And Save Flow

**Files:**
- Create: `apps/web/src/forms-builder/FormBuilderPage.tsx`
- Create: `apps/web/src/forms-builder/FormBuilderPage.test.tsx`
- Create: `apps/web/src/forms-builder/FieldPalette.tsx`
- Create: `apps/web/src/forms-builder/BuilderCanvas.tsx`
- Create: `apps/web/src/forms-builder/PropertiesSheet.tsx`
- Create: `apps/web/src/forms-builder/LintSummary.tsx`
- Modify: `apps/web/src/pages/Forms.tsx`
- Modify: `apps/web/src/pages/Forms.test.tsx`

- [ ] **Step 1: Write page shell test**

Create `apps/web/src/forms-builder/FormBuilderPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormBuilderPage } from './FormBuilderPage';
import * as api from '../api';

describe('FormBuilderPage', () => {
  beforeEach(() => {
    vi.spyOn(api, 'createForm').mockResolvedValue({
      id: 'form-1',
      name: 'Specimen intake',
      versionLabel: null,
      fhirResourceType: null,
      status: 'draft',
      active: true,
      schema: { id: 'specimen-intake', name: 'Specimen intake', title: { en: 'Specimen intake' }, status: 'active', languages: ['en'], sections: [{ id: 'main', title: { en: 'Main' }, fields: [] }] },
      targetPages: ['forms'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('creates a new form draft from the builder', async () => {
    render(<MemoryRouter initialEntries={['/forms/new']}><Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Specimen intake' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.createForm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Specimen intake' })));
  });
});
```

- [ ] **Step 2: Run page shell test to verify failure**

Run: `pnpm --filter @openldr/web test FormBuilderPage`

Expected: FAIL because the page does not render the expected fields.

- [ ] **Step 3: Implement minimal components**

Create `apps/web/src/forms-builder/LintSummary.tsx`:

```tsx
import type { LintIssue } from '@openldr/forms';

export function LintSummary({ issues }: { issues: LintIssue[] }): JSX.Element | null {
  if (issues.length === 0) return null;
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
      {errors} errors, {warnings} warnings
    </div>
  );
}
```

Create `apps/web/src/forms-builder/FieldPalette.tsx`:

```tsx
import type { FieldType } from '@openldr/forms';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TYPES: FieldType[] = ['string', 'text', 'choice', 'date', 'quantity', 'boolean'];

export function FieldPalette({ search, onSearch, onAddField }: { search: string; onSearch: (value: string) => void; onAddField: (type: FieldType) => void }): JSX.Element {
  return (
    <div className="space-y-3">
      <Input aria-label="Search fields" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search fields" className="h-8 text-xs" />
      <div className="grid gap-2">
        {TYPES.map((type) => (
          <Button key={type} type="button" variant="outline" size="sm" className="justify-start text-xs" onClick={() => onAddField(type)}>
            Add {type} field
          </Button>
        ))}
      </div>
    </div>
  );
}
```

Create `apps/web/src/forms-builder/BuilderCanvas.tsx`:

```tsx
import type { FormField, FormSection } from '@openldr/forms';
import { Button } from '@/components/ui/button';

export function BuilderCanvas({
  sections,
  selectedFieldIds,
  onSelectField,
  onDeleteField,
}: {
  sections: FormSection[];
  selectedFieldIds: Set<string>;
  onSelectField: (field: FormField, event: React.MouseEvent) => void;
  onDeleteField: (fieldId: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section key={section.id} className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">{section.title.en}</div>
          <div className="divide-y divide-border">
            {section.fields.length === 0 ? <div className="px-3 py-6 text-center text-xs text-muted-foreground">No fields in this section.</div> : null}
            {section.fields.map((field) => (
              <div key={field.id} className={selectedFieldIds.has(field.id) ? 'flex items-center gap-2 bg-primary/5 px-3 py-2' : 'flex items-center gap-2 px-3 py-2'}>
                <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={(event) => onSelectField(field, event)}>
                  <span className="font-medium">{field.label.en}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{field.type}</span>
                </button>
                <Button type="button" size="sm" variant="ghost" aria-label={`Delete ${field.label.en}`} onClick={() => onDeleteField(field.id)}>Delete</Button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

Create `apps/web/src/forms-builder/PropertiesSheet.tsx`:

```tsx
import type { FieldType, FormField } from '@openldr/forms';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TYPES: FieldType[] = ['string', 'text', 'integer', 'decimal', 'boolean', 'date', 'dateTime', 'choice', 'open-choice', 'reference', 'quantity'];

export function PropertiesSheet({ field, onChange }: { field: FormField | null; onChange: (updates: Partial<FormField>) => void }): JSX.Element {
  if (!field) return <div className="text-xs text-muted-foreground">Select a field to edit properties.</div>;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="field-label" className="text-xs">Field label</Label>
        <Input id="field-label" aria-label="Field label" value={field.label.en} onChange={(event) => onChange({ label: { ...field.label, en: event.target.value } })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="field-id" className="text-xs">Field id</Label>
        <Input id="field-id" aria-label="Field id" value={field.id} onChange={(event) => onChange({ id: event.target.value })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Field type</Label>
        <Select value={field.type} onValueChange={(value) => onChange({ type: value as FieldType })}>
          <SelectTrigger aria-label="Field type"><SelectValue /></SelectTrigger>
          <SelectContent>{TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox checked={Boolean(field.required)} onCheckedChange={(checked) => onChange({ required: Boolean(checked) })} />
        Required
      </label>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox checked={Boolean(field.repeats)} onCheckedChange={(checked) => onChange({ repeats: Boolean(checked) })} />
        Repeats
      </label>
      <div className="space-y-1">
        <Label htmlFor="field-fhir-path" className="text-xs">FHIR path</Label>
        <Input id="field-fhir-path" aria-label="FHIR path" value={field.fhirPath ?? ''} onChange={(event) => onChange({ fhirPath: event.target.value || undefined })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="field-unit" className="text-xs">Unit</Label>
        <Input id="field-unit" aria-label="Unit" value={field.unit ?? ''} onChange={(event) => onChange({ unit: event.target.value || undefined })} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement page save flow**

In `apps/web/src/forms-builder/FormBuilderPage.tsx`, implement:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createForm, getForm, updateForm, type FormDefinition } from '../api';
import { createDefaultFormSchema } from './builderModel';
import { LintSummary } from './LintSummary';
import { lintFormSchema, normalizeFormSchema, type FormSchema } from '@openldr/forms';

export function FormBuilderPage(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const [formId, setFormId] = useState<string | null>(id ?? null);
  const [name, setName] = useState('Untitled form');
  const [versionLabel, setVersionLabel] = useState('');
  const [targetPages, setTargetPages] = useState<string[]>(['forms']);
  const [schema, setSchema] = useState<FormSchema>(() => createDefaultFormSchema('Untitled form'));
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    void getForm(id)
      .then((loaded: FormDefinition) => {
        if (cancelled) return;
        setFormId(loaded.id);
        setName(loaded.name);
        setVersionLabel(loaded.versionLabel ?? '');
        setTargetPages(loaded.targetPages ?? ['forms']);
        setSchema(normalizeFormSchema(loaded.schema));
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const issues = useMemo(() => lintFormSchema(schema), [schema]);

  const save = async () => {
    const nextSchema = { ...schema, name, title: { ...schema.title, en: name } };
    const payload = { name, versionLabel: versionLabel || null, fhirResourceType: null, targetPages, schema: nextSchema };
    const saved = formId ? await updateForm(formId, payload) : await createForm(payload);
    if (!formId) {
      setFormId(saved.id);
      navigate(`/forms/${saved.id}/builder`, { replace: true });
    }
  };

  return (
    <AppShell title="Form Builder" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Input aria-label="Form name" value={name} onChange={(event) => setName(event.target.value)} className="h-8 w-72 text-sm" />
          <Input aria-label="Version label" value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} className="h-8 w-32 text-sm" />
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => navigate('/forms')}>Back</Button>
          <Button size="sm" onClick={() => { void save(); }} disabled={loading || issues.some((issue) => issue.severity === 'error')}>Save draft</Button>
        </div>
        <div className="border-b border-border px-3 py-2"><LintSummary issues={issues} /></div>
        {error ? <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)_24rem]">
          <aside className="border-r border-border p-3">Field palette</aside>
          <main className="min-h-0 overflow-auto p-3">Canvas</main>
          <aside className="border-l border-border p-3">Properties</aside>
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 5: Enable Forms list actions**

Modify `apps/web/src/pages/Forms.tsx`:

- Remove disabled tooltip wrapper for **New form**.
- Change the button to `onClick={() => navigate('/forms/new')}`.
- Add dropdown item `Edit builder` to navigate to `/forms/${form.id}/builder`.
- Add duplicate/publish/compare labels after API functions exist.

Update `Forms.test.tsx` so it expects **New form** to be enabled:

```ts
expect(screen.getByRole('button', { name: /new form/i })).toBeEnabled();
fireEvent.click(screen.getByRole('button', { name: /new form/i }));
```

Wrap the page in:

```tsx
<MemoryRouter initialEntries={['/forms']}>
  <Routes>
    <Route path="/forms" element={<Forms />} />
    <Route path="/forms/new" element={<div>Builder opened</div>} />
  </Routes>
</MemoryRouter>
```

Assert:

```ts
expect(await screen.findByText('Builder opened')).toBeInTheDocument();
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @openldr/web test FormBuilderPage Forms && pnpm --filter @openldr/web typecheck`

Expected: PASS and clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/forms-builder apps/web/src/pages/Forms.tsx apps/web/src/pages/Forms.test.tsx
git -c commit.gpgsign=false commit -m "feat(web): add form builder shell and save flow"
```

---

## Task 9: Sections, Fields, Properties, DnD, Search, Bulk, History, And Shortcuts

**Files:**
- Modify: `apps/web/src/forms-builder/FormBuilderPage.tsx`
- Modify: `apps/web/src/forms-builder/FormBuilderPage.test.tsx`
- Modify: `apps/web/src/forms-builder/FieldPalette.tsx`
- Modify: `apps/web/src/forms-builder/BuilderCanvas.tsx`
- Create: `apps/web/src/forms-builder/FieldRow.tsx`
- Create: `apps/web/src/forms-builder/SectionRow.tsx`
- Create: `apps/web/src/forms-builder/BulkActionBar.tsx`
- Modify: `apps/web/src/forms-builder/PropertiesSheet.tsx`

- [ ] **Step 1: Add failing component test for field operations**

Extend `FormBuilderPage.test.tsx`:

```tsx
it('adds, edits, searches, selects, and deletes fields', async () => {
  render(<MemoryRouter initialEntries={['/forms/new']}><Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Add string field' }));
  expect(screen.getByText('New string field')).toBeInTheDocument();
  fireEvent.click(screen.getByText('New string field'));
  fireEvent.change(screen.getByLabelText('Field label'), { target: { value: 'Patient ID' } });
  expect(screen.getByText('Patient ID')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search fields'), { target: { value: 'patient' } });
  expect(screen.getByText('Patient ID')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected field' }));
  expect(screen.queryByText('Patient ID')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @openldr/web test FormBuilderPage`

Expected: FAIL because field operations are not implemented.

- [ ] **Step 3: Implement field palette**

`FieldPalette.tsx` props:

```ts
import type { FieldType } from '@openldr/forms';

export function FieldPalette({
  search,
  onSearch,
  onAddField,
}: {
  search: string;
  onSearch: (value: string) => void;
  onAddField: (type: FieldType) => void;
}): JSX.Element
```

Render an input with `aria-label="Search fields"` and buttons named `Add string field`, `Add text field`, `Add choice field`, `Add date field`, `Add quantity field`, and `Add boolean field`.

- [ ] **Step 4: Implement field rows and canvas**

`FieldRow.tsx` renders a field row with:

- label text
- field type badge
- selected state styling
- buttons for duplicate and delete with accessible labels

`BuilderCanvas.tsx` renders sections and filtered fields. Wire `@dnd-kit/core` and `@dnd-kit/sortable` for reorder. Tests may use button operations rather than DnD events; browser verification covers drag.

- [ ] **Step 5: Implement properties sheet**

`PropertiesSheet.tsx` should edit:

- `Field label`
- `Field id`
- `Field type`
- `Required`
- `Repeats`
- `FHIR path`
- `Unit`

Use stable `aria-label`s matching test names.

- [ ] **Step 6: Wire state in page**

In `FormBuilderPage.tsx`, add state:

```ts
const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(new Set());
const [search, setSearch] = useState('');
```

Add helpers:

```ts
const addField = (type: FieldType) => {
  history.pushHistory();
  setSchema((prev) => {
    const field = newField(`New ${type} field`, type);
    const sections = prev.sections.length > 0 ? prev.sections : [newSection('Main')];
    return {
      ...prev,
      sections: sections.map((section, index) => index === 0 ? { ...section, fields: [...section.fields, field] } : section),
    };
  });
  setSelectedFieldIds(new Set());
};

const updateSelectedField = (updates: Partial<FormField>) => {
  const selected = [...selectedFieldIds][0];
  if (!selected) return;
  history.recordEdit();
  setSchema((prev) => ({
    ...prev,
    sections: prev.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => field.id === selected ? { ...field, ...updates } : field),
    })),
  }));
};

const deleteSelected = () => {
  if (selectedFieldIds.size === 0) return;
  history.pushHistory();
  setSchema((prev) => ({
    ...prev,
    sections: prev.sections.map((section) => ({ ...section, fields: section.fields.filter((field) => !selectedFieldIds.has(field.id)) })),
  }));
  setSelectedFieldIds(new Set());
};

const duplicateSelected = () => {
  if (selectedFieldIds.size === 0) return;
  history.pushHistory();
  setSchema((prev) => ({
    ...prev,
    sections: prev.sections.map((section) => ({
      ...section,
      fields: section.fields.flatMap((field) => selectedFieldIds.has(field.id) ? [field, { ...field, id: `${field.id}-copy`, label: { ...field.label, en: `${field.label.en} copy` } }] : [field]),
    })),
  }));
};
```

Use `useTemplateHistory` before structural mutations and `recordEdit` for property updates. Use `useBuilderKeyboard` to call selection helpers.

- [ ] **Step 7: Add bulk action bar**

Create `BulkActionBar.tsx`:

```tsx
import { Button } from '@/components/ui/button';

export function BulkActionBar({ count, onDelete, onDuplicate, onClear }: { count: number; onDelete: () => void; onDuplicate: () => void; onClear: () => void }): JSX.Element | null {
  if (count < 2) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
      <span>{count} selected</span>
      <Button size="sm" variant="outline" onClick={onDuplicate}>Duplicate</Button>
      <Button size="sm" variant="outline" onClick={onDelete}>Delete</Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  );
}
```

- [ ] **Step 8: Run tests and manual typecheck**

Run: `pnpm --filter @openldr/web test FormBuilderPage useTemplateHistory builderModel && pnpm --filter @openldr/web typecheck`

Expected: PASS and clean typecheck.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/forms-builder
git -c commit.gpgsign=false commit -m "feat(web): add rich form builder editing interactions"
```

---

## Task 10: Visibility, Terminology Binding, Repeats, Preview, Publish, And Compare

**Files:**
- Create: `apps/web/src/forms-builder/VisibilityRuleEditor.tsx`
- Create: `apps/web/src/forms-builder/ValueSetBindingEditor.tsx`
- Create: `apps/web/src/forms-builder/CompareDialog.tsx`
- Modify: `apps/web/src/forms-builder/FormBuilderPage.tsx`
- Modify: `apps/web/src/forms-builder/FormBuilderPage.test.tsx`
- Modify: `apps/web/src/forms-runtime/FormRuntime.tsx`
- Modify: `apps/web/src/forms-runtime/runtime.ts`

- [ ] **Step 1: Add failing test for publish and compare**

Extend `FormBuilderPage.test.tsx` with mocked APIs:

```tsx
it('publishes and compares against a published version', async () => {
  vi.spyOn(api, 'getForm').mockResolvedValue({
    id: 'form-1',
    name: 'Specimen intake',
    versionLabel: 'v1',
    fhirResourceType: null,
    status: 'draft',
    active: true,
    schema: { id: 'specimen-intake', name: 'Specimen intake', title: { en: 'Specimen intake' }, status: 'active', languages: ['en'], sections: [{ id: 'main', title: { en: 'Main' }, fields: [{ id: 'patientId', type: 'string', label: { en: 'Patient ID' } }] }] },
    targetPages: ['forms'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  vi.spyOn(api, 'publishForm').mockResolvedValue(await api.getForm('form-1'));
  vi.spyOn(api, 'listFormVersions').mockResolvedValue([{ id: 'fv-1', formId: 'form-1', version: 1, versionLabel: 'v1', name: 'Specimen intake', fhirResourceType: null, targetPages: ['forms'], publishedAt: '2026-01-01T00:00:00.000Z', publishedBy: null }]);
  vi.spyOn(api, 'getFormVersion').mockResolvedValue({ id: 'fv-1', formId: 'form-1', version: 1, versionLabel: 'v1', name: 'Specimen intake', fhirResourceType: null, targetPages: ['forms'], publishedAt: '2026-01-01T00:00:00.000Z', publishedBy: null, schema: { id: 'specimen-intake', name: 'Specimen intake', title: { en: 'Specimen intake' }, status: 'active', languages: ['en'], sections: [] }, questionnaire: {} });

  render(<MemoryRouter initialEntries={['/forms/form-1/builder']}><Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(api.publishForm).toHaveBeenCalledWith('form-1', expect.objectContaining({ versionLabel: 'v1' })));
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  expect(await screen.findByText(/Published version v1/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement visibility editor**

Create `VisibilityRuleEditor.tsx`:

```tsx
import type { FormField } from '@openldr/forms';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

export function VisibilityRuleEditor({ field, fields, onChange }: { field: FormField; fields: FormField[]; onChange: (visibility: FormField['visibility'] | undefined) => void }): JSX.Element {
  const candidates = fields.filter((candidate) => candidate.id !== field.id);
  const visibility = field.visibility;
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">Visibility</div>
      <Select value={visibility?.whenField ?? '__always'} onValueChange={(value) => onChange(value === '__always' ? undefined : { whenField: value, equals: '' })}>
        <SelectTrigger aria-label="Visibility field"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__always">Always visible</SelectItem>
          {candidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.label.en}</SelectItem>)}
        </SelectContent>
      </Select>
      {visibility ? (
        <Input aria-label="Visibility value" value={String(visibility.equals)} onChange={(event) => onChange({ ...visibility, equals: event.target.value })} />
      ) : null}
      {visibility ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>Clear visibility</Button> : null}
    </div>
  );
}
```

- [ ] **Step 3: Implement value set binding editor**

Create `ValueSetBindingEditor.tsx` using existing `ValueSetPicker`, `expandValueSet`, and `Button`:

```tsx
import type { FormField } from '@openldr/forms';
import { Button } from '@/components/ui/button';
import { ValueSetPicker } from '@/terminology/ValueSetPicker';
import { expandValueSet, type ValueSetSummary } from '../api';

export function ValueSetBindingEditor({ field, onChange }: { field: FormField; onChange: (updates: Partial<FormField>) => void }): JSX.Element {
  const bind = async (valueSet: ValueSetSummary) => {
    const expanded = await expandValueSet(valueSet.id);
    onChange({
      valueSetBinding: { valueSetId: valueSet.id, url: valueSet.url, strength: 'required', expandedAt: new Date().toISOString() },
      options: expanded.codes.map((code) => ({ code: code.code, system: code.system, display: { en: code.display ?? code.code } })),
    });
  };
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">ValueSet binding</div>
      <ValueSetPicker onPick={(valueSet) => { void bind(valueSet); }} />
      {field.valueSetBinding ? <div className="text-xs text-muted-foreground">{field.valueSetBinding.url}</div> : null}
      {field.valueSetBinding ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ valueSetBinding: undefined, options: [] })}>Clear binding</Button> : null}
    </div>
  );
}
```

- [ ] **Step 4: Implement compare dialog**

Create `CompareDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getFormVersion, listFormVersions, type FormVersionSummary } from '../api';
import { diffFormSchemas, normalizeFormSchema, type FormSchema } from '@openldr/forms';

export function CompareDialog({ formId, current, open, onOpenChange }: { formId: string | null; current: FormSchema; open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [changes, setChanges] = useState<ReturnType<typeof diffFormSchemas>>([]);
  useEffect(() => {
    if (!open || !formId) return;
    void listFormVersions(formId).then(async (rows) => {
      setVersions(rows);
      const first = rows[0];
      if (first) {
        const snapshot = await getFormVersion(formId, first.version);
        setChanges(diffFormSchemas(normalizeFormSchema(snapshot.schema), current));
      }
    });
  }, [open, formId, current]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Compare form versions</DialogTitle></DialogHeader>
        {versions[0] ? <p className="text-xs text-muted-foreground">Published version {versions[0].versionLabel ?? versions[0].version}</p> : <p className="text-xs text-muted-foreground">No published versions.</p>}
        <div className="max-h-[60vh] overflow-auto">
          {changes.length === 0 ? <p className="text-sm text-muted-foreground">No differences.</p> : changes.map((change) => (
            <div key={`${change.kind}-${change.path}`} className="border-b border-border py-2 text-sm">
              <div className="font-medium">{change.label}</div>
              <div className="text-xs text-muted-foreground">{change.kind}</div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Wire publish, preview, visibility, and binding into page**

Modify `FormBuilderPage.tsx`:

- Add buttons named `Publish` and `Compare`.
- Call `publishForm(formId, { versionLabel: versionLabel || null })`.
- Add `CompareDialog`.
- Render `FormRuntime` in a Preview panel/tab against current `schema`.
- Include `VisibilityRuleEditor` and `ValueSetBindingEditor` in `PropertiesSheet`.

- [ ] **Step 6: Upgrade runtime for repeated sections if builder emits them**

If `section.repeats` is editable, update `FormRuntime` to render repeated sections with add/remove controls. Add a test:

```tsx
expect(screen.getByRole('button', { name: /add section/i })).toBeInTheDocument();
```

Do not expose section-level `repeats` editing in the properties sheet in this slice. Keep field-level repeats enabled because `FormRuntime` supports repeating fields. Section-level repeat support can be planned later with a dedicated runtime data model.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @openldr/web test FormBuilderPage FormRuntime && pnpm --filter @openldr/web typecheck`

Expected: PASS and clean typecheck.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/forms-builder apps/web/src/forms-runtime
git -c commit.gpgsign=false commit -m "feat(web): add form builder publish preview and compare"
```

---

## Task 11: Forms List Lifecycle Actions And Import/Export Polish

**Files:**
- Modify: `apps/web/src/pages/Forms.tsx`
- Modify: `apps/web/src/pages/Forms.test.tsx`

- [ ] **Step 1: Add failing Forms list action test**

Extend `Forms.test.tsx`:

```tsx
it('navigates to builder and duplicates forms from row actions', async () => {
  const duplicateSpy = vi.spyOn(api, 'duplicateForm').mockResolvedValue({ ...form, id: 'form-2', name: 'Specimen intake copy', schema: importedSchema, targetPages: ['forms'], createdAt: form.updatedAt });
  render(<MemoryRouter><Forms /></MemoryRouter>);
  expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByText('Duplicate'));
  await waitFor(() => expect(duplicateSpy).toHaveBeenCalledWith('form-1'));
});
```

- [ ] **Step 2: Implement list actions**

Modify `Forms.tsx`:

- Import `duplicateForm` and `publishForm`.
- Add `Edit builder`, `Duplicate`, `Compare`, and `Publish` menu items.
- Add `navigate('/forms/new')` to **New form**.
- Use `duplicateForm` to insert returned copy into rows.
- Use `publishForm` for publish instead of status when available.
- Keep archive using `setFormStatus(form.id, 'archived')`.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @openldr/web test Forms && pnpm --filter @openldr/web typecheck`

Expected: PASS and clean typecheck.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/Forms.tsx apps/web/src/pages/Forms.test.tsx
git -c commit.gpgsign=false commit -m "feat(web): wire form builder lifecycle list actions"
```

---

## Task 12: Browser/E2E Smoke For Create-To-Compare

**Files:**
- Create: `e2e/tests/forms-builder.spec.ts`
- Create: `e2e/tests/forms-builder.spec.ts`

- [ ] **Step 1: Write E2E smoke**

Create `e2e/tests/forms-builder.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { baseURL } from '../support/config';

test('creates, publishes, edits, compares, and runs a form', async ({ page }) => {
  await page.goto(`${baseURL}/forms`);
  await page.getByRole('button', { name: 'New form' }).click();
  await expect(page.getByRole('textbox', { name: 'Form name' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Form name' }).fill('Builder smoke form');
  await page.getByRole('button', { name: 'Add string field' }).click();
  await page.getByText('New string field').click();
  await page.getByLabel('Field label').fill('Patient ID');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByLabel('Field label').fill('Patient identifier');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByText(/Field changed|Published version/)).toBeVisible();
});
```

- [ ] **Step 2: Run focused e2e**

Run: `pnpm --filter @openldr/e2e e2e -- tests/forms-builder.spec.ts`

Expected: PASS. If the existing e2e package requires a built server first, run:

```bash
pnpm turbo build --filter=@openldr/web --filter=@openldr/server
pnpm --filter @openldr/e2e e2e -- tests/forms-builder.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/forms-builder.spec.ts e2e/README.md
git -c commit.gpgsign=false commit -m "test(e2e): cover form builder create to compare flow"
```

---

## Task 13: Final Gates And Documentation Touches

**Files:**
- Modify: `apps/web/src/docs/0.1.0/en/overview.md` or `apps/web/src/docs/0.1.0/en/getting-started.md` only if the docs currently mention forms import as the only path.
- Modify: `openldr-ce-phase1-phase2-status-and-loe.md` only if the user asks to update status after implementation.

- [ ] **Step 1: Run focused package gates**

Run:

```bash
pnpm --filter @openldr/db test
pnpm --filter @openldr/forms test
pnpm --filter @openldr/server test forms-routes
pnpm --filter @openldr/web test
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typechecks and builds**

Run:

```bash
pnpm --filter @openldr/db typecheck
pnpm --filter @openldr/forms typecheck
pnpm --filter @openldr/server typecheck
pnpm --filter @openldr/web typecheck
pnpm --filter @openldr/server build
pnpm --filter @openldr/web build
```

Expected: clean typecheck and successful builds.

- [ ] **Step 3: Run broader gates**

Run:

```bash
pnpm depcruise
pnpm turbo test --filter=@openldr/forms --filter=@openldr/server --filter=@openldr/web
```

Expected: dependency cruiser passes and scoped turbo tests pass.

- [ ] **Step 4: Browser verification**

Start the app in the repo's standard way, then verify:

1. Forms list opens.
2. **New form** opens builder.
3. Add a field and section.
4. Bind a ValueSet with seeded terminology if available.
5. Preview renders the field.
6. Save draft.
7. Publish.
8. Edit the draft.
9. Compare shows at least one grouped change.
10. Export Questionnaire returns FHIR Questionnaire JSON.
11. Run/capture the published form.

- [ ] **Step 5: Commit final docs or cleanup**

If documentation files changed:

```bash
git add apps/web/src/docs openldr-ce-phase1-phase2-status-and-loe.md
git -c commit.gpgsign=false commit -m "docs: update form builder operator docs"
```

When no documentation files changed, record the final verification output in the final response instead of creating a documentation commit.

---

## Done Criteria

- [ ] `form_versions` migration exists and is typed.
- [ ] Store supports publish, duplicate, list versions, and get version.
- [ ] Server exposes publish, duplicate, and version routes.
- [ ] Forms list enables new builder and lifecycle actions.
- [ ] Builder has Corlix-like three-pane layout.
- [ ] Builder supports add/edit/delete/reorder sections and fields.
- [ ] Builder supports search, multi-select, bulk actions, shortcuts, and undo/redo.
- [ ] Builder supports visibility, repeats that runtime can run, i18n labels, FHIR mapping, and terminology binding.
- [ ] Preview and capture share runtime rendering/validation logic.
- [ ] Publish is gated by lint errors.
- [ ] Compare dialog shows grouped draft-vs-version changes.
- [ ] Existing imports and Questionnaire export still work.
- [ ] Focused unit/component/route tests pass.
- [ ] Browser/E2E create-to-compare smoke passes.
