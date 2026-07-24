# Documentation QuestionnaireResponse — CE ingest + projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CE persist documentation data delivered as FHIR `QuestionnaireResponse` and project it into a queryable `questionnaire_responses` read table, alongside the existing lab read model.

**Architecture:** A `QuestionnaireResponse` already passes CE structural validation and (not being a lab result) escapes the only clinical rule, so it lands in the canonical `fhir` store with zero ingest changes. The gap is the read model: `projectResource` returns `null` for it. This plan adds a validation-contract regression guard, an external read table + type, and a projector that routes `QuestionnaireResponse` into it.

**Tech Stack:** TypeScript, Kysely (Postgres/MSSQL/MySQL), Vitest. Spec: `docs/superpowers/specs/2026-07-24-documentation-questionnaireresponse-ce-ingest-design.md`.

## Global Constraints

- Provenance columns (`source_system`, `plugin_id`, `plugin_version`, `batch_id`) are REQUIRED on every read-model row and come from `provColumns(prov)` — never defaulted silently.
- External migrations are engine-aware: one definition emits valid DDL for `postgres` | `mssql` | `mysql` via the `dialect.ts` helpers and the `withCommon` pattern.
- Read-model tables use FHIR ids as text primary keys, no enforced foreign keys (soft references via `referenceId`).
- `items` is stored as a **JSON string in a text column** (portable across all three engines) — the projector `JSON.stringify`s, readers `JSON.parse`.
- Commit after each task. No `Co-Authored-By` trailer.

---

### Task 1: Validation-contract regression guard

Pin the behavior the whole approach relies on: a `QuestionnaireResponse` passes `validateBatch` at strictness `high` (structural OK, lab-result rule N/A). This is a guard only — no production code changes.

**Files:**
- Test: `packages/fhir/src/validate-batch.test.ts` (add cases)

**Interfaces:**
- Consumes: `validateBatch(resources, { level, resolveServiceRequest })` from `./validate-batch`.
- Produces: nothing (test-only).

- [ ] **Step 1: Add the failing test**

Append to `packages/fhir/src/validate-batch.test.ts`:

```ts
describe('QuestionnaireResponse (documentation) is not a lab result', () => {
  const qr = {
    resourceType: 'QuestionnaireResponse',
    id: 'qr1',
    status: 'completed',
    questionnaire: 'urn:openldr:form:hiv_vl_documentation',
    subject: { reference: 'Patient/p1' },
    authored: '2026-01-01T00:00:00+02:00',
    item: [{ linkId: 'VL_REASON', text: 'VL reason', answer: [{ valueString: 'Routine monitoring' }] }],
  };

  it('passes at high with no basedOn / ServiceRequest', async () => {
    const r = await validateBatch([qr], { level: 'high', resolveServiceRequest: async () => false });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it passes already (guard, not a fix)**

Run: `pnpm --filter @openldr/fhir test validate-batch`
Expected: PASS (documents/locks the contract). If it FAILS, stop — the approach's premise is broken and the spec must be revisited.

- [ ] **Step 3: Commit**

```bash
git add packages/fhir/src/validate-batch.test.ts
git commit -m "test(fhir): pin that a documentation QuestionnaireResponse validates at high"
```

---

### Task 2: External `questionnaire_responses` table — type + migration

**Files:**
- Modify: `packages/db/src/schema/external.ts` (add table interface, `ExternalSchema` entry, `EXTERNAL_TABLE_COLUMNS` entry)
- Create: `packages/db/src/migrations/external/009_questionnaire_responses.ts`
- Modify: `packages/db/src/migrations/external/index.ts` (register `009`)

**Interfaces:**
- Produces: `QuestionnaireResponsesTable` interface; external table `questionnaire_responses` with columns `id, questionnaire, form_code, subject_id, authored, based_on_id, items` + provenance.

- [ ] **Step 1: Add the table type + column list**

In `packages/db/src/schema/external.ts`, after `DiagnosticReportsTable`:

```ts
export interface QuestionnaireResponsesTable extends ProvenanceColumns {
  id: string;
  questionnaire: string | null;
  form_code: string | null;
  subject_id: string | null;
  authored: string | null;
  based_on_id: string | null;
  /** JSON string of the QuestionnaireResponse.item[] array (linkId/text/answer). */
  items: string | null;
}
```

Add to `ExternalSchema`:

```ts
  questionnaire_responses: QuestionnaireResponsesTable;
