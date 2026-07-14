# Workflow Secret Store (externalize at-rest secrets) — Design

**Date:** 2026-07-14
**Slice:** SEC-06 — remove cleartext workflow secrets from the persisted definition
**Branch:** `feat/workflow-secret-store` (to cut)
**Origin:** the SP-A2 marketplace security audit follow-up (`docs/audit/2026-06-25-phase4-security-audit.md`, SEC-06) + the 2026-07-14 marketplace state audit. Sibling of SEC-01 (workflow JS isolate, DONE). The intended fix is named in-code at `apps/server/src/workflows-routes.ts:59-62`.

## Context & the gap this closes

Workflow definitions are persisted as JSON (via `ctx.workflows.store.create/update`) and can embed secrets: the webhook trigger shared `secret` (`node.data.secret`) and HTTP auth `headers` (`authorization` / `proxy-authorization` / `cookie` / `x-api-key` / `x-*-token`, matched by `AUTH_HEADER_RE` in `workflows-routes.ts`). Post-SP-A2, defense-in-depth already exists: the LIST response redacts secrets (`redactWorkflowSecrets`), all workflow read/write is manager-role-gated (`requireRole('lab_admin','lab_manager')`), and the webhook verify is constant-time + header-only + strips forwarded auth headers (SEC-07). **But the secrets still sit CLEARTEXT AT REST** in the definition JSON — exposed to anyone with DB access, in backups/dumps/replication. The code comment (`workflows-routes.ts:59-62`) names the deferred proper fix: *"move secrets out of the definition into a server-side secret store referenced by opaque IDs."*

SEC-06 implements exactly that, for ALL secret-bearing fields (decided: webhook secret + HTTP auth headers), using the **connector pattern** the repo already proves: `@openldr/core` `seal()`/`open()` with `SECRETS_ENCRYPTION_KEY`, an encrypted store, opaque references, decrypt only at use, fail-closed without a key.

**Substrate facts (verify during implementation):**
- Persistence: `ctx.workflows.store` — `.list()` / `.get(id)` / `.create(WorkflowSchema.parse(body))` / `.update(id, …)` (`apps/server/src/workflows-routes.ts`). The workflow row carries `definition` (the node graph).
- Crypto: `@openldr/core` `crypto.ts` — `parseSecretKey(base64Key): Buffer`, `seal(plaintext, key): string`, `open(blob, key): string`. The connector store (`packages/db/src/connector-store.ts`) is the reference consumer (fail-closed when `SECRETS_ENCRYPTION_KEY` unset; `getDecryptedConfig` throws on wrong key).
- Engine secret seam: `packages/workflows/src/engine/services.ts:101` `resolveSecret?({ connectorId, key })`, wired in `packages/bootstrap/src/index.ts:634` via `connectorStore.getDecryptedConfig`. Extend this seam (or add a sibling) to resolve workflow `{secretRef}` values — `@openldr/workflows` stays crypto-key-free (the resolver is injected, the S1 injected-decrypt pattern).
- Webhook: `packages/workflows/src/webhook-registry.ts` — `sync(workflowId, nodes)` reads `node.data.secret` and registers `{ workflowId, secret }` IN MEMORY; the incoming-request verify uses `secretEquals` (constant-time) in `workflows-routes.ts`. The registry is in-memory, non-persisted.
- HTTP node: `packages/workflows/src/engine/node-handlers/http.ts` consumes `node.data.headers` at execution (guardedFetch).
- Redaction + field knowledge: `redactWorkflowSecrets` + `AUTH_HEADER_RE` (`workflows-routes.ts:64-88`) already enumerate the secret-bearing fields — the single source to factor a shared locator from.

## Scope (decided)

**In:** an encrypted `workflow_secrets` store; a shared secret-field locator; save-time extraction of ALL secret-bearing fields (webhook `secret` + auth `headers`) into refs; runtime resolution (webhook registry + HTTP node); a boot-time proactive migration of existing plaintext secrets; write-only/masked builder handling for these fields; fail-closed without `SECRETS_ENCRYPTION_KEY`.

