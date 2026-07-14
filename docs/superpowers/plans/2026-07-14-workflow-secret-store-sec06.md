# Workflow Secret Store (SEC-06) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove cleartext workflow secrets from the persisted definition — on save, seal each secret (webhook trigger `secret` + HTTP auth headers) into an encrypted `workflow_secrets` store and replace it with an opaque `{secretRef}`; resolve refs only at use (webhook verify / HTTP node); proactively migrate existing plaintext secrets at boot. Fail-closed without `SECRETS_ENCRYPTION_KEY`, matching connectors.

**Architecture:** A `workflow_secrets` table + `createWorkflowSecretStore(db)` (seal/open via `@openldr/core`, the connector-store pattern). A shared secret-field locator (factored from the existing `redactWorkflowSecrets`). Save-time extraction (string→ref) in the workflow create/update path, with orphan GC + delete-cascade. Runtime resolution via injected resolvers (`@openldr/workflows` stays crypto-free — the S1 injected-decrypt pattern). A boot-time idempotent migration. Write-only/masked studio forms.

**Tech Stack:** TypeScript, Kysely, `@openldr/core` `seal`/`open`, Fastify, Zod, React+shadcn, Vitest + pg-mem.

**Spec:** `docs/superpowers/specs/2026-07-14-workflow-secret-store-sec06-design.md`

