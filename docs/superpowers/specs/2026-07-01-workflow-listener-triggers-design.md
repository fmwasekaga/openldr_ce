# Workflow Listener Triggers — `postgres-trigger` + `email-trigger` (Slice I)

**Date:** 2026-07-01
**Status:** Approved design
**Workstream:** Workflow node palette — listener triggers tier.

## Goal

Implement the two remaining trigger placeholders, which fire a workflow from an
**external, long-lived connection** rather than an internal event:

- **`postgres-trigger`** — fires on a Postgres `LISTEN/NOTIFY` notification on an
  operator-defined channel.
- **`email-trigger`** — fires on new (unseen) IMAP mail, polled on an interval.

Both are built on one shared **listener manager** that owns connection lifecycle
(start/stop/reconcile/reconnect) and calls the existing `runAndRecord`.

## Key distinction from existing triggers

The current triggers (schedule/webhook/ingest/event) all subscribe to an
internal `EventingPort` and are driven by `createWorkflowTriggerRunner`
(`packages/workflows/src/trigger-runner.ts`). Listener triggers instead hold
**external** connections (a raw pg `LISTEN` socket; an IMAP poll loop). They need
a new host component with an explicit connection lifecycle — they cannot ride the
`EventingPort`.

## Non-goals (YAGNI)

- IMAP `IDLE` push (poll-on-interval only).
- Shared/pooled listener connections (one connection per listener node).
- Guaranteed Postgres delivery (`LISTEN/NOTIFY` is best-effort; missed while
  disconnected).
- Postgres logical-replication / automatic row-change CDC (the operator wires a
  DB trigger that `NOTIFY`s a channel).
- IMAP OAuth (basic auth only; gmail/outlook IMAP OAuth deferred).

## Architecture — the listener manager

A new host component `WorkflowListenerManager` in `packages/bootstrap`:

