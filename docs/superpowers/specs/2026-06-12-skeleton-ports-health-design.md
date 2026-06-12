# Sub-project 1 — Skeleton + Four Ports + Health

**Date:** 2026-06-12
**Status:** Approved design (ready for implementation planning)
**PRD:** `openldr-ce-prd-phase1.md` — covers P1-CORE-1/2/3 and the `health` slice of P1-CLI-1/2
**Build-sequence step:** §8 step 1

---

## 1. Purpose & scope

This is the foundation every later Phase-1 sub-project bolts onto. It delivers:

- A Turborepo + pnpm modular-monolith workspace with the Phase-1 module topology (P1-CORE-1).
- The four ports defined as interfaces, each with a default adapter wired behind config; no core/domain module imports a concrete adapter (P1-CORE-2).
- A config system that selects adapters per deployment and a health-check per adapter (P1-CORE-3).
- A `health` surface in two faces — `GET /health` (server) and `openldr health [--json]` (CLI) — over one shared aggregator (P1-CLI-1 health slice, P1-CLI-2 `--json`).
- A docker-compose stack (Postgres + MinIO + Keycloak) so the default adapters connect to **real** infrastructure and health reports true liveness.

**Out of scope for this sub-project (documented seams only):**

- FHIR layer, forms engine, ingest pipeline, plugin runtime, reporting, audit, users — these are placeholder packages now, built in their own later sub-projects.
- `apps/web` (SPA shell) — deferred to the UI sub-project; standing up Vite/Tailwind/shadcn now would be half a UI with no backend to talk to.
- nginx single-port reverse proxy (P1-NFR-7) — later; the design stays proxy-relative so it slots in cleanly.
- Real token verification, real outbox/worker eventing — interfaces are defined now; full implementations land in their respective steps (auth with users §5.8, eventing with ingest §8 step 4).

---

## 2. Cross-cutting principles this sub-project must demonstrate

- **DP-1 Hexagonal / ports-and-adapters** — infrastructure sits behind interfaces; the composition root is the only place that names a concrete adapter.
- **DP-4 Agent-operability** — `openldr health --json` is the agent's inspection surface.
- **DP-5 Lean by default** — Postgres-first, no Kafka/OpenSearch.
- **DP-7 Graceful degradation & observability** — one adapter being down degrades only that check; structured pino logs throughout.

---

## 3. Repository layout

Turborepo + pnpm workspace. Every module is a package; a thin `apps/server` composes them into one deployable.

```
openldr_ce/
├─ package.json            # private root, packageManager: pnpm@11.x, engines node>=20
├─ pnpm-workspace.yaml     # packages: ['apps/*','packages/*']
├─ turbo.json              # build · typecheck · lint · test · dev
├─ tsconfig.base.json
├─ .env.example
├─ docker-compose.yml      # postgres · minio · keycloak
├─ .dependency-cruiser.cjs # boundary enforcement (DP-1)
├─ packages/
│  ├─ ports/               # @openldr/ports     — interfaces only, zero runtime deps
│  ├─ config/              # @openldr/config    — zod-validated env → typed config
│  ├─ core/                # @openldr/core      — pino logger, error types, HealthRegistry
│  ├─ bootstrap/           # @openldr/bootstrap — composition root (ONLY importer of adapter-*)
│  ├─ adapter-auth/        # @openldr/adapter-auth       → AuthPort (OIDC; Keycloak default)
│  ├─ adapter-s3-bucket/   # @openldr/adapter-s3-bucket  → BlobStoragePort (MinIO default)
│  ├─ adapter-event-bus/   # @openldr/adapter-event-bus  → EventingPort (pg outbox default)
│  ├─ adapter-db-store/    # @openldr/adapter-db-store   → TargetStorePort (Postgres default)
│  ├─ cli/                 # @openldr/cli       — `openldr` bin; health command
│  ├─ fhir/                # placeholder module package (P1-CORE-1 topology)
│  ├─ forms/               # placeholder
│  ├─ ingest/              # placeholder
│  ├─ plugins/             # placeholder
│  ├─ reporting/           # placeholder
│  ├─ audit/               # placeholder
│  └─ users/               # placeholder
└─ apps/
   └─ server/              # @openldr/server    — Fastify app, /health route
```

