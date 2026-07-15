# `db seed` refuses to run against a stale schema — design

**Date:** 2026-07-15
**Status:** approved
**Slice:** CLI ergonomics (independent of the AUTH_DEV_BYPASS slice)

## Problem

`pnpm openldr db seed` does not run migrations, and nothing in dev does either
(`MIGRATE_ON_START` defaults `false`; `install/development.sh` only initialises the DB on a
fresh env or `--reset-db`). So a `git pull` that brings new migrations leaves the dev
database behind the code, and the next `db seed` fails in a way that hides the cause.

Observed: a dev DB at migration `052` against code at `055`. `runDbSeed` calls
`createDbContext` then `createAppContext` (`packages/cli/src/db.ts:54`); `createAppContext`
boots the SEC-06 workflow-secret shim, which tries to seal `wf-sample`'s webhook secret
into a `workflow_secrets` table that migration `053` had not yet created. The shim is
deliberately warn-and-continue, so it logged a 30-line `DatabaseError` stack trace
(`relation "workflow_secrets" does not exist`) and carried on. Seed then reported
`seeded 3 resources, 0 forms, 0 workflow(s)…` and exited **0**.

The operator sees a scary stack trace, a success exit code, and no statement of the actual
problem or its remedy.

## Design

### 1. `pendingMigrations()` on `DbContext` (`packages/bootstrap/src/db-context.ts`)

```ts
pendingMigrations(): Promise<{ internal: string[]; external: string[] }>
```

Kysely's `Migrator.getMigrations()` returns each migration with an optional `executedAt`;
filter for absent and map to `.name`. Reuses the `internalMigrator` / `externalMigrator`
handles already constructed at `db-context.ts:44`, so it opens no new connections. It sits
beside `migrateAll()` as its read-only sibling: one place that knows how to ask "what is
outstanding", available to any future caller.

### 2. The guard in `runDbSeed` (`packages/cli/src/db.ts`)

The ordering is load-bearing: the check must run **before** `createAppContext`, because
that is what triggers the SEC-06 shim and its stack trace. Guard after it and the noise
still comes first.

Human output:

```
db seed refused: the database schema is behind the code (4 pending migrations).
  internal: 053_workflow_secrets, 054_sync_amendments, 055_sync_quarantine
  external: 008_patients_merge

Run `pnpm openldr db migrate` first, then re-run `pnpm openldr db seed`.
```

JSON mode: `{ ok: false, error: 'pending_migrations', pending: { internal, external } }`.

Returns `1`; `packages/cli/src/index.ts:116` already maps the return value to
`process.exitCode`.

Both internal and external migrations are checked — the observed case had external
`008_patients_merge` pending too, and seed writes to both.

### 3. No escape hatch

No `--force` / `--skip-migration-check`. Seeding onto a stale schema is never correct, and
`db migrate` is non-destructive and fast. Nothing automated breaks: the only automated
callers of `db seed` are `install/development.sh:100` and `install/development.ps1:96`, and
both run `db reset` immediately before, which migrates to latest.

### 4. No error-code catalog entry

The `DB` prefix in `packages/core/src/error-catalog.ts` is taken by *dashboards*, and every
entry carries an `httpStatus` that is meaningless for a CLI-only failure. A new domain
prefix for one non-HTTP error is not worth it.

### 5. Incidental fix in the same function

`runDbSeed` currently calls `createAppContext` *outside* its `try`, so if it throws, the
already-created `ctx` never closes. The restructuring for the guard fixes this.

## Testing

New `packages/cli/src/db.test.ts`, following the `vi.mock('@openldr/bootstrap')` idiom from
`read-commands.test.ts`. Written first:

1. pending migrations → returns `1`, message names the pending migrations and
   `db migrate`, and **`createAppContext` is never called** (locks in the ordering
   guarantee, which is the crux of the fix);
2. clean database → seeds normally, returns `0`;
3. `--json` with pending → emits the `pending_migrations` shape;
4. both contexts are closed on the refusal path (no leak).

## Docs

The web dev docs are not merely missing `db migrate` — they actively recommend the
destructive alternative for this exact symptom.

- `apps/web/src/docs/0.1.0/development.md:56` currently says: *"If the app shows empty data
  or the server logs `relation "…" does not exist`, run `pnpm openldr db reset` then
  `pnpm openldr db seed`"*. That is the observed symptom, and `db reset` **drops and
  recreates the schema**, destroying dev data. Replace with `db migrate`.
- Add a `pnpm openldr db migrate` row to the Handy-commands table (it lists `reset` and
  `seed` only).
- Add a short note that dev does not auto-migrate (`MIGRATE_ON_START=false`), so
  `db migrate` is the step after every pull that brings migrations.
- `apps/web/src/docs/0.1.0/cli.md:48` — the Common-tasks example is `db reset` + `db seed`;
  add `db migrate`. `db migrate` currently appears in the command table at line 27 and in
  **zero** examples.

Framing throughout: **`db migrate` to catch up (safe), `db reset` to wipe (destructive)** —
the distinction the docs currently invert. `docs/OPERATOR-GUIDE.md` already uses
`db migrate` correctly; the dev-facing docs are the outlier.

## Out of scope

- **`SEED_ON_START` (`apps/server/src/index.ts:68`)** calls `seedDatabase` directly and
  would hit the same trap if `MIGRATE_ON_START` were off while `SEED_ON_START` was on. In
  the shipped prod demo both are on and the migrate block (`index.ts:39`) runs first, so
  the combination is currently unreachable. Placing the guard inside `seedDatabase` would
  cover both callers, but turning a boot warning into a boot crash is a bigger behavioural
  change than this slice warrants. Noted as a follow-up.
- Making `db seed` auto-migrate. Rejected: it would silently mutate schema from a command
  named "seed", and `MIGRATE_ON_START` is already the explicit opt-in for that behaviour.
