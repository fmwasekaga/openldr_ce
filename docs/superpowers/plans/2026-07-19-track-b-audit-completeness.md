# Track B — Audit Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two audit-trail holes: (B1) CLI-initiated mutations record `audit_events` rows (as a first-class `actor_type:'cli'`) at parity with their HTTP twins, and (B2) rejected authentications record a throttled `auth.failed` event; plus (B3) document that login/logout success history lives in Keycloak.

**Architecture:** Extract the request-free audit core (`recordAuditEvent`) into `@openldr/bootstrap`; the server's `recordAudit(ctx, req, details)` becomes a thin wrapper over it. Widen the audit actor type to include `'cli'` end-to-end. CLI mutating commands call `recordAuditEvent` with a `cliActor()` (OS user, `--actor` override) and the SAME action strings as their HTTP twins. The Fastify auth plugin records a throttled, sanitized `auth.failed` event at each token-rejection point. Docs get a "login history is Keycloak's" note.

**Tech Stack:** TypeScript, pnpm + turbo monorepo, Kysely/Postgres (pg-mem for unit tests), Fastify, `jose` (token verify), `commander` (CLI), React (studio), vitest.

**Worktree:** All work happens in `D:\Projects\openldr-audit-track-b` (branch `claude/audit-track-b`, off `main` at `5fa9191e`). Do NOT touch other checkouts.