**Key substrate to read first (all exist):**
- `apps/server/src/workflows-routes.ts` — `redactWorkflowSecrets` + `AUTH_HEADER_RE` (`:64-88`, the secret-field knowledge to factor), the create/update/delete/list/detail routes (`ctx.workflows.store.create/update/get/list`, `MANAGE` role gate), `syncWorkflowTriggers`, `secretEquals` (SEC-07 verify), the webhook POST handler.
- `packages/workflows/src/webhook-registry.ts` — `createWebhookRegistry()`, `sync(workflowId, nodes)` (reads `node.data.secret`), `WebhookEntry { workflowId, secret }`, `resolve/register/clear`.
- `packages/workflows/src/types.ts` — `WorkflowSchema`/`WorkflowDefinitionSchema` (the Zod schema for the node graph + `node.data`); a secret field must become `z.union([z.string(), z.object({ secretRef: z.string() })])`.
- `packages/workflows/src/engine/services.ts:101` — `resolveSecret?({ connectorId, key })`; `packages/workflows/src/engine/node-handlers/http.ts` — header consumption.
- `packages/db/src/connector-store.ts` — THE model: `keyOf(key)` (`parseSecretKey`), `seal(JSON.stringify(cfg), keyOf(key))`, `open(...)`, fail-closed `ConfigError('SECRETS_ENCRYPTION_KEY is required…')`, `config_encrypted` excluded from list. `@openldr/core` `crypto.ts` exports `seal`/`open`/`parseSecretKey`; `ConfigError` from `@openldr/core`.
- `packages/bootstrap/src/index.ts` — `ctx.workflows = { store, runs, schedules, webhooks, runner, services, datasets, listeners }` (`:662`); `createWebhookRegistry()` (`:472`); `resolveSecret` wiring (`:634`, `connectorStore.getDecryptedConfig(id, cfg.SECRETS_ENCRYPTION_KEY)`); `cfg.SECRETS_ENCRYPTION_KEY`. Add `secretStore` to `ctx.workflows`.
- `packages/db/src/migrations/internal/` (latest `052_sync_site_keys`; add `053`) + `schema/internal.ts` + `migrations/migrations.test.ts` (snapshot).
- The sync boot-migration model: `packages/bootstrap/src/sync-settings-migrate.ts` `migrateLegacySyncConfig` (idempotent, best-effort, key-injected, can't-crash-boot) — mirror for the workflow-secret migration.
- Studio: `apps/studio/src/workflows/components/node-forms/` (the webhook-trigger form + HTTP-node header form), `apps/studio/src/api.ts` (workflow types mirror), i18n en/fr/pt.

**Global rules:** `pnpm --filter`/`pnpm exec`, never raw `node_modules/.bin`. NEVER a `Co-Authored-By` trailer. Windows: per-package `tsc --noEmit`/`vitest run` directly (never pipe turbo through `tail`). shadcn-only studio UI; en/fr/pt for new strings.

---

## Task 0: Cut the branch
- [ ] `git checkout main && git checkout -b feat/workflow-secret-store && git branch --show-current` → `feat/workflow-secret-store`, clean tree.

---

## Task 1: `workflow_secrets` store — migration + store + AppContext

**Files:** Create `packages/db/src/migrations/internal/053_workflow_secrets.ts` + register; Modify `packages/db/src/schema/internal.ts`, `migrations/migrations.test.ts`; Create `packages/db/src/workflow-secret-store.ts` + test; export from the `@openldr/db` barrel; Modify `packages/bootstrap/src/index.ts` (wire `ctx.workflows.secretStore`).

- [ ] **Step 1: migration `053_workflow_secrets`** (register `'053_workflow_secrets'`, mirror `051`/`052`):
```ts
import { type Kysely, sql } from 'kysely';
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable('workflow_secrets')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('workflow_id', 'text', (c) => c.notNull())
    .addColumn('sealed_value', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('workflow_secrets_workflow_id_idx').on('workflow_secrets').column('workflow_id').execute();
}
export async function down(db: Kysely<any>): Promise<void> { await db.schema.dropTable('workflow_secrets').execute(); }
```
Add `WorkflowSecretsTable` to `InternalSchema` (`id/workflow_id/sealed_value: string`, `created_at: Generated<Date>`). Append `'053_workflow_secrets'` to the snapshot.

- [ ] **Step 2: store (`packages/db/src/workflow-secret-store.ts`)** — model on `connector-store.ts` (reuse its `keyOf` idiom):
```ts
import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seal, open, parseSecretKey, ConfigError } from '@openldr/core';
import type { InternalSchema } from './schema/internal';

function keyOf(key: string | undefined): Buffer {
  if (!key) throw new ConfigError('SECRETS_ENCRYPTION_KEY is required to store workflow secrets but is not set');
  return parseSecretKey(key);
}

export interface WorkflowSecretStore {
  put(workflowId: string, plaintext: string, key: string | undefined): Promise<string>;   // → 'wsec_<uuid>'
  resolve(id: string, key: string | undefined): Promise<string>;                            // → plaintext (throws on unknown/wrong key)
  deleteForWorkflow(workflowId: string): Promise<void>;
  deleteExcept(workflowId: string, keepIds: string[]): Promise<void>;                        // orphan GC
}

export function createWorkflowSecretStore(db: Kysely<InternalSchema>): WorkflowSecretStore {
  return {
    async put(workflowId, plaintext, key) {
      const id = `wsec_${randomUUID()}`;
      await db.insertInto('workflow_secrets').values({ id, workflow_id: workflowId, sealed_value: seal(plaintext, keyOf(key)) }).execute();
      return id;
    },
    async resolve(id, key) {
      const r = await db.selectFrom('workflow_secrets').select('sealed_value').where('id', '=', id).executeTakeFirst();
      if (!r) throw new ConfigError(`workflow secret not found: ${id}`);
      return open(r.sealed_value, keyOf(key));
    },
    async deleteForWorkflow(workflowId) { await db.deleteFrom('workflow_secrets').where('workflow_id', '=', workflowId).execute(); },
    async deleteExcept(workflowId, keepIds) {
      let q = db.deleteFrom('workflow_secrets').where('workflow_id', '=', workflowId);
      if (keepIds.length) q = q.where('id', 'not in', keepIds);
      await q.execute();
    },
  };
}
```
Export from the `@openldr/db` barrel. NO plaintext column; sealed value never returned except via `resolve`.

- [ ] **Step 3: tests (`workflow-secret-store.test.ts`, pg-mem)** — put→resolve round-trip; `resolve` unknown id → throws; wrong key → throws (`open` fails); `put`/`resolve` with `key=undefined` → `ConfigError('SECRETS_ENCRYPTION_KEY is required…')` (fail-closed); `deleteForWorkflow` removes all; `deleteExcept(wf, [keep])` removes the rest. Migration `053` column test.
- [ ] **Step 4: wire `ctx.workflows.secretStore`** — `const workflowSecrets = createWorkflowSecretStore(internal.db);` and add `secretStore: workflowSecrets` to the `ctx.workflows = {…}` object (`index.ts:662`) + the `AppContext` type (`:287-291`). Update any partial-ctx stub.
- [ ] **Step 5:** typecheck (`@openldr/db` + `@openldr/bootstrap`) + tests. Commit `feat(workflows): encrypted workflow_secrets store (SEC-06)`.

---

## Task 2: Shared secret-field locator + schema

**Files:** Create `packages/workflows/src/secret-fields.ts` + test; Modify `packages/workflows/src/types.ts` (schema); Modify `apps/server/src/workflows-routes.ts` (`redactWorkflowSecrets` uses the locator).

- [ ] **Step 1: locator (`secret-fields.ts`)** — factor the field knowledge from `redactWorkflowSecrets` into one place. A secret VALUE is `string` (plaintext) or `{ secretRef: string }`.
```ts
export const AUTH_HEADER_RE = /^(authorization|proxy-authorization|cookie|x-api-key|x-.*-token)$/i;
export type SecretValue = string | { secretRef: string };
export function isSecretRef(v: unknown): v is { secretRef: string } {
  return !!v && typeof v === 'object' && typeof (v as { secretRef?: unknown }).secretRef === 'string';
}
/** Visit every secret-bearing field location in a definition. `set(newValue)` replaces it in place
 *  (returns a NEW definition; do not mutate the input). Locations: node.data.secret (webhook triggers),
 *  and each AUTH_HEADER_RE-matching key in node.data.headers. */
export interface SecretFieldRef { value: unknown; path: string; set(v: SecretValue | undefined): void; }
export function mapSecretFields(definition: unknown, fn: (f: SecretFieldRef) => void): unknown;
```
Implement `mapSecretFields` to deep-clone the definition, walk `def.nodes[].data`, expose each secret field with a `set` that writes into the clone, call `fn`, return the clone. (A read-only `forEachSecretField` variant is also handy for the migration/tests.)
- [ ] **Step 2: schema (`types.ts`)** — the webhook trigger `secret` and header values must accept `string | { secretRef: string }`. Change the relevant Zod fields to `z.union([z.string(), z.object({ secretRef: z.string() }).strict()])` (headers: `z.record(z.union([z.string(), secretRefSchema]))`). Keep it permissive enough that the builder can send a plaintext string (new value) OR a ref (unchanged). Export a `secretRefSchema`.
- [ ] **Step 3:** repoint `redactWorkflowSecrets` (`workflows-routes.ts`) to use `mapSecretFields` (a ref value → leave as-is [already safe]; a plaintext string → mask/remove as today). This keeps redaction as belt-and-suspenders with ZERO field-knowledge drift.
- [ ] **Step 4: tests (`secret-fields.test.ts`)** — locator finds `node.data.secret` + auth headers, ignores non-secret headers/fields, handles string vs ref values, `set` produces a new definition without mutating the input; `isSecretRef` true/false. Schema accepts both string + ref for the fields.
- [ ] **Step 5:** typecheck (`@openldr/workflows` + `@openldr/server`) + tests. Commit `feat(workflows): shared secret-field locator + secretRef schema (SEC-06)`.

**Gotcha:** `mapSecretFields` MUST NOT mutate the caller's definition (the route reuses it); deep-clone first.

---

## Task 3: Save-time extraction (string → ref) + GC + delete-cascade

**Files:** Modify `apps/server/src/workflows-routes.ts` (create/update/delete); a helper `extractWorkflowSecrets(ctx, workflowId, definition)`; test.

- [ ] **Step 1: extraction helper** — before persisting on create/update:
```ts
async function extractWorkflowSecrets(ctx: AppContext, workflowId: string, definition: unknown): Promise<unknown> {
  const key = ctx.cfg.SECRETS_ENCRYPTION_KEY;
  const kept: string[] = [];
  const out = await mapSecretFieldsAsync(definition, async (f) => {   // async variant (put is async)
    if (isSecretRef(f.value)) { kept.push(f.value.secretRef); return; }        // unchanged → keep
    if (typeof f.value === 'string' && f.value.length > 0) {
      const id = await ctx.workflows.secretStore.put(workflowId, f.value, key); // seals; fail-closed if no key
      kept.push(id); f.set({ secretRef: id });
    } else { f.set(undefined); }                                               // empty → drop
  });
  await ctx.workflows.secretStore.deleteExcept(workflowId, kept);              // GC orphans
  return out;
}
```
(Add an `mapSecretFieldsAsync` variant to `secret-fields.ts`, or make `mapSecretFields` support an async visitor. `f.set(undefined)` should delete the field.) NOTE the ordering: for CREATE, the workflow id must exist before `put` — generate/resolve the id first (the store `.create` may assign it; if the id is server-assigned, either create the row first then extract+update, or mint the id before create — pick the approach that fits `ctx.workflows.store.create`'s contract; a two-step create-then-extract-update is acceptable and simplest).

- [ ] **Step 2: wire into the routes** — in the POST (create) and PUT (update) handlers, replace `ctx.workflows.store.create/update(WorkflowSchema.parse(req.body))` with: parse → `const def = await extractWorkflowSecrets(ctx, id, parsed.definition)` → persist the workflow with `def`. On the DELETE route → `await ctx.workflows.secretStore.deleteForWorkflow(id)` after the store delete. Map the fail-closed `ConfigError` → a clear 400/500 with the "SECRETS_ENCRYPTION_KEY required" message (a workflow with a secret can't be saved without a key).

- [ ] **Step 3: tests** (`app.inject` + a real pg-mem `secretStore`): save a workflow with a plaintext webhook secret + an `authorization` header → the PERSISTED definition (read from the store) contains ONLY `{secretRef}` values (assert `JSON.stringify(stored)` contains NO cleartext secret); the `workflow_secrets` store holds the sealed values; resave with the SAME refs (unchanged) → no new store rows, same refs; change a secret's value → a new ref + the old row GC'd (`deleteExcept`); delete the workflow → its secrets cascade; save with a secret + `SECRETS_ENCRYPTION_KEY` unset → fail-closed error (no partial write). 
- [ ] **Step 4:** typecheck (`@openldr/server`) + tests. Commit `feat(workflows): seal definition secrets into the store on save (SEC-06)`.

**Gotcha:** the persisted definition must be the ref version; a partial failure (some secrets put, then a later error) should not leave a half-extracted definition persisted — extract fully into the returned clone FIRST, then persist once (the code above does this: `out` is built, then the workflow is saved with it).

---

## Task 4: Runtime resolution (webhook registry + HTTP node)

**Files:** Modify `packages/workflows/src/webhook-registry.ts` (injected `resolveRef`); Modify the HTTP node header resolution (`packages/workflows/src/engine/node-handlers/http.ts` + the engine `resolveSecret` seam in `services.ts`); Modify `packages/bootstrap/src/index.ts` (wire both resolvers). Tests.

- [ ] **Step 1: webhook registry** — `sync(workflowId, nodes)` gains an injected async resolver so a `{secretRef}` secret resolves to plaintext registered IN MEMORY (verify path unchanged). Make `sync` async and thread a `resolveRef?: (ref: string) => Promise<string | null>` (constructor-injected on `createWebhookRegistry({ resolveRef })`, or a param). For a `node.data.secret` that `isSecretRef` → `await resolveRef(ref)`; a legacy plaintext string → use directly; register the resolved plaintext. Update `WebhookEntry`/callers for the now-async `sync`.
- [ ] **Step 2: HTTP node header refs** — the engine already has `resolveSecret?({ connectorId, key })` (`services.ts:101`) for connectors. Add a sibling resolver for workflow secret refs (e.g. `resolveWorkflowSecret?(ref: string): Promise<string | undefined>`), and in `http.ts` resolve any header value that `isSecretRef` before the fetch. Keep `@openldr/workflows` crypto-free — the resolver is injected.
- [ ] **Step 3: bootstrap wiring** — construct `createWebhookRegistry({ resolveRef: (ref) => ctx.workflows.secretStore.resolve(ref, cfg.SECRETS_ENCRYPTION_KEY).catch(() => null) })`; wire `resolveWorkflowSecret` in `workflowServices` to `workflowSecrets.resolve(ref, cfg.SECRETS_ENCRYPTION_KEY)`. Confirm `syncWorkflowTriggers` (in `workflows-routes.ts`) awaits the now-async `webhooks.sync`.
- [ ] **Step 4: tests** — webhook registry `sync` resolves a ref → the entry holds the plaintext (a fake `resolveRef`); an incoming webhook with the correct token verifies through a ref end-to-end (`app.inject`, real secretStore); a legacy plaintext secret still verifies. HTTP node: a ref-valued auth header is resolved to the decrypted value before the fetch (assert via a fake fetch capturing headers). Keep the SEC-07 webhook tests green.
- [ ] **Step 5:** typecheck (`@openldr/workflows` + `@openldr/bootstrap` + `@openldr/server`) + tests. Commit `feat(workflows): resolve secret refs at webhook verify + HTTP node (SEC-06)`.

**Gotcha:** `webhooks.sync` becoming async ripples to every caller (create/update route, `syncWorkflowTriggers`, listener reconcile, bootstrap seed) — grep for `.webhooks.sync(`/`webhookRegistry.sync(` and await them all.

---

## Task 5: Boot-time migration of existing plaintext secrets

**Files:** Create `packages/bootstrap/src/workflow-secret-migrate.ts` + test; call it in `packages/bootstrap/src/index.ts` boot path (near `migrateLegacySyncConfig`).

- [ ] **Step 1: migration (`workflow-secret-migrate.ts`)** — mirror `migrateLegacySyncConfig` (idempotent, best-effort, key-injected, can't-crash-boot):
```ts
export async function migrateWorkflowSecrets(deps: {
  store: { list(): Promise<Array<{ id: string; definition: unknown }>>; update(id: string, patch: { definition: unknown }): Promise<unknown> };
  secretStore: WorkflowSecretStore; key: string | undefined; logger: Logger;
}): Promise<void> {
  if (!deps.key) { deps.logger.warn('workflow-secret migration skipped: SECRETS_ENCRYPTION_KEY unset'); return; }
  for (const w of await deps.store.list()) {
    try {
      let changed = false; const kept: string[] = [];
      const def = await mapSecretFieldsAsync(w.definition, async (f) => {
        if (isSecretRef(f.value)) { kept.push(f.value.secretRef); return; }
        if (typeof f.value === 'string' && f.value.length > 0) {
          const id = await deps.secretStore.put(w.id, f.value, deps.key); kept.push(id); f.set({ secretRef: id }); changed = true;
        }
      });
      if (changed) { await deps.secretStore.deleteExcept(w.id, kept); await deps.store.update(w.id, { definition: def }); }
    } catch (err) { deps.logger.warn({ err, workflowId: w.id }, 'workflow-secret migration: skipped one workflow'); }
  }
}
```
- [ ] **Step 2:** call it at boot in `index.ts` (best-effort `.catch`, like the sync migrate) AFTER the workflow store + secretStore are constructed. Then the webhook registry's initial `sync`/reconcile sees refs.
- [ ] **Step 3: tests** — a pre-seeded workflow with a plaintext secret → after migrate, the stored definition is refs + the store holds the sealed value + `resolve` returns the original plaintext; idempotent (re-run: no change, no new rows); no-key → skips + logs, no throw; a malformed workflow → logged + skipped, others still migrate.
- [ ] **Step 4:** typecheck (`@openldr/bootstrap`) + tests. Commit `feat(workflows): boot migration of existing plaintext secrets → sealed refs (SEC-06)`.

---

## Task 6: Studio builder — write-only/masked secret fields

**Files:** Modify the webhook-trigger form + HTTP-node header form in `apps/studio/src/workflows/components/node-forms/`; `apps/studio/src/api.ts` (workflow types); i18n en/fr/pt.

- [ ] **Step 1: api mirror** — the workflow definition type in `api.ts` now allows a secret field as `string | { secretRef: string }`. The detail fetch returns refs (server no longer returns plaintext).
- [ ] **Step 2: forms** — for the webhook `secret` input and any auth-header value: if the current value `isSecretRef` (or a `secretSet` marker), render a MASKED "secret is set — enter a new value to replace" state (like the connector secret / sync client secret UX). Typing a new value sends the plaintext string (→ sealed to a new ref on save); leaving it untouched sends the existing `{secretRef}` (→ preserved). A clear/replace affordance. shadcn primitives only.
- [ ] **Step 3: i18n** — add the masked/replace strings (e.g. `workflows.secretSet`, `workflows.replaceSecret`, `workflows.secretWriteOnlyHelp`) to en/fr/pt (real translations).
- [ ] **Step 4:** typecheck (`@openldr/studio`) + any studio test. Commit `feat(studio): write-only masked secret fields in workflow builder (SEC-06)`.

**Gotcha:** a manager editing an existing workflow must be able to save WITHOUT re-entering every secret — an untouched masked field must round-trip its `{secretRef}` unchanged (don't send an empty string, which would drop it).

---

## Task 7: Gate, live smoke, whole-slice review, merge, push

- [ ] **Live smoke** (a throwaway `pnpm exec tsx` script or extend a workflow acceptance): with a real internal DB + `SECRETS_ENCRYPTION_KEY` set, create a workflow with a webhook secret + an auth header via the store/route path → read the PERSISTED definition and assert it contains ONLY `{secretRef}` (no cleartext) + the `workflow_secrets` rows are sealed; POST the webhook with the correct token → verifies (registry resolved the ref); seed a plaintext-secret workflow + run `migrateWorkflowSecrets` → becomes refs. Print `✅ workflow-secret smoke PASSED`, exit 0. Paste output.
- [ ] **Gate:** per-package `tsc --noEmit` + `vitest run` for `@openldr/db`, `@openldr/workflows`, `@openldr/bootstrap`, `@openldr/server`, `@openldr/studio` (never pipe turbo through `tail`; isolate known flakes). Re-run the SEC-07 webhook route tests + the workflow route tests — must not regress.
- [ ] **Whole-slice review** (fresh reviewer over `git diff main..HEAD`): the persisted definition contains ZERO cleartext secrets (refs only); the store seals via `SECRETS_ENCRYPTION_KEY` + fails closed without it; the secret-field locator is the SINGLE source (redaction + extraction + migration all use it, no drift); save extracts + GCs orphans + delete cascades; webhook verify + HTTP node resolve refs at use; the boot migration is idempotent + best-effort + key-guarded; the builder round-trips an untouched ref (doesn't drop it) and never receives plaintext from the detail endpoint; no `Co-Authored-By`.
- [ ] **Merge:** `git checkout main && git merge --no-ff feat/workflow-secret-store -m "Merge branch 'feat/workflow-secret-store': workflow secret store — SEC-06"`.
- [ ] **Push:** ask the user before `git push origin main`.
- [ ] **Update memory:** extend [[workflow-js-isolate-sec01]] or a new `workflow-secret-store-sec06` note — SEC-06 DONE (secrets sealed into `workflow_secrets`, refs in the definition, boot-migrated, write-only builder); **all 3 audit SEC sub-projects now complete** (SEC-01 isolate + SEC-06 secrets + the dep-bumps); note the remaining audit deferrals if any.

---

## Self-review notes

- **Spec coverage:** §1 store → T1; §2 locator+schema → T2; §3 save-extraction+GC+cascade → T3; §4 runtime resolution → T4; §5 boot migration → T5; §6 write-only builder → T6; §7 fail-closed → T1/T3; testing → each task + T7 smoke. All covered.
- **Ordering safety:** store (T1) before extraction (T3) + migration (T5) that call it; locator+schema (T2) before extraction/migration/forms that use them; runtime resolution (T4) so refs work at use before the migration flips existing data (T5 after T4 so a migrated ref is immediately resolvable); builder (T6) after the server contract is set; everything before the gate (T7).
- **Type consistency:** `WorkflowSecretStore` (put/resolve/deleteForWorkflow/deleteExcept) used by extraction + migration + resolvers; `SecretValue`/`isSecretRef`/`mapSecretFields`(+`Async`) shared across redaction/extraction/migration/http; `{secretRef}` schema shared server↔studio.
- **Security invariants (call out in review):** no cleartext at rest (persisted def = refs only); seal via SECRETS_ENCRYPTION_KEY + fail-closed; single locator (no field-knowledge drift); detail endpoint returns refs not plaintext; boot migration converts legacy plaintext.
- **Deliberate shortcuts (flagged):** only known secret fields covered (plugin-invented fields not); no key rotation/bulk re-seal; SQL not treated as secret; in-memory registry still holds resolved plaintext at runtime (at-rest is the fix); write-only builder (can't view a secret after save).
- **Plan-time unknowns to resolve during T1/T3/T4:** `ctx.workflows.store.create`'s id contract (server-assigned vs client-provided → create-then-extract-update vs mint-id-first); the exact `node.data` shape for webhook `secret` + headers in `types.ts`; every caller of `webhooks.sync` (now async) — grep + await all. Report what you used.