```

Add to `EXTERNAL_TABLE_COLUMNS`:

```ts
  questionnaire_responses: ['id', 'questionnaire', 'form_code', 'subject_id', 'authored', 'based_on_id', 'items', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
```

- [ ] **Step 2: Write the migration**

Create `packages/db/src/migrations/external/009_questionnaire_responses.ts` (mirrors `003_v2_core.ts`'s `withCommon`):

```ts
import { type Kysely, type CreateTableBuilder, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, timestampType, nowExpr } from './dialect';

function withCommon(b: CreateTableBuilder<string, never>, engine: TargetEngine): CreateTableBuilder<string, never> {
  const text = sql.raw(textType(engine));
  let built = b
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  return engine === 'postgres' ? built.ifNotExists() : built;
}

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  await withCommon(
    db.schema.createTable('questionnaire_responses').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('questionnaire', text)
      .addColumn('form_code', text)
      .addColumn('subject_id', text)
      .addColumn('authored', text)
      .addColumn('based_on_id', text)
      .addColumn('items', text),
    engine,
  ).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('questionnaire_responses').ifExists().execute();
}
```

- [ ] **Step 3: Register the migration**

In `packages/db/src/migrations/external/index.ts`, add the import after `m008`:

```ts
import * as m009 from './009_questionnaire_responses';
```

and inside the returned record after `'008_patients_merge'`:

```ts
    '009_questionnaire_responses': { up: (db) => m009.up(db, engine), down: m009.down },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @openldr/db typecheck`
Expected: Done (no errors).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/external.ts packages/db/src/migrations/external/009_questionnaire_responses.ts packages/db/src/migrations/external/index.ts
git commit -m "feat(db): questionnaire_responses read table + migration"
```

---

### Task 3: `projectQuestionnaireResponse` + wire into the router

**Files:**
- Create: `packages/db/src/relational/questionnaire-response.ts`
- Modify: `packages/db/src/relational/index.ts` (import, export, add `case` to `projectResource` and `tableForResourceType`)
- Test: `packages/db/src/relational/questionnaire-response.test.ts`

**Interfaces:**
- Consumes: `provColumns`, `referenceId`, `str` from `./extract`; `Provenance`; `QuestionnaireResponsesTable` from `../schema/external`.
- Produces: `projectQuestionnaireResponse(r: Record<string, unknown>, prov: Provenance): Insertable<QuestionnaireResponsesTable>`; `projectResource` returns `{ table: 'questionnaire_responses', row }` for `QuestionnaireResponse`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/relational/questionnaire-response.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectQuestionnaireResponse } from './questionnaire-response';
import { projectResource } from './index';

const qr = {
  resourceType: 'QuestionnaireResponse',
  id: 'qr1',
  status: 'completed',
  questionnaire: 'urn:openldr:form:hiv_vl_documentation',
  subject: { reference: 'Patient/p1' },
  authored: '2026-01-01T00:00:00+02:00',
  basedOn: [{ reference: 'ServiceRequest/req1-obr1' }],
  item: [{ linkId: 'VL_REASON', text: 'VL reason', answer: [{ valueString: 'Routine' }] }],
};

