# Audit Log + Decoupled Users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an append-only audit log and a Keycloak-decoupled users store (both internal-DB), wire operational audit events (ingest, plugin lifecycle, db reset), and expose `audit`/`user` CLI commands.

**Architecture:** `@openldr/audit` (`AuditStore` + `safeRecord`) and `@openldr/users` (`UserStore` + `syncFromClaims`) are pure stores over `Kysely<InternalSchema>` — no adapter (DP-1). Bootstrap exposes `ctx.audit`/`ctx.users` and injects a best-effort audit callback into the ingest worker + wraps plugin install/remove. Users are keyed by an internal id with a nullable OIDC `subject` linked just-in-time by `syncFromClaims`.

**Tech Stack:** TypeScript (ESM), Kysely, Vitest, commander.

**Reference:** `docs/superpowers/specs/2026-06-13-audit-users-design.md`

**Conventions:** Commits `git -c commit.gpgsign=false commit`, **no** `Co-authored-by` trailer (P1-CONV-2). Local imports omit extensions; `import type` for type-only. `@openldr/audit`/`@openldr/users` import no `adapter-*`. jsonb inserts use the established `as never` cast (Kysely's `JSONColumnType` insert types are strict).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema/internal.ts` | add `AuditEventsTable` + `UsersTable` (modify) |
| `packages/db/src/migrations/internal/005_audit_events.ts` / `006_users.ts` | new migrations |
| `packages/db/src/migrations/internal/index.ts` | register 005, 006 (modify) |
| `packages/audit/src/store.ts` + `index.ts` | `AuditStore`, `safeRecord`, types |
| `packages/users/src/store.ts` + `index.ts` | `UserStore`, `syncFromClaims`, types |
| `packages/ingest/src/handle.ts` | optional `audit` callback on done/failed (modify) |
| `packages/bootstrap/src/index.ts` | `ctx.audit` + `ctx.users` + internal db (modify) |
| `packages/bootstrap/src/ingest-context.ts` | inject ingest audit + wrap plugin install/remove (modify) |
| `packages/cli/src/audit.ts` + `user.ts` + `index.ts` + `db.ts` | CLI + db-reset audit |

---

## Task 1: `@openldr/db` — audit_events + users migrations

**Files:**
- Modify: `packages/db/src/schema/internal.ts`, `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`
- Create: `packages/db/src/migrations/internal/005_audit_events.ts`, `006_users.ts`

- [ ] **Step 1: Add tables to `packages/db/src/schema/internal.ts`** — insert these two interfaces before `export interface InternalSchema {`:

```ts
export interface AuditEventsTable {
  id: string;
  occurred_at: Generated<Date>;
  actor_type: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: JSONColumnType<Record<string, unknown>> | null;
  after: JSONColumnType<Record<string, unknown>> | null;
  metadata: JSONColumnType<Record<string, unknown>> | null;
}

export interface UsersTable {
  id: string;
  subject: string | null;
  username: string;
  display_name: string | null;
  email: string | null;
  roles: JSONColumnType<string[]>;
  status: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  last_login_at: Date | null;
}
```

And extend `InternalSchema`:

```ts
export interface InternalSchema {
  fhir_resources: FhirResourcesTable;
  outbox_events: OutboxEventsTable;
  ingest_batches: IngestBatchesTable;
  plugins: PluginsTable;
  audit_events: AuditEventsTable;
  users: UsersTable;
}
```

- [ ] **Step 2: Create `packages/db/src/migrations/internal/005_audit_events.ts`**

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('audit_events')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('occurred_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('actor_type', 'text', (c) => c.notNull())
    .addColumn('actor_id', 'text')
    .addColumn('actor_name', 'text', (c) => c.notNull())
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('entity_type', 'text', (c) => c.notNull())
    .addColumn('entity_id', 'text', (c) => c.notNull())
    .addColumn('before', 'jsonb')
    .addColumn('after', 'jsonb')
    .addColumn('metadata', 'jsonb')
    .execute();
  await db.schema.createIndex('audit_events_occurred_idx').ifNotExists().on('audit_events').column('occurred_at').execute();
  await db.schema.createIndex('audit_events_entity_idx').ifNotExists().on('audit_events').columns(['entity_type', 'entity_id']).execute();
  await db.schema.createIndex('audit_events_actor_idx').ifNotExists().on('audit_events').column('actor_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('audit_events').ifExists().execute();
}
```

- [ ] **Step 3: Create `packages/db/src/migrations/internal/006_users.ts`**

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('subject', 'text')
    .addColumn('username', 'text', (c) => c.notNull())
    .addColumn('display_name', 'text')
    .addColumn('email', 'text')
    .addColumn('roles', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_login_at', 'timestamptz')
    .addUniqueConstraint('users_username_key', ['username'])
    .addUniqueConstraint('users_subject_key', ['subject'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('users').ifExists().execute();
}
```

> Postgres unique constraints permit multiple NULLs, so several CLI-created users with `subject = null` coexist; `syncFromClaims` sets a unique non-null `subject` per IdP user.

- [ ] **Step 4: Replace `packages/db/src/migrations/internal/index.ts`**

```ts
import type { Migration } from 'kysely';
import * as m001 from './001_fhir_resources';
import * as m002 from './002_outbox';
import * as m003 from './003_ingest_batches';
import * as m004 from './004_plugins';
import * as m005 from './005_audit_events';
import * as m006 from './006_users';

export const internalMigrations: Record<string, Migration> = {
  '001_fhir_resources': { up: m001.up, down: m001.down },
  '002_outbox': { up: m002.up, down: m002.down },
  '003_ingest_batches': { up: m003.up, down: m003.down },
  '004_plugins': { up: m004.up, down: m004.down },
  '005_audit_events': { up: m005.up, down: m005.down },
  '006_users': { up: m006.up, down: m006.down },
};
```

- [ ] **Step 5: Update the migrations test** — in `packages/db/src/migrations/migrations.test.ts` replace the internal-keys assertion:

```ts
  it('internal has the six migrations with up/down', () => {
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources', '002_outbox', '003_ingest_batches', '004_plugins', '005_audit_events', '006_users']);
    for (const m of Object.values(internalMigrations)) {
      expect(typeof m.up).toBe('function');
      expect(typeof m.down).toBe('function');
    }
  });
```

- [ ] **Step 6: Run + typecheck**

Run: `pnpm --filter @openldr/db test migrations && pnpm --filter @openldr/db typecheck`
Expected: migration-map test passes; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(db): audit_events + users internal tables (migrations 005/006) (P1-AUD-1/P1-USER-1)"
```

---

## Task 2: `@openldr/audit` — AuditStore + safeRecord

**Files:**
- Modify: `packages/audit/package.json`
- Create: `packages/audit/src/store.ts`, `packages/audit/src/store.test.ts`, `packages/audit/tsconfig.json` (if missing); replace `packages/audit/src/index.ts`

- [ ] **Step 1: Replace `packages/audit/package.json`**

```json
{
  "name": "@openldr/audit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/db": "workspace:*",
    "kysely": "^0.27.5"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

Ensure `packages/audit/tsconfig.json` = `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`.

- [ ] **Step 2: Create `packages/audit/src/store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { type Kysely } from 'kysely';
import type { Logger } from '@openldr/core';
import type { InternalSchema } from '@openldr/db';

export interface AuditEventInput {
  actorType: 'user' | 'system';
  actorId?: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditEvent extends AuditEventInput {
  id: string;
  occurredAt: string;
}

export interface AuditFilter {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AuditStore {
  record(e: AuditEventInput): Promise<AuditEvent>;
  list(filter?: AuditFilter): Promise<AuditEvent[]>;
  get(id: string): Promise<AuditEvent | undefined>;
}

interface Row {
  id: string;
  occurred_at: Date;
  actor_type: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

function toEvent(r: Row): AuditEvent {
  return {
    id: r.id,
    occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at),
    actorType: r.actor_type === 'user' ? 'user' : 'system',
    actorId: r.actor_id,
    actorName: r.actor_name,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    before: r.before ?? undefined,
    after: r.after ?? undefined,
    metadata: (r.metadata as Record<string, unknown> | null) ?? undefined,
  };
}

export function createAuditStore(db: Kysely<InternalSchema>): AuditStore {
  return {
    async record(e) {
      const id = randomUUID();
      await db
        .insertInto('audit_events')
        .values({
          id,
          actor_type: e.actorType,
          actor_id: e.actorId ?? null,
          actor_name: e.actorName,
          action: e.action,
          entity_type: e.entityType,
          entity_id: e.entityId,
          before: (e.before ?? null) as never,
          after: (e.after ?? null) as never,
          metadata: (e.metadata ?? null) as never,
        })
        .execute();
      const row = await db.selectFrom('audit_events').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return toEvent(row as unknown as Row);
    },
    async list(filter = {}) {
      let q = db.selectFrom('audit_events').selectAll().orderBy('occurred_at', 'desc');
      if (filter.actorId) q = q.where('actor_id', '=', filter.actorId);
      if (filter.entityType) q = q.where('entity_type', '=', filter.entityType);
      if (filter.entityId) q = q.where('entity_id', '=', filter.entityId);
      if (filter.action) q = q.where('action', '=', filter.action);
      if (filter.from) q = q.where('occurred_at', '>=', new Date(filter.from));
      if (filter.to) q = q.where('occurred_at', '<=', new Date(filter.to));
      const rows = await q.limit(filter.limit ?? 100).execute();
      return rows.map((r) => toEvent(r as unknown as Row));
    },
    async get(id) {
      const r = await db.selectFrom('audit_events').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? toEvent(r as unknown as Row) : undefined;
    },
  };
}

/** Best-effort recorder — never throws into the caller (audit must not break the audited op). */
export async function safeRecord(store: AuditStore, logger: Logger, e: AuditEventInput): Promise<void> {
  try {
    await store.record(e);
  } catch (err) {
    logger.error({ action: e.action, error: err instanceof Error ? err.message : String(err) }, 'audit record failed');
  }
}
```

- [ ] **Step 3: Create `packages/audit/src/store.test.ts`** (safeRecord behavior — hermetic; store SQL verified in Task 7)

```ts
import { describe, it, expect, vi } from 'vitest';
import { safeRecord, type AuditStore, type AuditEvent } from './store';

const logger = { error: vi.fn(), info: vi.fn() } as never;
const ev = { id: 'a', occurredAt: 'x' } as AuditEvent;
const input = { actorType: 'system' as const, actorName: 'system', action: 'x.y', entityType: 'e', entityId: '1' };

describe('safeRecord', () => {
  it('forwards to store.record', async () => {
    const store = { record: vi.fn(async () => ev), list: vi.fn(), get: vi.fn() } as AuditStore;
    await safeRecord(store, logger, input);
    expect(store.record).toHaveBeenCalledWith(input);
  });
  it('swallows a throwing store and logs', async () => {
    const store = { record: vi.fn(async () => { throw new Error('db down'); }), list: vi.fn(), get: vi.fn() } as AuditStore;
    await expect(safeRecord(store, logger, input)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Replace `packages/audit/src/index.ts`**

```ts
export * from './store';
```

- [ ] **Step 5: Install, test, typecheck**

Run: `pnpm install && pnpm --filter @openldr/audit test && pnpm --filter @openldr/audit typecheck`
Expected: safeRecord tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(audit): append-only AuditStore + safeRecord (P1-AUD-1)"
```

---

## Task 3: `@openldr/users` — UserStore + syncFromClaims

**Files:**
- Modify: `packages/users/package.json`
- Create: `packages/users/src/store.ts`, `packages/users/src/store.test.ts`, `packages/users/tsconfig.json` (if missing); replace `packages/users/src/index.ts`

- [ ] **Step 1: Replace `packages/users/package.json`**

```json
{
  "name": "@openldr/users",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/db": "workspace:*",
    "@openldr/ports": "workspace:*",
    "kysely": "^0.27.5"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

Ensure `packages/users/tsconfig.json` = `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`.

- [ ] **Step 2: Create `packages/users/src/store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { TokenClaims } from '@openldr/ports';

export interface User {
  id: string;
  subject: string | null;
  username: string;
  displayName: string | null;
  email: string | null;
  roles: string[];
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
}

export interface CreateUserInput {
  username: string;
  displayName?: string;
  email?: string;
  roles?: string[];
}

export interface UserStore {
  create(input: CreateUserInput): Promise<User>;
  get(id: string): Promise<User | undefined>;
  getBySubject(subject: string): Promise<User | undefined>;
  getByUsername(username: string): Promise<User | undefined>;
  list(): Promise<User[]>;
  setRoles(id: string, roles: string[]): Promise<void>;
  setStatus(id: string, status: 'active' | 'disabled'): Promise<void>;
  syncFromClaims(claims: TokenClaims): Promise<User>;
}

interface Row {
  id: string;
  subject: string | null;
  username: string;
  display_name: string | null;
  email: string | null;
  roles: unknown;
  status: string;
  last_login_at: Date | null;
}

function toUser(r: Row): User {
  return {
    id: r.id,
    subject: r.subject,
    username: r.username,
    displayName: r.display_name,
    email: r.email,
    roles: Array.isArray(r.roles) ? (r.roles as string[]) : [],
    status: r.status === 'disabled' ? 'disabled' : 'active',
    lastLoginAt: r.last_login_at instanceof Date ? r.last_login_at.toISOString() : (r.last_login_at as string | null),
  };
}

const COLS = ['id', 'subject', 'username', 'display_name', 'email', 'roles', 'status', 'last_login_at'] as const;

export function createUserStore(db: Kysely<InternalSchema>): UserStore {
  async function get(id: string): Promise<User | undefined> {
    const r = await db.selectFrom('users').select(COLS).where('id', '=', id).executeTakeFirst();
    return r ? toUser(r as unknown as Row) : undefined;
  }
  async function getBySubject(subject: string): Promise<User | undefined> {
    const r = await db.selectFrom('users').select(COLS).where('subject', '=', subject).executeTakeFirst();
    return r ? toUser(r as unknown as Row) : undefined;
  }
  async function getByUsername(username: string): Promise<User | undefined> {
    const r = await db.selectFrom('users').select(COLS).where('username', '=', username).executeTakeFirst();
    return r ? toUser(r as unknown as Row) : undefined;
  }
  async function create(input: CreateUserInput): Promise<User> {
    const id = randomUUID();
    await db
      .insertInto('users')
      .values({
        id,
        username: input.username,
        display_name: input.displayName ?? null,
        email: input.email ?? null,
        roles: (input.roles ?? []) as never,
      })
      .execute();
    return (await get(id))!;
  }

  return {
    create,
    get,
    getBySubject,
    getByUsername,
    async list() {
      const rows = await db.selectFrom('users').select(COLS).orderBy('username').execute();
      return rows.map((r) => toUser(r as unknown as Row));
    },
    async setRoles(id, roles) {
      await db.updateTable('users').set({ roles: roles as never, updated_at: new Date() }).where('id', '=', id).execute();
    },
    async setStatus(id, status) {
      await db.updateTable('users').set({ status, updated_at: new Date() }).where('id', '=', id).execute();
    },
    async syncFromClaims(claims) {
      const sub = typeof claims.sub === 'string' ? claims.sub : '';
      if (!sub) throw new Error('syncFromClaims: missing sub claim');
      const username =
        (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
        (typeof claims.email === 'string' && claims.email) ||
        sub;
      const now = new Date();

      const existing = await getBySubject(sub);
      if (existing) {
        await db.updateTable('users').set({ last_login_at: now, updated_at: now }).where('id', '=', existing.id).execute();
        return { ...existing, lastLoginAt: now.toISOString() };
      }
      const byName = await getByUsername(username);
      if (byName) {
        await db.updateTable('users').set({ subject: sub, last_login_at: now, updated_at: now }).where('id', '=', byName.id).execute();
        return { ...byName, subject: sub, lastLoginAt: now.toISOString() };
      }
      const u = await create({
        username,
        displayName: typeof claims.name === 'string' ? claims.name : undefined,
        email: typeof claims.email === 'string' ? claims.email : undefined,
      });
      await db.updateTable('users').set({ subject: sub, last_login_at: now, updated_at: now }).where('id', '=', u.id).execute();
      return { ...u, subject: sub, lastLoginAt: now.toISOString() };
    },
  };
}
```

- [ ] **Step 3: Create `packages/users/src/store.test.ts`** — locks the `syncFromClaims` resolution contract (the Kysely-backed store mirrors it; verified against Postgres in Task 7):

```ts
import { describe, it, expect } from 'vitest';
import type { TokenClaims } from '@openldr/ports';
import type { User } from './store';

const mk = (over: Partial<User>): User => ({ id: over.id ?? 'id', subject: over.subject ?? null, username: over.username ?? 'u', displayName: null, email: null, roles: [], status: 'active', lastLoginAt: null });

// Mirror of createUserStore.syncFromClaims resolution, to lock the by-subject → by-username-link → create contract.
async function resolve(
  claims: TokenClaims,
  lk: { bySubject(s: string): User | undefined; byUsername(u: string): User | undefined; create(u: string): User; link(id: string, sub: string): void },
): Promise<User> {
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!sub) throw new Error('missing sub');
  const username = (typeof claims.preferred_username === 'string' && claims.preferred_username) || sub;
  const bySub = lk.bySubject(sub);
  if (bySub) return bySub;
  const byName = lk.byUsername(username);
  if (byName) { lk.link(byName.id, sub); return { ...byName, subject: sub }; }
  const created = lk.create(username);
  lk.link(created.id, sub);
  return { ...created, subject: sub };
}

describe('syncFromClaims resolution', () => {
  it('throws on a missing sub', async () => {
    await expect(resolve({} as TokenClaims, { bySubject: () => undefined, byUsername: () => undefined, create: () => mk({}), link: () => {} })).rejects.toThrow(/sub/);
  });
  it('returns the subject match unchanged', async () => {
    const u = mk({ id: 's1', subject: 'kc-1', username: 'op' });
    const out = await resolve({ sub: 'kc-1' } as TokenClaims, { bySubject: () => u, byUsername: () => undefined, create: () => mk({}), link: () => { throw new Error('should not link'); } });
    expect(out.id).toBe('s1');
  });
  it('links the subject onto a username match', async () => {
    const u = mk({ id: 'u1', subject: null, username: 'op' });
    const linked: string[] = [];
    const out = await resolve({ sub: 'kc-9', preferred_username: 'op' } as TokenClaims, { bySubject: () => undefined, byUsername: () => u, create: () => mk({}), link: (id, s) => linked.push(`${id}:${s}`) });
    expect(out.subject).toBe('kc-9');
    expect(linked).toEqual(['u1:kc-9']);
  });
  it('creates when neither matches', async () => {
    const created: string[] = [];
    const out = await resolve({ sub: 'kc-7', preferred_username: 'new' } as TokenClaims, { bySubject: () => undefined, byUsername: () => undefined, create: (u) => { created.push(u); return mk({ id: 'n1', username: u }); }, link: () => {} });
    expect(created).toEqual(['new']);
    expect(out.subject).toBe('kc-7');
  });
});
```

- [ ] **Step 4: Replace `packages/users/src/index.ts`**

```ts
export * from './store';
```

- [ ] **Step 5: Install, test, typecheck**

Run: `pnpm install && pnpm --filter @openldr/users test && pnpm --filter @openldr/users typecheck`
Expected: resolution tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(users): decoupled UserStore + syncFromClaims (P1-USER-1)"
```

---

## Task 4: `@openldr/ingest` — optional audit callback

**Files:**
- Modify: `packages/ingest/src/handle.ts`, `packages/ingest/src/pipeline.test.ts`

- [ ] **Step 1: Replace `packages/ingest/src/handle.ts`** with (adds an optional `audit` hook + records on done/failed):

```ts
import { type Logger, errorMessage, redact } from '@openldr/core';
import type { BlobStoragePort, EventEnvelope } from '@openldr/ports';
import type { Provenance, PersistResult } from '@openldr/db';
import type { ConverterResolver } from './resolver';
import type { BatchStore } from './batch-store';

/** Audit hook — a structural callback so ingest stays decoupled from @openldr/audit. */
export type AuditHook = (e: {
  actorType: 'system';
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

export interface HandleDeps {
  blob: BlobStoragePort;
  persist: (resource: unknown, provenance: Provenance) => Promise<PersistResult>;
  resolver: ConverterResolver;
  batches: BatchStore;
  logger: Logger;
  audit?: AuditHook;
}

interface IngestPayload {
  batchId: string;
  blobKey: string;
  source: string;
  converter: string;
}

export async function handleIngestEvent(deps: HandleDeps, event: EventEnvelope): Promise<void> {
  const { batchId, blobKey, source, converter } = event.payload as IngestPayload;
  await deps.batches.markProcessing(batchId);
  try {
    const raw = await deps.blob.get(blobKey);
    const c = await deps.resolver.resolve(converter);
    if (!c) throw new Error(`unknown converter: ${converter}`);
    const resources = await c.convert(raw, { source, batchId });
    const provenance: Provenance = { sourceSystem: source, pluginId: c.id, pluginVersion: c.version, batchId };
    for (const resource of resources) {
      await deps.persist(resource, provenance);
    }
    await deps.batches.markDone(batchId, resources.length);
    deps.logger.info({ batchId, source, converter, count: resources.length }, 'ingest batch persisted');
    await deps.audit?.({
      actorType: 'system',
      actorName: 'system',
      action: 'ingest.batch.done',
      entityType: 'batch',
      entityId: batchId,
      metadata: { source, converter, pluginId: c.id, pluginVersion: c.version, count: resources.length },
    });
  } catch (err) {
    const msg = redact(errorMessage(err));
    await deps.batches.markFailed(batchId, msg);
    deps.logger.error({ batchId, error: msg }, 'ingest batch failed');
    await deps.audit?.({
      actorType: 'system',
      actorName: 'system',
      action: 'ingest.batch.failed',
      entityType: 'batch',
      entityId: batchId,
      metadata: { source, converter, error: msg },
    });
    throw err;
  }
}
```

> `audit` is optional; existing call sites/tests that omit it keep working. Bootstrap injects a `safeRecord`-wrapped hook, so a failing audit never affects the batch.

- [ ] **Step 2: Update `packages/ingest/src/pipeline.test.ts`** — in the `handleIngestEvent` describe block's `deps()` helper, add `audit: vi.fn(async () => {})` to the returned object. In the "converts, persists … marks done" test, add after the existing assertions:

```ts
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingest.batch.done', entityId: 'b1' }));
```

- [ ] **Step 3: Test + typecheck**

Run: `pnpm --filter @openldr/ingest test && pnpm --filter @openldr/ingest typecheck`
Expected: all ingest tests pass; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(ingest): optional audit hook on batch done/failed (P1-AUD-2)"
```

---

## Task 5: `@openldr/bootstrap` — ctx.audit + ctx.users + wiring

**Files:**
- Modify: `packages/bootstrap/package.json`, `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/ingest-context.ts`

- [ ] **Step 1: Add deps** — in `packages/bootstrap/package.json` dependencies add `"@openldr/audit": "workspace:*",` and `"@openldr/users": "workspace:*",`. Run `pnpm install`.

- [ ] **Step 2: Edit `packages/bootstrap/src/index.ts`** — give `createAppContext` an internal DB + audit + users stores.

Add imports (merge `createInternalDb` into the existing `@openldr/db` import if present):

```ts
import { createInternalDb } from '@openldr/db';
import { createAuditStore, type AuditStore } from '@openldr/audit';
import { createUserStore, type UserStore } from '@openldr/users';
```

Add to the `AppContext` interface (after `store`):

```ts
  audit: AuditStore;
  users: UserStore;
```

In `createAppContext`, alongside the other constructions, add:

```ts
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const audit = createAuditStore(internal.db);
  const users = createUserStore(internal.db);
```

Add `audit,` and `users,` to the returned object literal, and add `internal.close()` to the `Promise.allSettled([...])` in `close()`.

- [ ] **Step 3: Edit `packages/bootstrap/src/ingest-context.ts`** — inject the ingest audit hook + audit plugin install/remove.

Add import:

```ts
import { createAuditStore, safeRecord } from '@openldr/audit';
```

After `const batches = createBatchStore(internal.db);` add:

```ts
  const audit = createAuditStore(internal.db);
```

Change the `eventing.subscribe` handler to pass the audit hook:

```ts
  await eventing.subscribe('ingest.received', (event) =>
    handleIngestEvent({ blob, persist, resolver, batches, logger, audit: (e) => safeRecord(audit, logger, e) }, event),
  );
```

Replace the returned `plugins,` member with an audit-wrapping facade (spread keeps `list`/`test`/`load`):

```ts
    plugins: {
      ...plugins,
      async install(wasm: Uint8Array, rawManifest: unknown) {
        const m = await plugins.install(wasm, rawManifest);
        await safeRecord(audit, logger, { actorType: 'system', actorName: 'system', action: 'plugin.install', entityType: 'plugin', entityId: `${m.id}@${m.version}`, metadata: { sha256: m.wasmSha256 } });
        return m;
      },
      async remove(id: string, version?: string) {
        await plugins.remove(id, version);
        await safeRecord(audit, logger, { actorType: 'system', actorName: 'system', action: 'plugin.remove', entityType: 'plugin', entityId: version ? `${id}@${version}` : id });
      },
    },
```

(`m.wasmSha256` is on the returned `PluginManifest`. The plugin runtime returns a plain closure object, so spreading it is safe — no `this` binding.)

- [ ] **Step 4: Typecheck + depcruise**

Run: `pnpm install && pnpm --filter @openldr/bootstrap typecheck && pnpm depcruise`
Expected: typecheck clean; depcruise NO violations (`@openldr/audit`/`@openldr/users` import no adapter). If depcruise flags a violation, STOP and report.

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(bootstrap): ctx.audit + ctx.users; audit ingest + plugin lifecycle (P1-AUD-2)"
```

---

## Task 6: CLI — `audit` + `user` commands + db-reset audit

**Files:**
- Create: `packages/cli/src/audit.ts`, `packages/cli/src/user.ts`
- Modify: `packages/cli/src/index.ts`, `packages/cli/src/db.ts`

- [ ] **Step 1: Create `packages/cli/src/audit.ts`**

```ts
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

interface ListOpts {
  actor?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  json: boolean;
}

export async function runAuditList(opts: ListOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = await ctx.audit.list({
      actorId: opts.actor,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      from: opts.from,
      to: opts.to,
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    } else {
      const lines = rows.map((r) => `  ${r.occurredAt}  ${r.actorName.padEnd(10)} ${r.action.padEnd(22)} ${r.entityType}/${r.entityId}`);
      process.stdout.write((lines.length ? lines.join('\n') : '  (no events)') + '\n');
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 2: Create `packages/cli/src/user.ts`**

```ts
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runUserList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const users = await ctx.users.list();
    emit(
      opts.json,
      users,
      users.map((u) => `  ${u.id.slice(0, 8)}  ${u.username.padEnd(16)} ${u.status.padEnd(9)} [${u.roles.join(', ')}]${u.subject ? ' sub=' + u.subject : ''}`).join('\n') || '  (no users)',
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserShow(id: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const u = await ctx.users.get(id);
    if (!u) {
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    emit(opts.json, u, `${u.username} (${u.id}) status=${u.status} roles=[${u.roles.join(', ')}] sub=${u.subject ?? '-'}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserCreate(opts: JsonOpt & { username: string; name?: string; email?: string; role?: string[] }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const u = await ctx.users.create({ username: opts.username, displayName: opts.name, email: opts.email, roles: opts.role });
    emit(opts.json, u, `created ${u.username} (${u.id})`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserSetRole(id: string, roles: string[], opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (!(await ctx.users.get(id))) {
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    await ctx.users.setRoles(id, roles);
    emit(opts.json, { id, roles }, `set roles for ${id}: [${roles.join(', ')}]`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserSetStatus(id: string, status: 'active' | 'disabled', opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (!(await ctx.users.get(id))) {
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    await ctx.users.setStatus(id, status);
    emit(opts.json, { id, status }, `${id} is now ${status}`);
    return 0;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 3: Register in `packages/cli/src/index.ts`** — add imports beside the others:

```ts
import { runAuditList } from './audit';
import { runUserList, runUserShow, runUserCreate, runUserSetRole, runUserSetStatus } from './user';
```

Insert before `program.parseAsync(process.argv);`:

```ts
const audit = program.command('audit').description('Append-only audit log');
audit
  .command('list')
  .option('--actor <id>', 'filter by actor id')
  .option('--entity-type <t>', 'filter by entity type')
  .option('--entity-id <id>', 'filter by entity id')
  .option('--action <a>', 'filter by action')
  .option('--from <iso>', 'occurred at or after (ISO)')
  .option('--to <iso>', 'occurred at or before (ISO)')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { actor?: string; entityType?: string; entityId?: string; action?: string; from?: string; to?: string; json: boolean }) => {
    try { process.exitCode = await runAuditList(opts); } catch (err) { process.stderr.write(`audit list failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });

const user = program.command('user').description('Local user management (decoupled from the IdP)');
user.command('list').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runUserList(opts); } catch (err) { process.stderr.write(`user list failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
user.command('show <id>').option('--json', 'emit JSON', false).action(async (id: string, opts: { json: boolean }) => {
  try { process.exitCode = await runUserShow(id, opts); } catch (err) { process.stderr.write(`user show failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
user
  .command('create')
  .requiredOption('--username <u>', 'username (unique)')
  .option('--name <n>', 'display name')
  .option('--email <e>', 'email')
  .option('--role <r...>', 'role (repeatable)')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { username: string; name?: string; email?: string; role?: string[]; json: boolean }) => {
    try { process.exitCode = await runUserCreate(opts); } catch (err) { process.stderr.write(`user create failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
user.command('set-role <id> <roles...>').option('--json', 'emit JSON', false).action(async (id: string, roles: string[], opts: { json: boolean }) => {
  try { process.exitCode = await runUserSetRole(id, roles, opts); } catch (err) { process.stderr.write(`user set-role failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
user.command('activate <id>').option('--json', 'emit JSON', false).action(async (id: string, opts: { json: boolean }) => {
  try { process.exitCode = await runUserSetStatus(id, 'active', opts); } catch (err) { process.stderr.write(`user activate failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
user.command('deactivate <id>').option('--json', 'emit JSON', false).action(async (id: string, opts: { json: boolean }) => {
  try { process.exitCode = await runUserSetStatus(id, 'disabled', opts); } catch (err) { process.stderr.write(`user deactivate failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
```

(`errorMessage` already imported.)

- [ ] **Step 4: Record an audit event on `db reset`** — in `packages/cli/src/db.ts` `runDbReset`, after the successful `await ctx.reset(...)` and before `emit(...)`, add (best-effort, must not fail the reset):

```ts
    try {
      const appCtx = await createAppContext(loadConfig());
      try {
        await appCtx.audit.record({ actorType: 'system', actorName: 'system', action: 'db.reset', entityType: 'database', entityId: 'internal+external' });
      } finally {
        await appCtx.close();
      }
    } catch {
      // audit is best-effort
    }
```

Ensure `db.ts` imports `createAppContext` from `@openldr/bootstrap` (add it to the existing bootstrap import) and `loadConfig` from `@openldr/config` (already imported for the db context).

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build`
Expected: typecheck clean; `dist/index.js` produced. (Runtime verified in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(cli): audit list + user management + db-reset audit (P1-CLI-1/2)"
```

---

## Task 7: Integration acceptance + final gate

> Requires the docker stack (Postgres + MinIO) and the WHONET plugin from sub-project 5.

- [ ] **Step 1: Migrate + verify tables**

Run: `docker compose up -d`; `pnpm openldr db reset --json`.
Verify: `docker compose exec -T postgres psql -U openldr -d openldr -c "\dt"` shows `audit_events` + `users` alongside the earlier tables.
Verify the db-reset audit row: `pnpm openldr audit list --action db.reset --json` → at least one `db.reset` event.

- [ ] **Step 2: Ingest → audit link (P1-AUD-2)**

Run: `pnpm build:plugins && pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm --json` (also produces a `plugin.install` audit row).
Run: `pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --source whonet --json` → batch done.
Verify: `pnpm openldr audit list --entity-type batch --json` → an `ingest.batch.done` event whose `metadata` has `source`, `pluginId: "whonet-sqlite"`, `pluginVersion`, `count`.
Verify: `pnpm openldr audit list --action plugin.install --json` → a `plugin.install` event.

- [ ] **Step 3: User lifecycle**

Run: `pnpm openldr user create --username op --name "Operator" --role admin --json` → returns a user with an id (note it).
Run: `pnpm openldr user list --json` → shows `op` (subject null, roles `["admin"]`).
Run: `pnpm openldr user set-role <id> admin auditor --json` then `pnpm openldr user show <id> --json` → roles `["admin","auditor"]`.
Run: `pnpm openldr user deactivate <id> --json` → status `disabled`; `pnpm openldr user activate <id>` → back to `active`.

- [ ] **Step 4: `syncFromClaims` links the subject**

Run (builds the context and links a subject to the pre-created `op` user):

```bash
pnpm exec tsx -e "import { createAppContext } from './packages/bootstrap/src/index'; import { loadConfig } from './packages/config/src/index'; const c = await createAppContext(loadConfig()); const u = await c.users.syncFromClaims({ sub: 'kc-1', preferred_username: 'op' }); process.stdout.write(JSON.stringify({ id: u.id, subject: u.subject }) + '\n'); await c.close();"
```
Expected: prints the `op` user's id with `subject: "kc-1"`. Confirm `pnpm openldr user list --json` still shows a single `op` user, now `sub=kc-1` (linked, not duplicated). (Adjust the `@openldr/config` import path if its entry differs — it exports `loadConfig`.)

- [ ] **Step 5: Final gate**

Run: `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build && pnpm --filter @openldr/server build:check`
Expected: typecheck clean; all tests pass; depcruise no violations (`@openldr/audit`/`@openldr/users` import no `adapter-*`); builds succeed; server smoke OK.

- [ ] **Step 6: Commit any lockfile delta**

Run: `git status --short` — commit `pnpm-lock.yaml` if changed (`chore: finalize audit/users lockfile`).

---

## Done criteria (maps to spec §10)

- [ ] Append-only `audit_events` + `AuditStore` (record/list/get) capturing actor/action/entity/before-after/timestamp (P1-AUD-1).
- [ ] Ingest batch done/failed + plugin install/remove + db reset emit audit events; ingest events carry provenance metadata (P1-AUD-2).
- [ ] `users` keyed by internal id + nullable IdP `subject`; `UserStore` + `syncFromClaims` JIT linking, decoupled from Keycloak (P1-USER-1).
- [ ] CLI `audit list` + `user list|show|create|set-role|activate|deactivate` with `--json` (P1-CLI-1/2).
- [ ] DP-1 intact (depcruise); audit writes best-effort (never break the audited op).
- [ ] `pnpm -r typecheck && test && depcruise && build` green; live docker acceptance shows the ingest→audit link + user lifecycle + subject linking.