The seven domain placeholder packages exist only to **lock the boundary graph now** (P1-CORE-1); each is a stub `src/index.ts` exporting a module descriptor. Real content lands in their own later sub-projects.

### Naming principle: adapters are keyed to protocol/standard, not vendor

Each adapter package is named for the capability/standard it speaks, not the product behind it. This collapses most of the PRD's "future adapters" into **config of the same package** rather than new code:

| Port | Adapter package | Phase-1 default impl (config-selected) | Future impls |
|------|-----------------|----------------------------------------|--------------|
| `AuthPort` | `@openldr/adapter-auth` | Keycloak (OIDC) | any OIDC provider — config |
| `BlobStoragePort` | `@openldr/adapter-s3-bucket` | MinIO | any S3-compatible; local FS — config |
| `EventingPort` | `@openldr/adapter-event-bus` | Postgres outbox + `pg_notify` | Kafka/Inngest = a *sibling* package later |
| `TargetStorePort` | `@openldr/adapter-db-store` | Postgres (Kysely pg dialect) | MSSQL / Oracle — Kysely dialect, same package |

`docker-compose.yml` names the concrete services (`postgres`, `minio`, `keycloak`) — those are what the default config points the protocol-keyed adapters at. The only genuinely different-technology future case is eventing (pg-outbox vs Kafka), where a vendor-suffixed sibling is justified if and when Kafka lands; the Phase-1 default stays vendor-neutral.

---

## 4. The four ports

`@openldr/ports` defines pure TypeScript interfaces and zero runtime dependencies. Every port exposes a `HealthCheck` contract:

```ts
interface HealthCheck {
  name: string;                       // e.g. 'auth', 'blob', 'eventing', 'target-store'
  check(): Promise<HealthResult>;
}
interface HealthResult {
  status: 'up' | 'down' | 'degraded';
  latencyMs: number;
  detail?: string;                    // never includes secrets (P1-NFR-2)
}
```

Phase-1 interface surface per port (only what this sub-project needs; rest is stubbed with typed signatures for later):

| Port | Phase-1 methods | Skeleton liveness probe |
|------|------------------|--------------------------|
| `AuthPort` | `healthCheck()` (+ typed `verifyToken` signature, impl later) | reach realm OIDC discovery doc |
| `BlobStoragePort` | `put` / `get` / `exists` / `presign` / `healthCheck()` | bucket reachable / ensure-bucket |
| `EventingPort` | `publish` / `subscribe` (full outbox in §8 step 4) / `healthCheck()` | `pg_notify` capability check |
| `TargetStorePort` | `query` / `transaction` (via Kysely) / `healthCheck()` | `SELECT 1` round-trip |

Adapters depend only on `@openldr/ports` (+ `@openldr/core` for logging/errors). No domain module ever imports an adapter.

---

## 5. Config + composition root (DP-1 enforced)

- `@openldr/config` loads env via dotenv, validates with **zod** into a typed, frozen config object. It selects an adapter per port (`AUTH_ADAPTER=keycloak`, `BLOB_ADAPTER=minio`, `EVENTING_ADAPTER=pg`, `TARGET_STORE_ADAPTER=pg`) and carries connection settings per adapter. Invalid/missing config fails fast with a clear error (no silent defaults for required secrets).
- `@openldr/bootstrap` is the **single place** that imports concrete adapter packages. It exposes:

  ```ts
  function createAppContext(config: Config): Promise<AppContext>;
  interface AppContext {
    logger: Logger;            // pino
    auth: AuthPort;
    blob: BlobStoragePort;
    eventing: EventingPort;
    store: TargetStorePort;
    health: HealthRegistry;    // aggregates all four checks
    close(): Promise<void>;    // graceful teardown of connections
  }
  ```

Both `apps/server` and `packages/cli` build their world through this one factory — swapping an adapter is a config change, never a code change.