**Guiding boundary (from the spec):** The audit log stays a "who did what" *operator-action* trail. Track B adds CLI operator actions + auth failures to it — NOT high-frequency runtime (that was Track A's separate `sync_activity`). Read-only CLI commands (`list`/`status`/`show`) are NOT audited.

---

## Verified facts & spec corrections (trust these; still open each file)

- **`actor_type:'cli'` is NOT representable today.** `packages/audit/src/store.ts:7` types `actorType: 'user' | 'system'`; the read-path `toEvent` (store.ts:59) coerces `actor_type !== 'user'` → `'system'`. The DB column (`005_audit_events.ts`, `schema/internal.ts:150`) is permissive `text` (no CHECK). So `record()`'s insert (`e.actorType` verbatim, store.ts:92) already persists `'cli'`; only the union + `toEvent` need widening. The studio mirrors the type in `apps/studio/src/api*.ts` (audit) + renders it in `apps/studio/src/pages/Audit.tsx:256`.
- **Settings CLI (`packages/cli/src/settings.ts`) + `db reset` (`db.ts`) ALREADY audit** (via `ctx.audit.record`, `actorType:'system'`, `actorName:'cli'`/`'system'`). B1 *reconciles* these to `recordAuditEvent` + `cliActor()` (`actor_type:'cli'`) and fixes small metadata drift vs the HTTP twins. A parity test already exists (`settings.test.ts:94`).
- **Terminology CLI uses `createTerminologyContext`** (`packages/cli/src/terminology.ts`), whose `TerminologyContext` has **no `audit`** (`terminology-context.ts:33-43`). It DOES hold `internal.db` (`terminology-context.ts:46-47`), so adding `audit: createAuditStore(db)` + a `logger` is clean.
- **CLI `user` commands hit the LOCAL `ctx.users` store**; HTTP `user.*` actions hit Keycloak `ctx.auth.directory`. Same action strings, different backend/entityId meaning — acceptable; note it in metadata. CLI has NO `reset-password`/`send-reset-email`/`status`/`disable` commands (spec overstated). Real CLI mutating user surface: `user create`, `user set-role`, `user activate`, `user deactivate`.
- **auth-plugin has four distinct rejection points** (`auth-plugin.ts`): (1) missing token (line 86), (2) `verifyToken` throws (line 95), (3) account disabled 403 (line 102), (4) user-sync failed 401 (line 108). Verify is `jose` — errors carry `.code` (`ERR_JWT_EXPIRED`, `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`, `ERR_JWT_CLAIM_VALIDATION_FAILED` + `.claim`, `ERR_JWKS_NO_MATCHING_KEY`) so reasons are derivable. `ctx` (with `ctx.audit`, `ctx.logger`, `ctx.cfg`) is in scope in the hook. `req.ip` is available (Fastify native). Dev-bypass success early-returns at line 84 (never reaches a rejection → not recorded — matches spec). There is NO existing failed-auth TODO in the file.
- **`recordAudit` core** (`apps/server/src/audit-helper.ts`): `recordAudit(ctx, req, d)` → `ctx.audit.record({...actorFromRequest(req), ...d})` wrapped best-effort. `@openldr/audit` already exports `safeRecord(store, logger, e)` (best-effort). Test: `audit-helper.test.ts` uses a `recordingCtx()`.

## Shared design decisions (apply throughout)

**`recordAuditEvent` signature** — request-free, minimal-ctx, best-effort:
```ts
// packages/bootstrap/src/record-audit.ts
export async function recordAuditEvent(
  ctx: { audit: AuditStore; logger: Logger },
  actor: AuditActor,   // { actorType, actorId, actorName }
  d: AuditDetails,     // { action, entityType, entityId, before?, after?, metadata? }
): Promise<void>
```
`AppContext` satisfies `{audit, logger}`; `TerminologyContext` will after Task 7.

**CLI action-string mapping (CLI command → action / entityType / entityId / metadata):**
| CLI command | action | entityType | entityId | metadata |
|---|---|---|---|---|
| `sync enroll <siteId>` | `settings.sync.enroll` | `sync_site` | `siteId` | `{ clientId }` |
| `sync rotate <siteId>` | `settings.sync.rotate` | `sync_site` | `siteId` | `{ clientId }` |
| `sync revoke <siteId>` | `settings.sync.revoke` | `sync_site` | `siteId` | `{}` |
| `sync amend` | `settings.sync.amend` | `<resourceType>` | `<id>` | `{ version, provenanceId, siteId, activity }` |
| `sync merge-patient` | `settings.sync.merge` | `Patient` | `<duplicateId>` | `{ survivorId, duplicateId, repointed, provenanceId }` |
| `sync now` | `settings.sync.now` | `app_settings` | `sync` | `{}` |
| `user create` | `user.create` | `user` | `<new user id>` | `{ username, roles, backend: 'local' }` |
| `user set-role <id> <roles...>` | `user.update` | `user` | `id` | `{ roles, backend: 'local' }` |
| `user activate <id>` | `user.status` | `user` | `id` | `{ enabled: true, backend: 'local' }` |
| `user deactivate <id>` | `user.status` | `user` | `id` | `{ enabled: false, backend: 'local' }` |
| `settings flags set` | `settings.flag.update` | `app_setting` | `key` | `{ key, before, after }` |
| `settings numbers set` | `settings.number.update` | `app_setting` | `key` | `{ key, before, after }` |
| `settings sync set` | `settings.sync.update` | `app_setting` | `sync.*` | `{ before, after }` |
| `settings validation set` | `settings.validation_strictness` | `app_setting` | `validation.strictness` | before/after fields = `{strictness}` |
| `settings danger <action>` | `settings.danger.${action}` | `app_settings` | `internal-db` | `{ action, ok: true }` |
| `db reset` | `db.reset` | `database` | `internal+external` | `{}` |
| `terminology import loinc` | `coding_system.import` | `coding_system` | `'loinc'` | `{ source: 'loinc', result }` |
| `terminology import resource` | `term.import` | `term` | `<system.url>` | `{ result }` |
| `terminology publisher create` | `publisher.create` | `publisher` | `<created.id>` | `{ name }` |
| `terminology system create` | `coding_system.create` | `coding_system` | `<created.id>` | `{ systemCode }` |
| `terminology ontology unlink` | `ontology_distribution.delete` | `ontology_distribution` | `<systemId>` | `{}` |

---

## File Structure

**Created:**
- `packages/bootstrap/src/record-audit.ts` — `recordAuditEvent` + `AuditActor`/`AuditDetails` types.
- `packages/bootstrap/src/record-audit.test.ts` — unit test.
- `packages/cli/src/cli-actor.ts` — `cliActor()` + `setActorOverride()`.
- `packages/cli/src/cli-actor.test.ts` — unit test.
- `apps/server/src/auth-failed.ts` — reason derivation + throttle helper for `auth.failed`.
- `apps/server/src/auth-failed.test.ts` — unit test.

**Modified:**
- `packages/audit/src/store.ts` — widen `actorType` union + `toEvent`.
- `packages/audit/src/store.test.ts` — assert `'cli'` round-trips.
- `apps/studio/src/api.ts` (or `api.audit.ts`) — mirror `actorType` including `'cli'`.
- `packages/bootstrap/src/index.ts` — export `recordAuditEvent`.
- `apps/server/src/audit-helper.ts` — `recordAudit` becomes a thin wrapper.
- `apps/server/src/auth-plugin.ts` — emit `auth.failed`.
- `apps/server/src/auth-plugin.test.ts` — assert emission + dev-bypass skip.
- `packages/cli/src/index.ts` — `--actor` option + preAction hook.
- `packages/cli/src/{sync,user,settings,db,terminology}.ts` — audit calls.
- `packages/cli/src/{sync,user,settings,db,terminology}.test.ts` — parity assertions.
- `packages/bootstrap/src/terminology-context.ts` — add `audit` + `logger`.
- `apps/studio/src/docs/0.1.0/en/audit.md`, `apps/studio/src/pages/Audit.tsx`, `apps/web/src/docs/0.1.0/cli.md` — B3 docs.

**Commands:** single package tests `pnpm --filter <pkg> test`; typecheck `pnpm --filter <pkg> typecheck`; full gate `pnpm turbo typecheck test build` (⚠ NEVER pipe turbo through `tail` — Windows EPERM flake; `@openldr/cli#build` fails on Windows for native-esbuild reasons unrelated to this work; `terminology-sync.test.ts` is a known parallel-turbo flake — verify a suspect failure by running the package's `vitest run` directly).

---

## Task 1: First-class `actor_type: 'cli'` in the audit store

**Files:** Modify `packages/audit/src/store.ts`, `packages/audit/src/store.test.ts`, `apps/studio/src/api.ts` (audit mirror).

- [ ] **Step 1: Write the failing test** — append to `packages/audit/src/store.test.ts` (reuses its `makeMigratedDb()`):

```ts
it('preserves a cli actor_type through record + read-back', async () => {
  const db = await makeMigratedDb();
  const store = createAuditStore(db);
  const ev = await store.record({
    actorType: 'cli', actorId: null, actorName: 'alice',
    action: 'settings.flag.update', entityType: 'app_setting', entityId: 'x',
  });
  expect(ev.actorType).toBe('cli');           // record() return preserves it
  const got = await store.get(ev.id);
  expect(got?.actorType).toBe('cli');          // read-path preserves it
  const listed = await store.list({});
  expect(listed.find((e) => e.id === ev.id)?.actorType).toBe('cli');
});
```

- [ ] **Step 2: Run it — expect FAIL** (`actorType` narrows to `'user'|'system'`; value comes back `'system'`).
Run: `pnpm --filter @openldr/audit test -- store`

- [ ] **Step 3: Widen the union + toEvent.** In `packages/audit/src/store.ts`:
Line 7: `  actorType: 'user' | 'system';` → `  actorType: 'user' | 'system' | 'cli';`
Line 59 in `toEvent`: `    actorType: r.actor_type === 'user' ? 'user' : 'system',` →
```ts
    actorType: r.actor_type === 'user' || r.actor_type === 'cli' ? r.actor_type : 'system',
```
(Everything else already passes `e.actorType` through verbatim.)

- [ ] **Step 4: Mirror the type in studio.** In `apps/studio/src/api.ts` (find the audit `AuditEvent`/`actorType` mirror — grep `actorType` under `apps/studio/src`), widen its `actorType` to `'user' | 'system' | 'cli'`. If the studio has no explicit union (e.g. `actorType: string`), leave it. Verify `apps/studio/src/pages/Audit.tsx:256` (`DetailRow label="Actor type"`) renders it as-is (it prints the string — no change needed).

- [ ] **Step 5: Run tests + typecheck — expect PASS.**
Run: `pnpm --filter @openldr/audit test -- store` and `pnpm --filter @openldr/audit typecheck` and `pnpm --filter @openldr/studio typecheck`

- [ ] **Step 6: Commit**
```bash
git add packages/audit/src/store.ts packages/audit/src/store.test.ts apps/studio/src/api.ts
git commit -m "feat(audit): first-class cli actor_type (union + read-path)"
```

---

## Task 2: Extract `recordAuditEvent` into `@openldr/bootstrap`; server `recordAudit` wraps it

**Files:** Create `packages/bootstrap/src/record-audit.ts` + `.test.ts`; modify `packages/bootstrap/src/index.ts`, `apps/server/src/audit-helper.ts`.

- [ ] **Step 1: Write the failing test** — `packages/bootstrap/src/record-audit.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { recordAuditEvent } from './record-audit';

const nullLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

describe('recordAuditEvent', () => {
  it('merges actor + details into a single audit record', async () => {
    const record = vi.fn(async (e) => e);
    await recordAuditEvent({ audit: { record } as any, logger: nullLogger },
      { actorType: 'cli', actorId: null, actorName: 'alice' },
      { action: 'user.create', entityType: 'user', entityId: 'u1', metadata: { username: 'bob' } });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'cli', actorName: 'alice', action: 'user.create', entityType: 'user', entityId: 'u1',
    }));
  });

  it('never throws when the store rejects (best-effort)', async () => {
    const record = vi.fn(async () => { throw new Error('db down'); });
    await expect(recordAuditEvent({ audit: { record } as any, logger: nullLogger },
      { actorType: 'cli', actorId: null, actorName: 'a' },
      { action: 'x', entityType: 'y', entityId: 'z' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).
Run: `pnpm --filter @openldr/bootstrap test -- record-audit`

- [ ] **Step 3: Write the module** — `packages/bootstrap/src/record-audit.ts`:

```ts
import { safeRecord, type AuditStore, type AuditEventInput } from '@openldr/audit';
import type { Logger } from '@openldr/core';

export type AuditActor = Pick<AuditEventInput, 'actorType' | 'actorId' | 'actorName'>;

export interface AuditDetails {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Request-free audit recorder shared by the server's recordAudit wrapper and the CLI. Best-effort:
 *  a store failure is logged, never thrown into the audited operation. */
export async function recordAuditEvent(
  ctx: { audit: AuditStore; logger: Logger },
  actor: AuditActor,
  d: AuditDetails,
): Promise<void> {
  await safeRecord(ctx.audit, ctx.logger, { ...actor, ...d });
}
```

- [ ] **Step 4: Export from bootstrap barrel.** In `packages/bootstrap/src/index.ts` (near the other `export { ... } from './...'` lines, ~1190-1246) add:
```ts
export { recordAuditEvent } from './record-audit';
export type { AuditActor, AuditDetails } from './record-audit';
```

- [ ] **Step 5: Reconcile the server wrapper.** Replace `apps/server/src/audit-helper.ts`'s `recordAudit` body to delegate (keep `actorFromRequest` + `AuditDetails` re-exported for callers). New file:

```ts
import type { FastifyRequest } from 'fastify';
import { recordAuditEvent, type AuditActor, type AuditDetails } from '@openldr/bootstrap';
import type { AppContext } from '@openldr/bootstrap';

export type { AuditDetails };

export function actorFromRequest(req: FastifyRequest): AuditActor {
  if (req.user) return { actorType: 'user', actorId: req.user.id, actorName: req.user.username };
  return { actorType: 'system', actorId: null, actorName: 'System' };
}

/** Best-effort audit recorder for HTTP routes — a thin wrapper over the shared recordAuditEvent. */
export async function recordAudit(ctx: AppContext, req: FastifyRequest, d: AuditDetails): Promise<void> {
  await recordAuditEvent(ctx, actorFromRequest(req), d);
}
```

- [ ] **Step 6: Run tests + typecheck — expect PASS** (the existing `audit-helper.test.ts` + all `settings-routes`/route tests that use `recordAudit` must stay green).
Run: `pnpm --filter @openldr/bootstrap test -- record-audit`, `pnpm --filter @openldr/server test -- audit-helper`, `pnpm --filter @openldr/server typecheck`

- [ ] **Step 7: Commit**
```bash
git add packages/bootstrap/src/record-audit.ts packages/bootstrap/src/record-audit.test.ts packages/bootstrap/src/index.ts apps/server/src/audit-helper.ts
git commit -m "refactor(audit): extract request-free recordAuditEvent into bootstrap; server recordAudit wraps it"
```

---

## Task 3: CLI `--actor` option + `cliActor()` helper

**Files:** Create `packages/cli/src/cli-actor.ts` + `.test.ts`; modify `packages/cli/src/index.ts`.

- [ ] **Step 1: Write the failing test** — `packages/cli/src/cli-actor.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { cliActor, setActorOverride } from './cli-actor';

afterEach(() => setActorOverride(undefined));

describe('cliActor', () => {
  it('is actor_type cli with the OS user by default', () => {
    const a = cliActor();
    expect(a.actorType).toBe('cli');
    expect(a.actorId).toBeNull();
    expect(typeof a.actorName).toBe('string');
    expect(a.actorName.length).toBeGreaterThan(0);
  });
  it('uses the --actor override when set', () => {
    setActorOverride('release-bot');
    expect(cliActor().actorName).toBe('release-bot');
  });
  it('ignores a blank override', () => {
    setActorOverride('   ');
    expect(cliActor().actorName).not.toBe('');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).

- [ ] **Step 3: Write the helper** — `packages/cli/src/cli-actor.ts`:

```ts
import os from 'node:os';
import type { AuditActor } from '@openldr/bootstrap';

let override: string | undefined;

/** Set by the program's preAction hook from --actor. */
export function setActorOverride(name: string | undefined): void {
  override = name && name.trim() ? name.trim() : undefined;
}

/** The audit actor for a CLI invocation: actor_type 'cli', name = --actor override or the OS user. */
export function cliActor(): AuditActor {
  let name = override;
  if (!name) {
    try {
      name = os.userInfo().username;
    } catch {
      name = undefined;
    }
  }
  return { actorType: 'cli', actorId: null, actorName: name || 'cli' };
}
```

- [ ] **Step 4: Wire `--actor` on the program.** In `packages/cli/src/index.ts`, after `program.name('openldr').description(...)` (~line 26) add:
```ts
program.option('--actor <name>', 'audit actor name for this invocation (defaults to the OS user)');
```
and after the program is configured but before `parseAsync`, register a preAction hook (import `setActorOverride` from `./cli-actor`):
```ts
program.hook('preAction', () => setActorOverride(program.opts().actor as string | undefined));
```

- [ ] **Step 5: Run test + typecheck — expect PASS.**
Run: `pnpm --filter @openldr/cli test -- cli-actor` and `pnpm --filter @openldr/cli typecheck`

- [ ] **Step 6: Commit**
```bash
git add packages/cli/src/cli-actor.ts packages/cli/src/cli-actor.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): --actor option + cliActor() (cli audit actor, OS-user default)"
```

---

## Task 4: Audit the `sync` CLI mutations

**Files:** Modify `packages/cli/src/sync.ts`, `packages/cli/src/sync.test.ts`.

For each handler below, after the successful mutation and before/around `emit(...)` (inside the `try`, so a failure doesn't record a success), add a `recordAuditEvent(ctx, cliActor(), {...})` using the mapping table. Import at top: `import { recordAuditEvent } from '@openldr/bootstrap';` and `import { cliActor } from './cli-actor';`.

- [ ] **Step 1: Write failing tests** — append to `packages/cli/src/sync.test.ts` (mirror `settings.test.ts`'s `vi.hoisted` fake-ctx: mock `@openldr/bootstrap` with `createAppContext` returning a fake ctx whose `audit.record` is a `vi.fn()`, and stub `enrollSite`/`rotateSite`/`revokeSite`/`mergePatients` to return fixtures). One representative case:

```ts
it('sync enroll records settings.sync.enroll at cli parity', async () => {
  mocks.enrollSite.mockResolvedValue({ clientId: 'sync-lab-1', clientSecret: 's', siteId: 'lab-1', centralUrl: 'u', oidcIssuer: 'o', signingPrivateKey: 'k', centralPublicKey: 'p' });
  await runSyncEnroll('lab-1', { centralUrl: 'https://c', json: true });
  expect(mocks.appCtx.audit.record).toHaveBeenCalledWith(expect.objectContaining({
    actorType: 'cli', action: 'settings.sync.enroll', entityType: 'sync_site', entityId: 'lab-1',
    metadata: expect.objectContaining({ clientId: 'sync-lab-1' }),
  }));
});
```
Add analogous cases for rotate/revoke/amend/merge-patient/now.

- [ ] **Step 2: Run — expect FAIL.**
Run: `pnpm --filter @openldr/cli test -- sync`

- [ ] **Step 3: Add the audit calls.** Examples (place inside each `try`, after the op succeeds):

`runSyncEnroll` (after `const result = await enrollSite(...)`, before `emit`):
```ts
    await recordAuditEvent(ctx, cliActor(), {
      action: 'settings.sync.enroll', entityType: 'sync_site', entityId: siteId,
      metadata: { clientId: result.clientId },
    });
```
`runSyncRotate` → `settings.sync.rotate` / `sync_site` / `siteId` / `{ clientId: result.clientId }`.
`runSyncRevoke` → `settings.sync.revoke` / `sync_site` / `siteId` / `{}`.
`runSyncAmend` (after `const result = await ctx.fhirStore.amend(...)`):
```ts
    await recordAuditEvent(ctx, cliActor(), {
      action: 'settings.sync.amend', entityType: opts.resourceType!, entityId: opts.id!,
      metadata: { version: result.version, provenanceId: result.provenanceId, siteId: result.siteId, activity: opts.activity },
    });
```
`runSyncMergePatient` → `settings.sync.merge` / `Patient` / `opts.duplicate!` / `{ survivorId: result.survivorId, duplicateId: result.duplicateId, repointed: result.repointed, provenanceId: result.provenanceId }`.
`sync now` handler (the CLI trigger — find `runSyncNow`/the `sync now` action; after it triggers) → `settings.sync.now` / `app_settings` / `sync` / `{}`.

- [ ] **Step 4: Run tests + typecheck — expect PASS.**
- [ ] **Step 5: Commit** `feat(cli): audit sync enroll/rotate/revoke/amend/merge-patient/now`

---

## Task 5: Audit the `user` CLI mutations

**Files:** Modify `packages/cli/src/user.ts`, `packages/cli/src/user.test.ts`.

- [ ] **Step 1: Write failing tests** (mirror the fake-ctx pattern; the ctx fake needs `users.create/setRoles/setStatus` + `audit.record`). Representative:
```ts
it('user create audits user.create (cli, local backend)', async () => {
  mocks.appCtx.users.create.mockResolvedValue({ id: 'u1', username: 'bob', roles: ['lab_tech'] });
  await runUserCreate('bob', { role: ['lab_tech'], json: true });
  expect(mocks.appCtx.audit.record).toHaveBeenCalledWith(expect.objectContaining({
    actorType: 'cli', action: 'user.create', entityType: 'user', entityId: 'u1',
    metadata: expect.objectContaining({ backend: 'local' }),
  }));
});
```
Add cases for set-role (`user.update`), activate (`user.status` `{enabled:true}`), deactivate (`user.status` `{enabled:false}`).

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Add the audit calls** in `runUserCreate` / `runUserSetRole` / `runUserSetStatus` (imports: `recordAuditEvent` from `@openldr/bootstrap`, `cliActor` from `./cli-actor`). Use the mapping table. For `runUserSetStatus`, the `enabled` metadata = `status === 'active'`. Place inside the `try` after the mutation succeeds.
- [ ] **Step 4: Run tests + typecheck — expect PASS.**
- [ ] **Step 5: Commit** `feat(cli): audit user create/set-role/activate/deactivate`

---

## Task 6: Reconcile the existing `settings` + `db` CLI audits

**Files:** Modify `packages/cli/src/settings.ts`, `packages/cli/src/db.ts`, and their tests.

These already call `ctx.audit.record(...)` with `actorType:'system'`. Switch them to `recordAuditEvent(ctx, cliActor(), {...})` (→ `actor_type:'cli'`, OS-user name) and fix the metadata drift so CLI matches the HTTP twin exactly.

- [ ] **Step 1: Update tests first.** In `settings.test.ts`, the existing parity test asserts `action`/`entityType`/`entityId`; extend the assertions to also expect `actorType: 'cli'` and the corrected metadata: `settings numbers set` includes `before`; `settings validation set` uses top-level `before:{strictness}`/`after:{strictness}` (not metadata); `settings danger` metadata includes `ok: true`. Also assert `db reset` (in `db.test.ts`) now records `actorType: 'cli'`, `action: 'db.reset'`.

- [ ] **Step 2: Run — expect FAIL** (still `system` / old metadata shape).

- [ ] **Step 3: Reconcile the calls:**
  - `settings.ts` `runSettingsFlagsSet`/`runSettingsNumbersSet`/`runSettingsSyncSet`/`runSettingsValidationSet`/`runSettingsDanger`: replace each `await ctx.audit.record({ actorType:'system', actorName:'cli', ...})` with `await recordAuditEvent(ctx, cliActor(), {...})` (drop the inline actor fields). Fix metadata: numbers add `before` (read the prior value before the set); validation move `before`/`after` from `metadata` to top-level `before: { strictness: prior }, after: { strictness: next }`; danger add `ok: true`.
  - `db.ts` `db reset`: replace `await ctx.audit.record({ actorType:'system', actorName:'system', action:'db.reset', ...})` with `await recordAuditEvent(ctx, cliActor(), { action: 'db.reset', entityType: 'database', entityId: 'internal+external', metadata: {} })` (keep it inside the existing best-effort try/catch).
  Imports: `recordAuditEvent` from `@openldr/bootstrap`, `cliActor` from `./cli-actor`.

- [ ] **Step 4: Run tests + typecheck — expect PASS.**
- [ ] **Step 5: Commit** `refactor(cli): reconcile settings + db reset audits to cli actor + HTTP-twin metadata`

---

## Task 7: Audit the `terminology` CLI mutations (adds audit to TerminologyContext)

**Files:** Modify `packages/bootstrap/src/terminology-context.ts`, `packages/cli/src/terminology.ts`, and `terminology.test.ts`.

- [ ] **Step 1: Add `audit` + `logger` to `TerminologyContext`.** In `packages/bootstrap/src/terminology-context.ts`:
  - Imports: `import { createAuditStore, type AuditStore } from '@openldr/audit';` and `import { createLogger, type Logger } from '@openldr/core';` (verify the logger factory name — grep `createLogger` in bootstrap `index.ts`; use the same one).
  - Add to the interface (`TerminologyContext`, ~line 33): `audit: AuditStore;` and `logger: Logger;`.
  - In `createTerminologyContext`, after `const db = ...` (line 47): `const logger = createLogger({ level: cfg.LOG_LEVEL });` and `const audit = createAuditStore(db);`.
  - Add `audit,` and `logger,` to the returned object (line 102).

- [ ] **Step 2: Write failing tests** in `terminology.test.ts` (mirror the fake-ctx pattern; mock `createTerminologyContext` to return a fake with `audit.record: vi.fn()`, `logger`, and the loaders/admin stubs). Representative:
```ts
it('terminology system create audits coding_system.create (cli)', async () => {
  mocks.termCtx.admin.codingSystems.create.mockResolvedValue({ id: 'cs1', systemCode: 'LNC' });
  await runSystemCreate({ systemCode: 'LNC', systemName: 'LOINC', json: true });
  expect(mocks.termCtx.audit.record).toHaveBeenCalledWith(expect.objectContaining({
    actorType: 'cli', action: 'coding_system.create', entityType: 'coding_system', entityId: 'cs1',
  }));
});
```
Add cases for `import loinc` (`coding_system.import`), `import resource` (`term.import`), `publisher create` (`publisher.create`), `ontology unlink` (`ontology_distribution.delete`). (`ontology build/rebuild` are NOT audited — no HTTP twin.)

- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Add the audit calls** in `runTerminologyImport` / `runPublisherCreate` / `runSystemCreate` / `runOntologyUnlink` (imports: `recordAuditEvent` from `@openldr/bootstrap`, `cliActor` from `./cli-actor`; pass the terminology ctx which now has `audit`+`logger`). Use the mapping table. Place inside each `try` after the op succeeds.
- [ ] **Step 5: Run tests + typecheck — expect PASS.**
- [ ] **Step 6: Commit** `feat(cli): audit terminology import/publisher/system/ontology-unlink (audit store on TerminologyContext)`

---

## Task 8: `auth.failed` events (B2)

**Files:** Create `apps/server/src/auth-failed.ts` + `.test.ts`; modify `apps/server/src/auth-plugin.ts`, `apps/server/src/auth-plugin.test.ts`.

- [ ] **Step 1: Write the failing test for the helper** — `apps/server/src/auth-failed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reasonFromError, createAuthFailedThrottle } from './auth-failed';

describe('reasonFromError', () => {
  it('maps jose error codes to reasons', () => {
    expect(reasonFromError({ code: 'ERR_JWT_EXPIRED' })).toBe('expired');
    expect(reasonFromError({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' })).toBe('bad-signature');
    expect(reasonFromError({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' })).toBe('wrong-audience');
    expect(reasonFromError({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'iss' })).toBe('wrong-issuer');
    expect(reasonFromError(new Error('whatever'))).toBe('invalid');
  });
});

describe('createAuthFailedThrottle', () => {
  it('collapses repeats of the same (key,reason) within the window', () => {
    let t = 1000;
    const throttle = createAuthFailedThrottle({ windowMs: 60_000, now: () => t });
    expect(throttle('1.2.3.4', 'expired')).toBe(true);   // first: record
    expect(throttle('1.2.3.4', 'expired')).toBe(false);  // dup within window
    expect(throttle('1.2.3.4', 'invalid')).toBe(true);   // different reason
    t += 61_000;
    expect(throttle('1.2.3.4', 'expired')).toBe(true);   // window elapsed
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Write the helper** — `apps/server/src/auth-failed.ts`:

```ts
export type AuthFailReason =
  | 'missing' | 'expired' | 'bad-signature' | 'wrong-audience' | 'wrong-issuer'
  | 'no-matching-key' | 'invalid' | 'account-disabled' | 'sync-failed';

/** Derive a stable reason from a jose (or other) verification error. Never inspects the token. */
export function reasonFromError(e: unknown): AuthFailReason {
  const code = (e as { code?: string } | null)?.code;
  const claim = (e as { claim?: string } | null)?.claim;
  switch (code) {
    case 'ERR_JWT_EXPIRED': return 'expired';
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED': return 'bad-signature';
    case 'ERR_JWKS_NO_MATCHING_KEY': return 'no-matching-key';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      return claim === 'iss' ? 'wrong-issuer' : claim === 'aud' ? 'wrong-audience' : 'invalid';
    default: return 'invalid';
  }
}

/** In-memory dedup: returns true if this (key,reason) should be RECORDED now (first in the window),
 *  false if it's a repeat to collapse. Bounded by pruning expired entries on each call. */
export function createAuthFailedThrottle(opts: { windowMs?: number; now?: () => number } = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const seen = new Map<string, number>();
  return function shouldRecord(key: string, reason: AuthFailReason): boolean {
    const t = now();
    // prune
    for (const [k, exp] of seen) if (exp <= t) seen.delete(k);
    const id = `${key}::${reason}`;
    if (seen.has(id)) return false;
    seen.set(id, t + windowMs);
    return true;
  };
}

/** Best-effort decode of the `sub` claim from a JWT WITHOUT verifying (for actor identity on a rejected
 *  token). Returns null on any problem. Never throws; never returns anything but the sub string. */
export function subFromUnverifiedToken(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown };
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the helper test — expect PASS.** Add a `subFromUnverifiedToken` case (valid base64url payload with a `sub`, and a garbage string → null).

- [ ] **Step 5: Write the failing auth-plugin test** — in `apps/server/src/auth-plugin.test.ts`, add `audit: { record: vi.fn() }` to the `ctx()` fake, then:
```ts
it('records one throttled auth.failed on an invalid token', async () => {
  const c = ctx({ verify: async () => { const e: any = new Error('bad'); e.code = 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'; throw e; } });
  const app = await appWith(c);
  await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer bad' } });
  await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer bad' } });
  const calls = (c.audit.record as any).mock.calls.filter((a: any[]) => a[0].action === 'auth.failed');
  expect(calls.length).toBe(1); // throttled: two identical failures → one row
  expect(calls[0][0]).toMatchObject({ action: 'auth.failed', entityType: 'auth', metadata: expect.objectContaining({ reason: 'bad-signature' }) });
});
it('does NOT record auth.failed for a dev-bypass request', async () => {
  const c = ctx({ bypass: true });
  const app = await appWith(c);
  await app.inject({ method: 'GET', url: '/api/probe' }); // no token, bypass on → success
  expect((c.audit.record as any).mock.calls.filter((a: any[]) => a[0].action === 'auth.failed')).toHaveLength(0);
});
```
(Match the file's existing `ctx()`/`appWith` helpers — the `bypass`/`verify` option names may differ; adapt.)

- [ ] **Step 6: Emit `auth.failed` in `auth-plugin.ts`.** Add imports:
```ts
import { safeRecord } from '@openldr/audit';
import { reasonFromError, createAuthFailedThrottle, subFromUnverifiedToken, type AuthFailReason } from './auth-failed';
```
Create ONE throttle per plugin registration (module scope inside `registerAuth`, before the hook):
```ts
  const throttle = createAuthFailedThrottle();
  const recordAuthFailed = (req: FastifyRequest, reason: AuthFailReason, sub: string | null) => {
    const key = sub ?? req.ip;
    if (!throttle(key, reason)) return; // collapse repeats within the window
    void safeRecord(ctx.audit, ctx.logger, {
      actorType: sub ? 'user' : 'system',
      actorId: sub,
      actorName: sub ?? req.ip,
      action: 'auth.failed', entityType: 'auth', entityId: reason,
      metadata: { reason, ip: req.ip },
    });
  };
```
Then call it at the rejection points (NEVER pass the token):
- Missing token (line 86, non-bypass): `recordAuthFailed(req, 'missing', null);` before `reply.code(401)`.
- Verify throws (line 94, in the catch): `recordAuthFailed(req, reasonFromError(e), subFromUnverifiedToken(token));` before `reply.code(401)`.
- Account disabled (line 102): `recordAuthFailed(req, 'account-disabled', (claims as { sub?: string }).sub ?? null);`
- User-sync failed (line 107, catch): `recordAuthFailed(req, 'sync-failed', (claims as { sub?: string }).sub ?? null);`
The dev-bypass branch (line 82-84) already early-returns → nothing recorded. ✅

- [ ] **Step 7: Run tests + typecheck — expect PASS** (existing auth-plugin cases stay green; the new fake `audit.record` must be present on all `ctx()` builds — add it to the shared factory default).
Run: `pnpm --filter @openldr/server test -- auth-plugin auth-failed`, `pnpm --filter @openldr/server typecheck`

- [ ] **Step 8: Commit** `feat(auth): record throttled, sanitized auth.failed events on token rejection`

---

## Task 9: B3 — document that login/logout success is Keycloak's

**Files:** Modify `apps/studio/src/docs/0.1.0/en/audit.md`, `apps/studio/src/pages/Audit.tsx`, `apps/web/src/docs/0.1.0/cli.md`.

- [ ] **Step 1: Studio audit doc.** In `apps/studio/src/docs/0.1.0/en/audit.md`, add a short note (near the top or under `## Troubleshooting`):
```md
> **Sign-in history:** Successful logins and logouts are handled by Keycloak, not OpenLDR — the app never sees the password. Find them in the Keycloak admin console under **Realm → Events**. This log records failed authentications (`auth.failed`) and operator actions (including CLI actions, shown with the `cli` actor type).
```

- [ ] **Step 2: Audit page hint.** In `apps/studio/src/pages/Audit.tsx`, extend the header hint (line ~348, currently `Newest events first.`) to:
```tsx
<span className="text-xs text-muted-foreground">Newest events first. Sign-in history lives in Keycloak.</span>
```

- [ ] **Step 3: CLI doc.** In `apps/web/src/docs/0.1.0/cli.md`, near the command list, add a note that mutating CLI commands are audited:
```md
Mutating CLI commands (`sync enroll/rotate/revoke`, `user create/set-role/activate/deactivate`, `settings … set`, `settings danger …`, `db reset`, `terminology import/create`) record an audit event with actor type **`cli`** and actor name = the OS user (override with the global `--actor <name>`). They appear on the Audit page alongside UI actions.
```

- [ ] **Step 4: Verify** `pnpm --filter @openldr/studio typecheck` (JSX change) + eyeball the markdown.
- [ ] **Step 5: Commit** `docs(audit): note login history is Keycloak's + CLI actions are audited`

---

## Task 10: Full workspace gate

- [ ] **Step 1:** `pnpm turbo typecheck test build` (NOT through `tail`). Expect green except the known `@openldr/cli#build` Windows-native failure + the `terminology-sync.test.ts` parallel flake (verify any suspect failure by running that package's `vitest run` directly). Fix any real fallout (e.g. a route test whose fake ctx now needs `audit` for the auth plugin, or a consumer of `AuditEvent.actorType` that must accept `'cli'`).
- [ ] **Step 2:** Commit any gate fixups.

---

## Manual live acceptance (operator/driver — after Task 10)

Run against a real stack (the local prod stack or a dev API). Two checks:
1. **CLI audited:** run a mutating CLI command that needs no external deps — e.g. `openldr settings flags set <someflag> true` (or `openldr settings validation set medium`). Then open the Audit page (or `openldr audit list`) and confirm a new event with **actor type `cli`**, actor name = your OS user, and the matching action string. Try `--actor release-bot` and confirm the actor name overrides.
2. **auth.failed:** hit a protected route with a bad token — `curl -s -o /dev/null -w '%{http_code}' https://<host>/api/settings/flags -H 'Authorization: Bearer garbage'` → 401. Repeat 3×. Confirm the Audit page shows exactly **one** `auth.failed` (throttled) with `metadata.reason` (`bad-signature`/`invalid`) and `metadata.ip`, and **no token** anywhere in the row. Confirm a dev-bypass request records none.

---

## Post-implementation

- Whole-slice code review (superpowers:requesting-code-review) before merge — pay attention to: no token ever reaching an audit row (B2); the throttle map is bounded (prunes); `actor_type:'cli'` round-trips; CLI action strings exactly match the HTTP twins.
- Merge `--no-ff` to local `main`; push to origin (this workstream is now push-approved).
- Update the `audit-observability-workstream` memory: Track B DONE.

## Self-review notes (author)

- **Spec coverage:** B1 CLI audit (extract `recordAuditEvent` T2, `actor_type:'cli'` T1, `--actor`/OS-user T3, sync T4, user T5, settings/db reconcile T6, terminology T7) ✓; B2 failed-auth throttled+sanitized (T8) ✓; B3 docs (T9) ✓.
- **Spec deviations (verified, baked in):** `actor_type:'cli'` needed the union+read-path widened (T1); settings/db already audited so T6 reconciles rather than adds; terminology needed an audit store on its context (T7); CLI user surface is narrower than the spec and hits the local store (T5, noted in metadata `backend:'local'`); auth reasons derived from jose codes (T8).
- **Out of scope (deferred, per spec):** PHI read-access auditing; projection/scheduled-job auditing; wiring Keycloak's event log into the UI (T9 only documents it). HTTP-only audited actions with no CLI twin (most terminology mutations, `user.reset_password` etc.) are NOT added to the CLI.
- **Type consistency:** `recordAuditEvent(ctx:{audit,logger}, actor, details)` used identically by the server wrapper + all CLI callers; `cliActor()`/`setActorOverride` names consistent; `AuthFailReason` union shared between helper + plugin.