**Out (deferred):** SQL embedded in definitions (not a secret — not extracted); master-key rotation / bulk re-seal; secret fields a third-party plugin node might invent beyond the known locator (documented — only the known fields are covered); per-secret access audit; sharing a secret across workflows (each workflow owns its secrets).

## Design

### 1. Encrypted secret store (`workflow_secrets`)
- **Migration** adds `workflow_secrets(id text primary key, workflow_id text not null, sealed_value text not null, created_at timestamptz not null default now())` (+ an index on `workflow_id` for GC/cascade). No plaintext column ever.
- **`createWorkflowSecretStore(db)`** (`packages/db/src/workflow-secret-store.ts`), modeled on `connector-store.ts`:
  - `put(workflowId, plaintext, key): Promise<string>` — mint `id = 'wsec_' + uuid`, `seal(plaintext, keyOf(key))`, insert, return `id`. **Fail-closed:** throws `SECRETS_ENCRYPTION_KEY is required…` when `key` is unset (mirrors the connector store).
  - `resolve(id, key): Promise<string>` — `open()` the sealed value; throws on wrong key / unknown id.
  - `deleteForWorkflow(workflowId)` and `deleteExcept(workflowId, keepIds[])` (orphan GC) — remove rows no longer referenced.
  - The sealed value NEVER leaves the store except via `resolve`.

### 2. Shared secret-field locator
Factor the field knowledge currently inside `redactWorkflowSecrets` into ONE exported helper (e.g. `packages/workflows/src/secret-fields.ts` `forEachSecretField(definition, visit)` / `mapSecretFields(definition, fn)`), yielding each secret-bearing location: `node.data.secret` (webhook triggers) and each `AUTH_HEADER_RE`-matching key in `node.data.headers`. Both the redaction (belt) and the new extraction/injection use this locator, so they cannot drift. A field's value is either a **plaintext string** (incoming from the builder) or a **`{ secretRef: string }`** (at rest).

### 3. Save-time extraction (string → ref) — in the create/update path
Wrap `ctx.workflows.store.create`/`update` (in `workflows-routes.ts`, or a thin `extractWorkflowSecrets(ctx, definition, workflowId)` helper called there). Using the locator, for each secret field:
- value is a **new plaintext string** → `store.put(workflowId, value, key)` → replace with `{ secretRef: id }`.
- value is **already `{secretRef}`** (unchanged) → keep as-is.
- value is empty/absent → leave absent.
After building the ref set, GC: `deleteExcept(workflowId, referencedIds)`. On workflow **delete** → `deleteForWorkflow`. The persisted definition then contains **zero secret material** (only refs). `WorkflowDefinitionSchema` (+ the studio mirror) must accept a secret field as `string | { secretRef: string }`. The existing `redactWorkflowSecrets` stays as belt-and-suspenders (a ref is already safe, but redaction of any stray plaintext is cheap insurance).

### 4. Runtime resolution
- **Webhook secret:** `webhookRegistry.sync(workflowId, nodes)` gains an injected `resolveRef(ref): Promise<string | null>`. For a `{secretRef}` value it resolves → plaintext and registers that **in memory** (unchanged verify path); a legacy plaintext value still registers directly (until the migration runs). Wire the resolver in bootstrap (`workflow_secrets.resolve` + the key). `@openldr/workflows` stays crypto-free.
- **HTTP auth headers:** extend the engine `resolveSecret` seam so a `{secretRef}` header value is resolved (decrypted) before the fetch; wire it in bootstrap to `workflowSecretStore.resolve`. The HTTP node handler resolves any ref-valued header at execution.

### 5. Existing-secret migration (boot-time, proactive)
A boot-time, idempotent, best-effort migration (mirrors the sync `migrateLegacySyncConfig` — runs at boot with the injected key, NOT a SQL migration which lacks the key): walk `ctx.workflows.store.list()`, and for any definition still holding a plaintext secret (a string in a locator field), `put()` it → rewrite the definition to a ref via `store.update`. Idempotent (a definition already all-refs is skipped). Best-effort + logged (a failure degrades to "that workflow's secret stays plaintext until next save" — never crashes boot). Skips cleanly (logs) when `SECRETS_ENCRYPTION_KEY` is unset.