describe('projectQuestionnaireResponse', () => {
  it('maps a QR into a questionnaire_responses row', () => {
    const row = projectQuestionnaireResponse(qr, { sourceSystem: 'disa', batchId: 'b1' });
    expect(row).toMatchObject({
      id: 'qr1',
      questionnaire: 'urn:openldr:form:hiv_vl_documentation',
      form_code: 'hiv_vl_documentation',
      subject_id: 'p1',
      authored: '2026-01-01T00:00:00+02:00',
      based_on_id: 'req1-obr1',
      source_system: 'disa',
      batch_id: 'b1',
    });
    expect(JSON.parse(row.items!)).toEqual(qr.item);
  });

  it('documentation-only QR has null based_on_id', () => {
    const { basedOn, ...noBasedOn } = qr;
    const row = projectQuestionnaireResponse(noBasedOn, {});
    expect(row.based_on_id).toBeNull();
  });

  it('projectResource routes QuestionnaireResponse to questionnaire_responses', () => {
    const p = projectResource(qr, {});
    expect(p?.table).toBe('questionnaire_responses');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/db test questionnaire-response`
Expected: FAIL ("projectQuestionnaireResponse" is not exported / module not found).

- [ ] **Step 3: Write the projector**

Create `packages/db/src/relational/questionnaire-response.ts`:

```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { QuestionnaireResponsesTable } from '../schema/external';
import { provColumns, referenceId, str } from './extract';

/** `urn:openldr:form:hiv_vl_documentation` -> `hiv_vl_documentation`; passes other
 *  canonical shapes through as-is (last path/colon segment). Null when absent. */
function formCode(questionnaire: unknown): string | null {
  const q = str(questionnaire);
  if (q === null) return null;
  const afterColon = q.includes(':') ? q.slice(q.lastIndexOf(':') + 1) : q;
  return afterColon.length > 0 ? afterColon : null;
}

export function projectQuestionnaireResponse(
  r: Record<string, unknown>,
  prov: Provenance,
): Insertable<QuestionnaireResponsesTable> {
  const items = r['item'];
  return {
    id: String(r['id']),
    questionnaire: str(r['questionnaire']),
    form_code: formCode(r['questionnaire']),
    subject_id: referenceId(r['subject']),
    authored: str(r['authored']),
    based_on_id: referenceId((r['basedOn'] as unknown[] | undefined)?.[0]),
    items: Array.isArray(items) ? JSON.stringify(items) : null,
    ...provColumns(prov),
  };
}
```

- [ ] **Step 4: Wire it into the router**

In `packages/db/src/relational/index.ts`:

Add import after the diagnostic-report import:

```ts
import { projectQuestionnaireResponse } from './questionnaire-response';
```

Add export after the diagnostic-report export:

```ts
export * from './questionnaire-response';
```

Add a `case` in `projectResource` (before `default`):

```ts
    case 'QuestionnaireResponse': return { table: 'questionnaire_responses', row: projectQuestionnaireResponse(r, prov) };
```

Add a `case` in `tableForResourceType` (before `default`):

```ts
    case 'QuestionnaireResponse': return 'questionnaire_responses';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/db test questionnaire-response`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @openldr/db typecheck`
Expected: Done.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/relational/questionnaire-response.ts packages/db/src/relational/questionnaire-response.test.ts packages/db/src/relational/index.ts
git commit -m "feat(db): project QuestionnaireResponse into questionnaire_responses"
```

---

### Task 4: End-to-end projection check (write → read via a migrated DB)

Prove the full path: a `QuestionnaireResponse` written through the relational writer lands as a row in the migrated `questionnaire_responses` table. Reuses the existing external-migration round-trip test harness.

**Files:**
- Test: `packages/db/src/relational/questionnaire-response.roundtrip.test.ts` (follows the pattern of `packages/db/src/migrations/external/reset-roundtrip-live.test.ts` — gated on a live PG test DB the same way; skip if that infra marker is absent).

**Interfaces:**
- Consumes: `createRelationalWriter(db, 'postgres')` from `../relational-writer`; `externalMigrations` from `../migrations/external`.

- [ ] **Step 1: Write the test (mirrors the existing live round-trip guard)**

```ts
import { describe, it, expect } from 'vitest';
// Reuse the SAME live-DB bootstrap helper reset-roundtrip-live.test.ts uses
// (migrate an external schema against the configured test PG). If that test is
// skipped in this environment, skip here too — do not invent a new harness.
import { createRelationalWriter } from '../relational-writer';

describe.skipIf(!process.env.TEST_EXTERNAL_DATABASE_URL)('QuestionnaireResponse round-trip', () => {
  it('writes a QR and reads it back from questionnaire_responses', async () => {
    // 1. migrate external schema (externalMigrations('postgres')) against TEST db
    // 2. const writer = createRelationalWriter(db, 'postgres')
    // 3. await writer.write(qr, { sourceSystem: 'disa', batchId: 'b1' })
    // 4. select * from questionnaire_responses where id = 'qr1'
    // 5. expect row.form_code === 'hiv_vl_documentation'
    //    expect JSON.parse(row.items).length === 1
  });
});
```

Fill the body using the exact migrate/connect helpers from `reset-roundtrip-live.test.ts` (copy its setup verbatim; only the resource + assertions differ).

- [ ] **Step 2: Run it**

Run: `pnpm --filter @openldr/db test questionnaire-response.roundtrip`
Expected: PASS if `TEST_EXTERNAL_DATABASE_URL` is set; otherwise SKIPPED (reported, not failed).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/relational/questionnaire-response.roundtrip.test.ts
git commit -m "test(db): round-trip QuestionnaireResponse through questionnaire_responses"
```

---

## Self-Review

- **Spec coverage:** ingest contract (Task 1 guard) ✓; `questionnaire_responses` table + columns (Task 2) ✓; projector + router wiring (Task 3) ✓; `items` as jsonb-in-text, `Questionnaire` not projected, `based_on_id` nullable — all covered ✓; end-to-end read (Task 4) ✓.
- **Placeholders:** Task 4 intentionally defers to the existing live-DB harness rather than inventing one — the setup lines are copied from a named existing test, not left as "TODO".
- **Type consistency:** `projectQuestionnaireResponse` signature, `QuestionnaireResponsesTable` columns, and the `questionnaire_responses` DDL columns all match across Tasks 2–3.