- `@openldr/core` holds the kernel: a pino logger factory (with batch/correlation-id support for later), shared error types, and `HealthRegistry` (registers `HealthCheck`s, runs them concurrently, aggregates to an overall status). `core` depends only on `ports`.

---

## 6. Health surface (two faces, one source — DP-4)

- **Server:** `apps/server` is a Fastify app using Fastify's built-in pino. `GET /health` runs the aggregated checks and returns `200` when all are `up`, `503` if any is `down`, with a JSON body listing each adapter's status, latency, and detail. Route is proxy-relative (no host:port assumptions, P1-NFR-7 / P1-UI-5).
- **CLI:** `packages/cli` exposes the `openldr` bin (commander-based). `openldr health [--json]` calls the same aggregator via `createAppContext`. Human output is a table; `--json` is machine-readable for agents (P1-CLI-2). Exit code is non-zero if any adapter is `down`.

Both faces share the exact same `HealthRegistry` result — no duplicated probing logic.

---

## 7. Boundary enforcement & tooling

- **dependency-cruiser** is the teeth behind DP-1. Rules:
  - Only `packages/bootstrap` may import `packages/adapter-*`.
  - `core`, `ports`, `config`, and all domain module packages importing an `adapter-*` fails CI.
  - Domain modules may not import `apps/*`.
  - `ports` may not import anything in the workspace except types.
- **TypeScript** strict mode, project references via `tsconfig.base.json`.
- **ESLint** for general lint.
- **Vitest** for unit tests (matches Corlix's test runner).
- **Turborepo** task graph: `build`, `typecheck`, `lint`, `test`, `dev`.
- pnpm version pinned (`packageManager: pnpm@11.x`), lockfile committed (P1-CONV-1).
- Commit attribution: no `Co-authored-by` trailers (P1-CONV-2).

---

## 8. Testing & acceptance (the spine test)

**Unit**
- zod config validation: rejects missing required vars, accepts valid env, selects the right adapter per port.
- `HealthRegistry` aggregation logic with fake adapters (all-up → `up`; one down → overall `down`; concurrency).
- Each adapter's `check()` against its client (containerized or mocked client).

**Integration acceptance (the proof DP-1 + DP-7 hold)**
1. `docker-compose up -d` brings up postgres + minio + keycloak.
2. `openldr health --json` → all four adapters report `up`; exit 0.
3. Stop MinIO → `openldr health --json` → `blob` reports `down`, exit non-zero, the other three stay `up`, nothing crashes.
4. `GET /health` mirrors the same statuses (`503` when blob is down).

**Boundary**
- `dependency-cruiser` passes: no illegal adapter imports anywhere outside `bootstrap`.

**Build/quality gate**
- `pnpm install` clean; `turbo build typecheck lint test` all green.

---

## 9. Acceptance criteria checklist

- [ ] Turborepo + pnpm workspace bootstraps; pnpm pinned, lockfile committed.
- [ ] All Phase-1 module packages exist with locked boundaries (P1-CORE-1).
- [ ] Four ports defined as interfaces in `@openldr/ports` (P1-CORE-2).
- [ ] Four default adapters implemented, protocol-keyed names, only imported by `bootstrap` (P1-CORE-2).
- [ ] Config selects adapters per deployment and fails fast on bad config (P1-CORE-3).
- [ ] Health-check per adapter; `GET /health` and `openldr health --json` both work off one aggregator (P1-CORE-3, P1-CLI-1/2).
- [ ] docker-compose stack runs; health reports true liveness.
- [ ] Graceful degradation proven: killing one service degrades only its check (DP-7).
- [ ] dependency-cruiser enforces DP-1; CI green.
- [ ] No secrets logged (P1-NFR-2); structured pino logs (P1-OBS-1).

---

## 10. Open items carried forward (not blocking this sub-project)

- AGPL-3.0 license headers pending company/legal sign-off (§9) — no headers added yet.
- `apps/web` scaffold deferred to the UI sub-project.
- Full eventing outbox/worker + real token verification deferred to their respective steps.