### 6. Builder UX (write-only / masked)
Refs are opaque and never decrypted to the browser, so the builder is **write-only** for secret fields (like connectors / the sync client secret): the webhook-trigger form + HTTP-node header form show "secret is set" (masked) for a `{secretRef}` and let the manager type a NEW value to replace it (which becomes a new ref on save); leaving it blank/untouched preserves the existing ref. The detail endpoint returns refs (safe) — it no longer returns plaintext secrets. Studio api mirror + forms updated; new strings en/fr/pt.

### 7. Fail-closed
Saving a workflow that contains a NEW plaintext secret with `SECRETS_ENCRYPTION_KEY` unset returns a clear error (can't seal) — matching connectors. A workflow with no secrets, or only unchanged refs, saves fine.

## Testing

- **Store:** put→resolve round-trip; wrong key → throws; fail-closed (no key + put) → throws; `deleteForWorkflow`/`deleteExcept` GC.
- **Locator:** finds `node.data.secret` + auth headers; ignores non-secret fields; handles string vs ref values.
- **Extraction (route):** save a workflow with a plaintext webhook secret + an auth header → the STORED definition contains only `{secretRef}` (assert NO cleartext in the persisted JSON); resave unchanged (refs) → same refs, no new store rows; change a secret → new ref, old row GC'd; delete workflow → secrets cascade; save with a secret + no key → fail-closed error.
- **Runtime:** an incoming webhook with the correct token verifies through a ref (registry resolved it); an HTTP node with a ref-valued auth header sends the decrypted header.
- **Migration:** a pre-seeded workflow with a plaintext secret → after boot migration the stored definition is refs + the store holds the sealed value; idempotent on re-run; no-key → skips + logs, no crash.
- **Read surface:** the detail endpoint returns refs, never plaintext; LIST still redacts (belt).
- **Regression:** the SEC-07 webhook tests (constant-time/header-only/strip) + the existing workflow route tests stay green.

## Deliberate shortcuts / deferrals

- Only the KNOWN secret fields (webhook `secret`, `AUTH_HEADER_RE` headers) are extracted; a plugin node inventing a new secret field isn't covered (documented; the locator is the single place to extend).
- Master-key rotation / bulk re-seal is out of scope (a lost/rotated key means re-entering secrets, same as connectors).
- SQL in definitions is not treated as a secret.
- Write-only builder: a secret's value can't be viewed after saving, only replaced (intended, more secure).
- The in-memory webhook registry still holds the resolved plaintext in memory at runtime (unchanged from today; the fix is about AT-REST cleartext).

## Testing / build order (plan will detail)

1. `workflow_secrets` migration + `createWorkflowSecretStore` (seal/open, fail-closed, GC) + store tests; wire `ctx.workflows.secretStore`.
2. Shared secret-field locator (factor from `redactWorkflowSecrets`) + `string | {secretRef}` schema + tests.
3. Save-time extraction + GC + delete-cascade in the create/update/delete route path + tests.
4. Runtime resolution: webhook registry injected `resolveRef`; HTTP node header ref resolution (extend the engine `resolveSecret` seam) + bootstrap wiring + tests.
5. Boot-time migration of existing plaintext secrets (idempotent, key-injected, best-effort) + tests.
6. Studio builder write-only/masked forms (webhook trigger + HTTP headers) + api mirror + i18n.
7. Gate (workflows/db/bootstrap/server/studio) + a live smoke (save a secret → assert stored ciphertext-only + webhook verify works) + whole-slice review + merge (+ push on user go).

## Relates to

[[workflow-builder-workstream]] / [[workflow-node-palette]] (the definition + webhook/HTTP nodes), [[workflow-js-isolate-sec01]] (the sibling SEC-01, DONE — this is the last audit hardening sub-project), the connector store (`getDecryptedConfig` — the encrypted-store pattern reused), [[dhis2-sink-plugin-workstream]] / [[sp-a2-dhis2-webview-plugin]] (the SEC-06 audit origin), [[distributed-sync-central-workstream]] (the injected-decrypt + boot-migration patterns reused).