- **Spec extraction:** scans enabled workflows' definitions for trigger nodes
  with `triggerType: 'postgres' | 'email'` → a list of listener specs
  `{ workflowId, nodeId, triggerType, config }` (config = the node's `data.config`).
- **Active set:** keeps one active listener per spec, keyed `${workflowId}:${nodeId}`.
- **`sync(specs)`:** diffs desired-vs-active by key + a config hash — starts new,
  stops removed, restarts changed. Idempotent.
- **`reconcile()`:** loads all enabled workflows, computes specs, calls `sync`.
  Invoked on boot and re-invoked after every workflow create/update/delete/
  enable-toggle (alongside the existing `setIngest/EventWorkflowIds` re-sync in
  `apps/server/src/workflows-routes.ts`).
- **`stopAll()`:** stops every active listener; hooked into `ctx.close()`
  (SIGTERM/SIGINT in `apps/server/src/index.ts`).
- **Drivers:** each listener runs a driver implementing
  `start(spec, onFire): ListenerHandle` where
  `onFire(input: unknown, files?: Record<string, BinaryRef>) => Promise<void>` and
  `ListenerHandle = { stop(): Promise<void> }`. On fire, the manager calls
  `runAndRecord(workflowId, source, input, files)`.
- **Connector resolution:** the driver resolves + decrypts the referenced
  connector via `connectorStore` + `secretsKey` (same seam as the DB/email node
  services) at `start` time. A missing connector, wrong connector type, or
  connect failure is **logged and skipped** — a bad listener never crashes boot
  or the manager.
- **Master switch:** `cfg.WORKFLOW_LISTENERS_ENABLED` (default `true`) short-
  circuits the manager (all `reconcile`/`sync` become no-ops when false) — a
  clean disable for tests and listener-less deployments.

Wiring: constructed in `bootstrap/index.ts` with
`{ connectors, secretsKey, runAndRecord: workflowRunner.runAndRecord, writeBinary,
logger, cfg, drivers: { postgres, email } }`, exposed as `ctx.workflows.listeners`.

New `TriggerSource` union members: `'postgres'`, `'email'`
(`packages/workflows/src/types.ts`).

## `postgres-trigger` driver (`listener-postgres.ts`)

- **Node config:** `{ connectorId, channel }`.
- Resolves a **`postgres`-type** connector; reuses `buildPgUrl(config)` +
  `validatePort` from `connector-db.ts`.
- **New dependency:** `pg` (+ `@types/pg`) as a *direct* bootstrap dep — a raw
  node-postgres `Client` is required because `LISTEN` needs a dedicated
  persistent connection (the Kysely pool does not expose notifications).
- **Start:** `client.connect()` → validate channel against
  `^[A-Za-z_][A-Za-z0-9_]*$` (injection guard) → `client.query('LISTEN "<channel>"')`
  → `client.on('notification', (msg) => onFire(parsePayload(msg), files=undefined))`.
- **Payload parsing:** `JSON.parse(msg.payload)` when it parses to an object,
  else `{ payload: <raw string> }`; the resolved input always carries
  `{ channel, ...payload }` (channel added for context).
- **Reconnect:** on `client.on('error')` / `'end'`, reconnect with exponential
  backoff (1s → cap 30s) and re-`LISTEN`. `stop()` clears timers, removes
  listeners, `client.end()`.
- **Documented limitation:** Postgres does not queue `NOTIFY` for disconnected
  listeners; notifications during a reconnect window are missed (at-most-once).

## `email-trigger` driver (`listener-email.ts`)

- **New connector type `imap`** (basic auth): fields `host`, `port` (default
  993), `user`, `password`, `tls` (default `true`). Added to the connector model
  (a new `type` value; `kind:'communication'` or reuse the email grouping), the
  web `CONNECTOR_TYPE_FIELDS`, and the `connector-test` probe (connect + open
  `INBOX` + logout).
- **Node config:** `{ connectorId, folder='INBOX', pollSeconds=60, markSeen=true }`.
  `pollSeconds` clamped to `>= cfg.WORKFLOW_EMAIL_POLL_MIN_SECONDS` (default 30).
- **New dependencies:** `imapflow` (IMAP client) + `mailparser` (`simpleParser`).
- **Poll loop:** a self-scheduling timer (`setTimeout` re-arm, not `setInterval`)
  with an **overlap guard** (a `polling` flag; a tick that fires while the prior
  poll is still running is skipped). Each poll:
  1. Connect `imapflow` with the decrypted config → open `folder`.
  2. Search `UNSEEN`; take up to `cfg.WORKFLOW_EMAIL_MAX_PER_POLL` (default 50).
  3. Per message: fetch source → `simpleParser(source)` → build input
     `{ from, to, subject, date, text, html, headers }`; for each attachment,
     `writeBinary({ bytes, fileName, contentType })` (respecting
     `WORKFLOW_FILE_MAX_BYTES`; oversize → skip + log) → collect into `files`
     keyed `attachment_<n>` (plus a `attachments` metadata array of
     `{ field, fileName, contentType, byteSize }`).
  4. `await onFire(input, files)`.
  5. **After** `onFire` resolves, mark `\Seen` (`messageFlagsAdd(uid, ['\\Seen'])`)
     — **at-least-once**: a crash before this leaves the message unseen for the
     next poll.
  6. Logout.
- **Errors:** a poll error is logged and swallowed; the next tick reconnects
  (connect-per-poll → drops self-heal). `stop()` clears the timer and closes any
  open client.

## Data flow

```
external NOTIFY / new email
  → driver.onFire(input, files?)
    → manager → runAndRecord(workflowId, 'postgres'|'email', input, files)
      → trigger node emits `input`; attachments ride the trigger item's `binary`
        channel (identical to the ingest trigger's file handling)
    → run recorded (WorkflowRun with triggerSource 'postgres'|'email')
```

## Config knobs (`packages/config/src/schema.ts`)

- `WORKFLOW_LISTENERS_ENABLED` — boolean (`envBoolean`), default **true**.
- `WORKFLOW_EMAIL_POLL_MIN_SECONDS` — `z.coerce.number().int().positive().default(30)`.
- `WORKFLOW_EMAIL_MAX_PER_POLL` — `z.coerce.number().int().positive().default(50)`.
- Reuses the existing `WORKFLOW_FILE_MAX_BYTES` for attachment size caps.

## Components / files

- Create `packages/bootstrap/src/workflow-listeners.ts` — manager
  (`createWorkflowListenerManager`): spec extraction, `sync`/`reconcile`/`stopAll`,
  driver registry, master-switch short-circuit.
- Create `packages/bootstrap/src/listener-postgres.ts` — pg `LISTEN` driver.
- Create `packages/bootstrap/src/listener-email.ts` — IMAP poll driver.
- Modify `packages/bootstrap/src/connector-test.ts` — `imap` probe.
- Modify `packages/bootstrap/src/index.ts` — construct + expose
  `ctx.workflows.listeners`; hook `stopAll` into `ctx.close`.
- Modify `packages/config/src/schema.ts` — three knobs.
- Modify `packages/workflows/src/types.ts` — `TriggerSource` gains
  `'postgres' | 'email'`.
- Modify `apps/server/src/index.ts` — `await ctx.workflows.listeners.reconcile()`
  on boot (after the trigger runner's reconcile); ensure `ctx.close` stops it.
- Modify `apps/server/src/workflows-routes.ts` — call
  `ctx.workflows.listeners.reconcile()` after create/update/delete/enable-toggle
  (next to the existing `setIngest/EventWorkflowIds` re-sync).
- Web: create `node-forms/postgres-trigger-form.tsx` + `email-trigger-form.tsx`
  (register in `node-forms/index.tsx`); add `imap` to `CONNECTOR_TYPE_FIELDS`
  (`apps/web/src/pages/settings/Connectors.tsx`); add `'postgres-trigger'` +
  `'email-trigger'` to `IMPLEMENTED_TEMPLATE_IDS` and seed their `triggerType` +
  default config in `constants.ts` (reword the postgres node description to
  "Listen on a NOTIFY channel"); extend the trigger union in
  `apps/web/src/workflows/lib/types.ts` (`'postgres' | 'email'`).

New i18n keys (en/fr/pt) for the imap connector fields, per the Slice-D/E/F
convention.

## Error handling

- Bad/missing/wrong-type connector, or connect failure → log + skip the listener
  (never crashes boot/manager).
- Driver runtime errors → logged; pg reconnects with backoff, email self-heals
  next poll.
- `runAndRecord` already captures a failed workflow run.
- Channel name and `pollSeconds`/batch caps validated/clamped.

## Testing

- **Manager (`workflow-listeners.test.ts`):** spec extraction from definitions;
  `sync` diff (start new / stop removed / restart on config change); `stopAll`;
  master-switch off → no-op; bad connector → skip + log. Drivers injected as
  fakes.
- **postgres driver (`listener-postgres.test.ts`):** payload parse (JSON object
  vs raw string), channel validation rejects bad names, reconnect-on-error
  re-LISTENs (fake `pg` Client), `stop` cleans up.
- **email driver (`listener-email.test.ts`):** poll → parse → attachment
  materialization via a fake `writeBinary`; **mark-`\Seen` happens after
  `onFire`** (at-least-once ordering); `pollSeconds` clamp; batch cap; overlap
  guard skips a re-entrant tick; oversize attachment skipped. `imapflow` +
  `mailparser` mocked.
- **connector-test:** `imap` probe path.
- **config (`schema.test.ts`):** the three new knobs' defaults + coercion.
- **web:** the two forms render/write config; `imap` connector fields; palette
  enablement; isolated tests.
- **Gate (cross-package):** config, workflows (TriggerSource), bootstrap, server,
  web — tsc + tests. Live pg-`LISTEN` / IMAP e2e deferred to an accept script
  (not built here).

## Decisions (resolved during brainstorming)

- Combined slice: foundation + both listeners at once.
- IMAP: **poll-on-interval** (imapflow), min 30s; not IDLE.
- Email payload: metadata + text/html body **+ materialized attachments**
  (Slice-C `writeBinary` → trigger item `binary` channel).
- Dedup: **at-least-once** (mark `\Seen` after `runAndRecord`).
- `postgres-trigger` = `LISTEN/NOTIFY` on an operator-defined channel (not CDC);
  palette label reworded.
- New `imap` connector type = **basic auth only** (OAuth deferred).
- `WORKFLOW_LISTENERS_ENABLED` default **true**.
- One connection per listener node (no pooling/sharing).
