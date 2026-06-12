# Skeleton + Four Ports + Health — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the OpenLDR CE modular-monolith workspace with the four ports, their default adapters wired behind config, and a health surface (`GET /health` + `openldr health --json`) proven against a real docker-compose stack.

**Architecture:** Turborepo + pnpm workspace. Pure interfaces live in `@openldr/ports`; the kernel (logger, errors, health aggregation) in `@openldr/core`; typed config in `@openldr/config`; one adapter package per protocol (`adapter-auth`/`adapter-s3-bucket`/`adapter-event-bus`/`adapter-db-store`); a single composition root `@openldr/bootstrap` that is the only importer of concrete adapters. `apps/server` (Fastify) and `@openldr/cli` both build their world through `createAppContext(config)`. dependency-cruiser enforces the boundaries in CI.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), pnpm 11, Turborepo, Vitest, tsx (dev), tsup (app builds), Fastify + pino, Kysely + pg, @aws-sdk/client-s3, commander, zod, dotenv, dependency-cruiser. Infra: Postgres + MinIO + Keycloak via docker-compose.

**Reference:** `docs/superpowers/specs/2026-06-12-skeleton-ports-health-design.md`

**Conventions:** All commits use `git -c commit.gpgsign=false commit` with **no** `Co-authored-by` trailer (P1-CONV-2). Local-file imports omit extensions (Bundler resolution). Type-only imports use `import type` (`verbatimModuleSyntax`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` | Workspace root + task graph + shared TS config |
| `.gitignore`, `.env.example`, `.dependency-cruiser.cjs` | Ignores, env template, boundary rules |
| `docker-compose.yml` | Postgres + MinIO + Keycloak + bucket-init |
| `packages/ports/src/*` | Pure port interfaces + health contract |
| `packages/core/src/*` | pino logger, error types, `probe()`, `HealthRegistry` |
| `packages/config/src/*` | zod schema + `loadConfig()` |
| `packages/adapter-db-store/src/*` | `TargetStorePort` over Kysely/pg |
| `packages/adapter-s3-bucket/src/*` | `BlobStoragePort` over S3 SDK |
| `packages/adapter-event-bus/src/*` | `EventingPort` over pg + `pg_notify` |
| `packages/adapter-auth/src/*` | `AuthPort` over OIDC discovery |
| `packages/bootstrap/src/*` | `createAppContext()` composition root |
| `packages/cli/src/*` | `openldr` bin; `health` command |
| `apps/server/src/*` | Fastify app; `GET /health` |
| `packages/{fhir,forms,ingest,plugins,reporting,audit,users}/src/index.ts` | Placeholder module packages (boundary topology) |

---

## Task 1: Workspace root scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.npmrc`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
.turbo/
*.tsbuildinfo
.env
coverage/
```

- [ ] **Step 2: Create `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 4: Create root `package.json`**

```json
{
  "name": "openldr",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@11.5.2",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "turbo build",
    "typecheck": "turbo typecheck",
    "lint": "turbo lint",
    "test": "turbo test",
    "depcruise": "depcruise packages apps --config .dependency-cruiser.cjs",
    "openldr": "tsx packages/cli/src/index.ts"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "dependency-cruiser": "^16.4.0",
    "tsup": "^8.3.5",
    "tsx": "^4.19.2",
    "turbo": "^2.3.3",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 5: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

- [ ] **Step 6: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": {},
    "lint": {},
    "test": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 7: Install and verify**

Run: `pnpm install`
Expected: completes, writes `pnpm-lock.yaml`, no workspace packages yet (warnings about empty workspace are fine).

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "chore: bootstrap turborepo + pnpm workspace (P1-CORE-1)"
```

---

## Task 2: `@openldr/ports` — port interfaces + health contract

**Files:**
- Create: `packages/ports/package.json`, `packages/ports/tsconfig.json`, `packages/ports/src/health.ts`, `packages/ports/src/auth.ts`, `packages/ports/src/blob.ts`, `packages/ports/src/eventing.ts`, `packages/ports/src/target-store.ts`, `packages/ports/src/index.ts`
- Test: `packages/ports/src/health.test.ts`

- [ ] **Step 1: Create `packages/ports/package.json`**

```json
{
  "name": "@openldr/ports",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": { "kysely": "^0.27.5" },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/ports/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `packages/ports/src/health.ts`**

```ts
export type HealthStatus = 'up' | 'down' | 'degraded';

export interface HealthResult {
  status: HealthStatus;
  latencyMs: number;
  detail?: string;
}

export interface HealthCheck {
  readonly name: string;
  check(): Promise<HealthResult>;
}

export const PORT_NAMES = ['auth', 'blob', 'eventing', 'target-store'] as const;
export type PortName = (typeof PORT_NAMES)[number];
```

- [ ] **Step 4: Write the failing test `packages/ports/src/health.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { PORT_NAMES } from './health';

describe('PORT_NAMES', () => {
  it('lists the four phase-1 ports', () => {
    expect(PORT_NAMES).toEqual(['auth', 'blob', 'eventing', 'target-store']);
  });
});
```

- [ ] **Step 5: Create `packages/ports/src/auth.ts`**

```ts
import type { HealthResult } from './health';

export interface TokenClaims {
  sub: string;
  [claim: string]: unknown;
}

export interface AuthPort {
  healthCheck(): Promise<HealthResult>;
  /** Implemented in a later sub-project (users/auth). */
  verifyToken(token: string): Promise<TokenClaims>;
}
```

- [ ] **Step 6: Create `packages/ports/src/blob.ts`**

```ts
import type { HealthResult } from './health';

export interface BlobStoragePort {
  healthCheck(): Promise<HealthResult>;
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  presign(key: string, expiresInSeconds?: number): Promise<string>;
}
```

- [ ] **Step 7: Create `packages/ports/src/eventing.ts`**

```ts
import type { HealthResult } from './health';

export interface EventEnvelope {
  type: string;
  payload: unknown;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export interface EventingPort {
  healthCheck(): Promise<HealthResult>;
  /** Full outbox/worker semantics land in the ingest sub-project (§8 step 4). */
  publish(event: EventEnvelope): Promise<void>;
  subscribe(type: string, handler: EventHandler): Promise<void>;
}
```

- [ ] **Step 8: Create `packages/ports/src/target-store.ts`**

```ts
import type { Kysely } from 'kysely';
import type { HealthResult } from './health';

// Phase-1 schema is open; concrete tables arrive with the flattening layer (§8 step 2).
export type TargetSchema = Record<string, unknown>;

export interface TargetStorePort {
  healthCheck(): Promise<HealthResult>;
  readonly db: Kysely<TargetSchema>;
  transaction<T>(fn: (trx: Kysely<TargetSchema>) => Promise<T>): Promise<T>;
}
```

- [ ] **Step 9: Create `packages/ports/src/index.ts`**

```ts
export * from './health';
export * from './auth';
export * from './blob';
export * from './eventing';
export * from './target-store';
```

- [ ] **Step 10: Add to workspace and run the test**

Run: `pnpm install && pnpm --filter @openldr/ports test`
Expected: 1 test passes.

- [ ] **Step 11: Typecheck**

Run: `pnpm --filter @openldr/ports typecheck`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(ports): define four port interfaces + health contract (P1-CORE-2)"
```

---

## Task 3: `@openldr/core` — logger, errors, probe, HealthRegistry

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/logger.ts`, `packages/core/src/errors.ts`, `packages/core/src/redact.ts`, `packages/core/src/probe.ts`, `packages/core/src/health-registry.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/redact.test.ts`, `packages/core/src/probe.test.ts`, `packages/core/src/health-registry.test.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@openldr/core",
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
    "@openldr/ports": "workspace:*",
    "pino": "^9.5.0"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `packages/core/src/logger.ts`**

```ts
import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(opts?: { level?: string; name?: string }): Logger {
  return pino({
    name: opts?.name ?? 'openldr',
    level: opts?.level ?? process.env.LOG_LEVEL ?? 'info',
  });
}
```

- [ ] **Step 4: Create `packages/core/src/errors.ts`**

```ts
export class OpenLdrError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends OpenLdrError {}
export class AdapterError extends OpenLdrError {}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const base = err.message || err.name || 'Error';
    if (err.cause instanceof Error && err.cause.message && err.cause.message !== err.message) {
      return `${base}: ${err.cause.message}`;
    }
    return base;
  }
  return String(err);
}
```

- [ ] **Step 5: Write the failing test `packages/core/src/redact.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('masks credentials in connection strings', () => {
    expect(redact('postgres://user:s3cret@db:5432/x')).toBe('postgres://user:***@db:5432/x');
  });
  it('leaves plain text untouched', () => {
    expect(redact('connection refused')).toBe('connection refused');
  });
});
```

- [ ] **Step 6: Run it to verify failure**

Run: `pnpm --filter @openldr/core test redact`
Expected: FAIL — cannot find module `./redact`.

- [ ] **Step 7: Create `packages/core/src/redact.ts`**

```ts
// Mask the password in URL userinfo (scheme://user:password@host) so secrets
// never reach logs/health detail (P1-NFR-2).
export function redact(text: string): string {
  return text.replace(/(\/\/[^\s:@/]+:)[^\s@]+(@)/g, '$1***$2');
}
```

- [ ] **Step 8: Run it to verify pass**

Run: `pnpm --filter @openldr/core test redact`
Expected: PASS (2 tests).

- [ ] **Step 9: Write the failing test `packages/core/src/probe.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { probe } from './probe';

describe('probe', () => {
  it('returns up with detail on success', async () => {
    const r = await probe(async () => 'ok');
    expect(r.status).toBe('up');
    expect(r.detail).toBe('ok');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns down with redacted detail on throw', async () => {
    const r = await probe(async () => {
      throw new Error('connect postgres://u:pw@h/db failed');
    });
    expect(r.status).toBe('down');
    expect(r.detail).toContain('u:***@h');
  });
});
```

- [ ] **Step 10: Run it to verify failure**

Run: `pnpm --filter @openldr/core test probe`
Expected: FAIL — cannot find module `./probe`.

- [ ] **Step 11: Create `packages/core/src/probe.ts`**

```ts
import type { HealthResult } from '@openldr/ports';
import { errorMessage } from './errors';
import { redact } from './redact';

/** Time a liveness probe; convert success/throw into a HealthResult. */
export async function probe(fn: () => Promise<string | void>): Promise<HealthResult> {
  const start = performance.now();
  try {
    const detail = await fn();
    return {
      status: 'up',
      latencyMs: Math.round(performance.now() - start),
      detail: detail === undefined || detail === '' ? undefined : detail,
    };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - start),
      detail: redact(errorMessage(err)),
    };
  }
}
```

- [ ] **Step 12: Run it to verify pass**

Run: `pnpm --filter @openldr/core test probe`
Expected: PASS (2 tests).

- [ ] **Step 13: Write the failing test `packages/core/src/health-registry.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { HealthCheck, HealthResult } from '@openldr/ports';
import { HealthRegistry } from './health-registry';

function fake(name: string, result: HealthResult | (() => Promise<HealthResult>)): HealthCheck {
  return { name, check: typeof result === 'function' ? result : async () => result };
}

describe('HealthRegistry', () => {
  it('aggregates to up when all checks are up', async () => {
    const reg = new HealthRegistry();
    reg.register(fake('a', { status: 'up', latencyMs: 1 }));
    reg.register(fake('b', { status: 'up', latencyMs: 1 }));
    const out = await reg.runAll();
    expect(out.status).toBe('up');
    expect(Object.keys(out.checks)).toEqual(['a', 'b']);
  });

  it('aggregates to down when any check is down', async () => {
    const reg = new HealthRegistry();
    reg.register(fake('a', { status: 'up', latencyMs: 1 }));
    reg.register(fake('b', { status: 'down', latencyMs: 1, detail: 'boom' }));
    const out = await reg.runAll();
    expect(out.status).toBe('down');
    expect(out.checks.b.detail).toBe('boom');
  });

  it('treats a thrown check as down, not a crash', async () => {
    const reg = new HealthRegistry();
    reg.register(fake('a', async () => { throw new Error('explode'); }));
    const out = await reg.runAll();
    expect(out.status).toBe('down');
    expect(out.checks.a.status).toBe('down');
  });
});
```

- [ ] **Step 14: Run it to verify failure**

Run: `pnpm --filter @openldr/core test health-registry`
Expected: FAIL — cannot find module `./health-registry`.

- [ ] **Step 15: Create `packages/core/src/health-registry.ts`**

```ts
import type { HealthCheck, HealthResult, HealthStatus } from '@openldr/ports';
import { errorMessage } from './errors';
import { redact } from './redact';

export interface AggregatedHealth {
  status: HealthStatus;
  checks: Record<string, HealthResult>;
}

export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();

  register(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  async runAll(): Promise<AggregatedHealth> {
    const items = [...this.checks.values()];
    const settled = await Promise.all(
      items.map(async (c): Promise<readonly [string, HealthResult]> => {
        const start = performance.now();
        try {
          return [c.name, await c.check()] as const;
        } catch (err) {
          return [
            c.name,
            { status: 'down', latencyMs: Math.round(performance.now() - start), detail: redact(errorMessage(err)) },
          ] as const;
        }
      }),
    );

    const checks: Record<string, HealthResult> = {};
    let status: HealthStatus = 'up';
    for (const [name, result] of settled) {
      checks[name] = result;
      if (result.status === 'down') status = 'down';
      else if (result.status === 'degraded' && status === 'up') status = 'degraded';
    }
    return { status, checks };
  }
}
```

- [ ] **Step 16: Run it to verify pass**

Run: `pnpm --filter @openldr/core test health-registry`
Expected: PASS (3 tests).

- [ ] **Step 17: Create `packages/core/src/index.ts`**

```ts
export * from './logger';
export * from './errors';
export * from './redact';
export * from './probe';
export * from './health-registry';
```

- [ ] **Step 18: Install, typecheck, full test**

Run: `pnpm install && pnpm --filter @openldr/core typecheck && pnpm --filter @openldr/core test`
Expected: typecheck clean; 7 tests pass.

- [ ] **Step 19: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(core): logger, errors, probe, HealthRegistry (DP-7)"
```

---

## Task 4: `@openldr/config` — zod schema + loader

**Files:**
- Create: `packages/config/package.json`, `packages/config/tsconfig.json`, `packages/config/src/schema.ts`, `packages/config/src/load.ts`, `packages/config/src/index.ts`
- Test: `packages/config/src/load.test.ts`

- [ ] **Step 1: Create `packages/config/package.json`**

```json
{
  "name": "@openldr/config",
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
    "dotenv": "^16.4.7",
    "zod": "^3.24.1"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/config/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `packages/config/src/schema.ts`**

```ts
import { z } from 'zod';

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  AUTH_ADAPTER: z.enum(['keycloak']).default('keycloak'),
  BLOB_ADAPTER: z.enum(['minio']).default('minio'),
  EVENTING_ADAPTER: z.enum(['pg']).default('pg'),
  TARGET_STORE_ADAPTER: z.enum(['pg']).default('pg'),

  // Internal operational Postgres (always pg) — used by the event bus.
  INTERNAL_DATABASE_URL: z.string().url(),
  // External analytics / target store.
  TARGET_DATABASE_URL: z.string().url(),

  // S3 / blob storage.
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  // OIDC issuer (Keycloak realm base URL).
  OIDC_ISSUER_URL: z.string().url(),
});

export type Config = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 4: Write the failing test `packages/config/src/load.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './load';

const valid = {
  INTERNAL_DATABASE_URL: 'postgres://u:p@localhost:5432/openldr',
  TARGET_DATABASE_URL: 'postgres://u:p@localhost:5432/openldr_target',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'minio',
  S3_SECRET_ACCESS_KEY: 'minio12345',
  S3_BUCKET: 'openldr',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/master',
};

describe('loadConfig', () => {
  it('parses a valid env and applies defaults', () => {
    const cfg = loadConfig(valid);
    expect(cfg.AUTH_ADAPTER).toBe('keycloak');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('throws a ConfigError listing missing required vars', () => {
    expect(() => loadConfig({})).toThrowError(/INTERNAL_DATABASE_URL/);
  });
});
```

- [ ] **Step 5: Run it to verify failure**

Run: `pnpm --filter @openldr/config test`
Expected: FAIL — cannot find module `./load`.

- [ ] **Step 6: Create `packages/config/src/load.ts`**

```ts
import { config as loadDotenv } from 'dotenv';
import { ConfigError } from '@openldr/core';
import { ConfigSchema, type Config } from './schema';

let dotenvLoaded = false;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env && !dotenvLoaded) {
    loadDotenv();
    dotenvLoaded = true;
  }
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }
  return Object.freeze(parsed.data);
}
```

- [ ] **Step 7: Run it to verify pass**

Run: `pnpm --filter @openldr/config test`
Expected: PASS (2 tests).

- [ ] **Step 8: Create `packages/config/src/index.ts`**

```ts
export * from './schema';
export * from './load';
```

- [ ] **Step 9: Install, typecheck**

Run: `pnpm install && pnpm --filter @openldr/config typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(config): zod-validated env loader with adapter selection (P1-CORE-3)"
```

---

## Task 5: `@openldr/adapter-db-store` — TargetStorePort over Kysely/pg

**Files:**
- Create: `packages/adapter-db-store/package.json`, `packages/adapter-db-store/tsconfig.json`, `packages/adapter-db-store/src/index.ts`
- Test: `packages/adapter-db-store/src/index.test.ts`

- [ ] **Step 1: Create `packages/adapter-db-store/package.json`**

```json
{
  "name": "@openldr/adapter-db-store",
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
    "@openldr/ports": "workspace:*",
    "kysely": "^0.27.5",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `packages/adapter-db-store/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test `packages/adapter-db-store/src/index.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createDbStore } from './index';

function fakePool(impl: () => Promise<unknown>) {
  return { query: vi.fn(impl), end: vi.fn(async () => {}) };
}

describe('createDbStore', () => {
  it('reports up when SELECT 1 succeeds', async () => {
    const pool = fakePool(async () => ({ rows: [{ '?column?': 1 }] }));
    const store = createDbStore({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await store.healthCheck();
    expect(r.status).toBe('up');
    expect(pool.query).toHaveBeenCalledWith('select 1');
  });

  it('reports down when the query throws', async () => {
    const pool = fakePool(async () => { throw new Error('ECONNREFUSED'); });
    const store = createDbStore({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await store.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('ECONNREFUSED');
  });
});
```

- [ ] **Step 4: Run it to verify failure**

Run: `pnpm --filter @openldr/adapter-db-store test`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 5: Create `packages/adapter-db-store/src/index.ts`**

```ts
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { probe } from '@openldr/core';
import type { TargetSchema, TargetStorePort } from '@openldr/ports';

export interface DbStoreConfig {
  url: string;
}

export interface DbStoreDeps {
  pool?: pg.Pool;
}

export interface DbStore extends TargetStorePort {
  close(): Promise<void>;
}

export function createDbStore(cfg: DbStoreConfig, deps: DbStoreDeps = {}): DbStore {
  const pool = deps.pool ?? new pg.Pool({ connectionString: cfg.url });
  const db = new Kysely<TargetSchema>({ dialect: new PostgresDialect({ pool }) });

  return {
    db,
    async transaction(fn) {
      return db.transaction().execute(fn);
    },
    async healthCheck() {
      return probe(async () => {
        await pool.query('select 1');
      });
    },
    async close() {
      await db.destroy();
    },
  };
}
```

- [ ] **Step 6: Run it to verify pass**

Run: `pnpm install && pnpm --filter @openldr/adapter-db-store test`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @openldr/adapter-db-store typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(adapter-db-store): TargetStorePort over Kysely/pg"
```

---

## Task 6: `@openldr/adapter-s3-bucket` — BlobStoragePort over S3

**Files:**
- Create: `packages/adapter-s3-bucket/package.json`, `packages/adapter-s3-bucket/tsconfig.json`, `packages/adapter-s3-bucket/src/index.ts`
- Test: `packages/adapter-s3-bucket/src/index.test.ts`

- [ ] **Step 1: Create `packages/adapter-s3-bucket/package.json`**

```json
{
  "name": "@openldr/adapter-s3-bucket",
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
    "@openldr/ports": "workspace:*",
    "@aws-sdk/client-s3": "^3.717.0",
    "@aws-sdk/s3-request-presigner": "^3.717.0"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/adapter-s3-bucket/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test `packages/adapter-s3-bucket/src/index.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createS3Bucket } from './index';

function fakeClient(send: () => Promise<unknown>) {
  return { send: vi.fn(send) };
}

const cfg = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  accessKeyId: 'minio',
  secretAccessKey: 'minio12345',
  bucket: 'openldr',
  forcePathStyle: true,
};

describe('createS3Bucket', () => {
  it('reports up when the bucket is reachable', async () => {
    const client = fakeClient(async () => ({}));
    const blob = createS3Bucket(cfg, { client: client as never });
    const r = await blob.healthCheck();
    expect(r.status).toBe('up');
    expect(client.send).toHaveBeenCalledOnce();
  });

  it('reports down when HeadBucket fails', async () => {
    const client = fakeClient(async () => { throw new Error('NoSuchBucket'); });
    const blob = createS3Bucket(cfg, { client: client as never });
    const r = await blob.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('NoSuchBucket');
  });
});
```

- [ ] **Step 4: Run it to verify failure**

Run: `pnpm --filter @openldr/adapter-s3-bucket test`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 5: Create `packages/adapter-s3-bucket/src/index.ts`**

```ts
import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { probe } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';

export interface S3BucketConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

export interface S3BucketDeps {
  client?: S3Client;
}

export function createS3Bucket(cfg: S3BucketConfig, deps: S3BucketDeps = {}): BlobStoragePort {
  const client =
    deps.client ??
    new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });

  return {
    async healthCheck() {
      return probe(async () => {
        await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
        return `bucket ${cfg.bucket} reachable`;
      });
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new Error(`empty object: ${key}`);
      return bytes;
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
    async presign(key, expiresInSeconds = 900) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },
  };
}
```

- [ ] **Step 6: Run it to verify pass**

Run: `pnpm install && pnpm --filter @openldr/adapter-s3-bucket test`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @openldr/adapter-s3-bucket typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(adapter-s3-bucket): BlobStoragePort over S3 SDK"
```

---

## Task 7: `@openldr/adapter-event-bus` — EventingPort over pg + pg_notify

**Files:**
- Create: `packages/adapter-event-bus/package.json`, `packages/adapter-event-bus/tsconfig.json`, `packages/adapter-event-bus/src/index.ts`
- Test: `packages/adapter-event-bus/src/index.test.ts`

- [ ] **Step 1: Create `packages/adapter-event-bus/package.json`**

```json
{
  "name": "@openldr/adapter-event-bus",
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
    "@openldr/ports": "workspace:*",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `packages/adapter-event-bus/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test `packages/adapter-event-bus/src/index.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from './index';

function fakePool(impl: () => Promise<unknown>) {
  return { query: vi.fn(impl), end: vi.fn(async () => {}) };
}

describe('createEventBus', () => {
  it('reports up when pg_notify succeeds', async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const bus = createEventBus({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await bus.healthCheck();
    expect(r.status).toBe('up');
    expect(pool.query).toHaveBeenCalledWith("select pg_notify('openldr_health', 'ping')");
  });

  it('reports down when the connection fails', async () => {
    const pool = fakePool(async () => { throw new Error('ECONNREFUSED'); });
    const bus = createEventBus({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await bus.healthCheck();
    expect(r.status).toBe('down');
  });
});
```

- [ ] **Step 4: Run it to verify failure**

Run: `pnpm --filter @openldr/adapter-event-bus test`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 5: Create `packages/adapter-event-bus/src/index.ts`**

```ts
import pg from 'pg';
import { probe } from '@openldr/core';
import type { EventEnvelope, EventHandler, EventingPort } from '@openldr/ports';

export interface EventBusConfig {
  url: string;
}

export interface EventBusDeps {
  pool?: pg.Pool;
}

export interface EventBus extends EventingPort {
  close(): Promise<void>;
}

export function createEventBus(cfg: EventBusConfig, deps: EventBusDeps = {}): EventBus {
  const pool = deps.pool ?? new pg.Pool({ connectionString: cfg.url });

  return {
    async healthCheck() {
      return probe(async () => {
        await pool.query("select pg_notify('openldr_health', 'ping')");
        return 'pg_notify reachable';
      });
    },
    // Full outbox + worker semantics land in the ingest sub-project (§8 step 4).
    async publish(_event: EventEnvelope) {
      throw new Error('event-bus.publish not implemented in the skeleton');
    },
    async subscribe(_type: string, _handler: EventHandler) {
      throw new Error('event-bus.subscribe not implemented in the skeleton');
    },
    async close() {
      await pool.end();
    },
  };
}
```

- [ ] **Step 6: Run it to verify pass**

Run: `pnpm install && pnpm --filter @openldr/adapter-event-bus test`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @openldr/adapter-event-bus typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(adapter-event-bus): EventingPort liveness over pg_notify"
```

---

## Task 8: `@openldr/adapter-auth` — AuthPort over OIDC discovery

**Files:**
- Create: `packages/adapter-auth/package.json`, `packages/adapter-auth/tsconfig.json`, `packages/adapter-auth/src/index.ts`
- Test: `packages/adapter-auth/src/index.test.ts`

- [ ] **Step 1: Create `packages/adapter-auth/package.json`**

```json
{
  "name": "@openldr/adapter-auth",
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
    "@openldr/ports": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/adapter-auth/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test `packages/adapter-auth/src/index.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createAuth } from './index';

const cfg = { issuerUrl: 'http://localhost:8080/realms/master' };

describe('createAuth', () => {
  it('reports up when the discovery doc returns 200', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const auth = createAuth(cfg, { fetchFn });
    const r = await auth.healthCheck();
    expect(r.status).toBe('up');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:8080/realms/master/.well-known/openid-configuration',
      expect.anything(),
    );
  });

  it('reports down when discovery returns non-200', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    const auth = createAuth(cfg, { fetchFn });
    const r = await auth.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('404');
  });
});
```

- [ ] **Step 4: Run it to verify failure**

Run: `pnpm --filter @openldr/adapter-auth test`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 5: Create `packages/adapter-auth/src/index.ts`**

```ts
import { probe } from '@openldr/core';
import type { AuthPort, TokenClaims } from '@openldr/ports';

export interface AuthConfig {
  issuerUrl: string;
}

export interface AuthDeps {
  fetchFn?: typeof fetch;
}

export function createAuth(cfg: AuthConfig, deps: AuthDeps = {}): AuthPort {
  const fetchFn = deps.fetchFn ?? fetch;
  const discoveryUrl = `${cfg.issuerUrl}/.well-known/openid-configuration`;

  return {
    async healthCheck() {
      return probe(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetchFn(discoveryUrl, { signal: controller.signal });
          if (!res.ok) throw new Error(`OIDC discovery returned ${res.status}`);
          return 'OIDC issuer reachable';
        } finally {
          clearTimeout(timer);
        }
      });
    },
    // Real verification lands with the users/auth sub-project (§5.8).
    async verifyToken(_token: string): Promise<TokenClaims> {
      throw new Error('auth.verifyToken not implemented in the skeleton');
    },
  };
}
```

- [ ] **Step 6: Run it to verify pass**

Run: `pnpm install && pnpm --filter @openldr/adapter-auth test`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @openldr/adapter-auth typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(adapter-auth): AuthPort liveness over OIDC discovery"
```

---

## Task 9: Domain placeholder packages (boundary topology)

Creates the seven domain module packages required by P1-CORE-1. Each is an identical stub differing only by name. **Repeat steps 1–2 for each name in this list:** `fhir`, `forms`, `ingest`, `plugins`, `reporting`, `audit`, `users`.

**Files (per module `<name>`):**
- Create: `packages/<name>/package.json`, `packages/<name>/tsconfig.json`, `packages/<name>/src/index.ts`

- [ ] **Step 1: Create `packages/<name>/package.json`** (substitute `<name>`)

```json
{
  "name": "@openldr/<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "lint": "echo \"no lint\""
  },
  "dependencies": { "@openldr/ports": "workspace:*" },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/<name>/tsconfig.json` and `packages/<name>/src/index.ts`** (substitute `<name>`)

`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`src/index.ts`:
```ts
/**
 * @openldr/<name> — placeholder module package.
 * Locks the modular-monolith boundary topology (P1-CORE-1).
 * Real implementation arrives in its own Phase-1 sub-project.
 */
export const MODULE_NAME = '<name>' as const;
```

- [ ] **Step 3: After creating all seven, install and typecheck the workspace**

Run: `pnpm install && pnpm -r typecheck`
Expected: every package typechecks clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat: scaffold domain module placeholder packages (P1-CORE-1)"
```

---

## Task 10: `@openldr/bootstrap` — composition root

**Files:**
- Create: `packages/bootstrap/package.json`, `packages/bootstrap/tsconfig.json`, `packages/bootstrap/src/index.ts`
- Test: `packages/bootstrap/src/index.test.ts`

- [ ] **Step 1: Create `packages/bootstrap/package.json`**

```json
{
  "name": "@openldr/bootstrap",
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
    "@openldr/adapter-auth": "workspace:*",
    "@openldr/adapter-db-store": "workspace:*",
    "@openldr/adapter-event-bus": "workspace:*",
    "@openldr/adapter-s3-bucket": "workspace:*",
    "@openldr/config": "workspace:*",
    "@openldr/core": "workspace:*",
    "@openldr/ports": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/bootstrap/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test `packages/bootstrap/src/index.test.ts`**

This test verifies wiring only — that the four named adapter health checks are registered and aggregate. It points the real adapters at unreachable hosts and asserts every adapter reports `down` (proving each is wired and individually probed) without any process crash.

```ts
import { describe, it, expect, afterEach } from 'vitest';
import type { Config } from '@openldr/config';
import { createAppContext, type AppContext } from './index';

const cfg: Config = Object.freeze({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  AUTH_ADAPTER: 'keycloak',
  BLOB_ADAPTER: 'minio',
  EVENTING_ADAPTER: 'pg',
  TARGET_STORE_ADAPTER: 'pg',
  INTERNAL_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  TARGET_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  S3_ENDPOINT: 'http://127.0.0.1:9499',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'x',
  S3_SECRET_ACCESS_KEY: 'xxxxxxxx',
  S3_BUCKET: 'none',
  S3_FORCE_PATH_STYLE: true,
  OIDC_ISSUER_URL: 'http://127.0.0.1:8499/realms/master',
}) as Config;

let ctx: AppContext;
afterEach(async () => { await ctx?.close(); });

describe('createAppContext', () => {
  it('wires and registers all four port health checks', async () => {
    ctx = await createAppContext(cfg);
    const out = await ctx.health.runAll();
    expect(Object.keys(out.checks).sort()).toEqual(['auth', 'blob', 'eventing', 'target-store']);
    // Nothing reachable in this test → overall down, but no crash.
    expect(out.status).toBe('down');
  }, 20000);
});
```

- [ ] **Step 4: Run it to verify failure**

Run: `pnpm --filter @openldr/bootstrap test`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 5: Create `packages/bootstrap/src/index.ts`**

```ts
import { createAuth } from '@openldr/adapter-auth';
import { createDbStore } from '@openldr/adapter-db-store';
import { createEventBus } from '@openldr/adapter-event-bus';
import { createS3Bucket } from '@openldr/adapter-s3-bucket';
import type { Config } from '@openldr/config';
import { createLogger, HealthRegistry, type Logger } from '@openldr/core';
import type { AuthPort, BlobStoragePort, EventingPort, TargetStorePort } from '@openldr/ports';

export interface AppContext {
  logger: Logger;
  auth: AuthPort;
  blob: BlobStoragePort;
  eventing: EventingPort;
  store: TargetStorePort;
  health: HealthRegistry;
  close(): Promise<void>;
}

export async function createAppContext(cfg: Config): Promise<AppContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });

  const auth = createAuth({ issuerUrl: cfg.OIDC_ISSUER_URL });
  const blob = createS3Bucket({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    accessKeyId: cfg.S3_ACCESS_KEY_ID,
    secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    bucket: cfg.S3_BUCKET,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  });
  const eventing = createEventBus({ url: cfg.INTERNAL_DATABASE_URL });
  const store = createDbStore({ url: cfg.TARGET_DATABASE_URL });

  const health = new HealthRegistry();
  health.register({ name: 'auth', check: () => auth.healthCheck() });
  health.register({ name: 'blob', check: () => blob.healthCheck() });
  health.register({ name: 'eventing', check: () => eventing.healthCheck() });
  health.register({ name: 'target-store', check: () => store.healthCheck() });

  return {
    logger,
    auth,
    blob,
    eventing,
    store,
    health,
    async close() {
      await Promise.allSettled([eventing.close(), store.close()]);
    },
  };
}
```

- [ ] **Step 6: Run it to verify pass**

Run: `pnpm install && pnpm --filter @openldr/bootstrap test`
Expected: PASS (1 test; takes a few seconds due to connection timeouts).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(bootstrap): composition root wiring four adapters + health (DP-1)"
```

---

## Task 11: `@openldr/cli` — `openldr health [--json]`

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/tsup.config.ts`, `packages/cli/src/format.ts`, `packages/cli/src/index.ts`
- Test: `packages/cli/src/format.test.ts`

- [ ] **Step 1: Create `packages/cli/package.json`**

```json
{
  "name": "@openldr/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "openldr": "./dist/index.js" },
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/bootstrap": "workspace:*",
    "@openldr/config": "workspace:*",
    "@openldr/core": "workspace:*",
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "tsup": "^8.3.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `packages/cli/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `packages/cli/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  // Bundle workspace packages; keep node_modules external.
  noExternal: [/^@openldr\//],
  banner: { js: '#!/usr/bin/env node' },
});
```

- [ ] **Step 4: Write the failing test `packages/cli/src/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { AggregatedHealth } from '@openldr/core';
import { formatHealthTable, exitCodeFor } from './format';

const sample: AggregatedHealth = {
  status: 'down',
  checks: {
    auth: { status: 'up', latencyMs: 12 },
    blob: { status: 'down', latencyMs: 5, detail: 'NoSuchBucket' },
  },
};

describe('formatHealthTable', () => {
  it('renders one row per check with status and latency', () => {
    const text = formatHealthTable(sample);
    expect(text).toContain('auth');
    expect(text).toContain('up');
    expect(text).toContain('blob');
    expect(text).toContain('down');
    expect(text).toContain('NoSuchBucket');
  });
});

describe('exitCodeFor', () => {
  it('is 0 when overall up', () => {
    expect(exitCodeFor({ status: 'up', checks: {} })).toBe(0);
  });
  it('is 1 when overall down', () => {
    expect(exitCodeFor(sample)).toBe(1);
  });
});
```

- [ ] **Step 5: Run it to verify failure**

Run: `pnpm --filter @openldr/cli test`
Expected: FAIL — cannot find module `./format`.

- [ ] **Step 6: Create `packages/cli/src/format.ts`**

```ts
import type { AggregatedHealth } from '@openldr/core';

export function exitCodeFor(health: AggregatedHealth): number {
  return health.status === 'down' ? 1 : 0;
}

export function formatHealthTable(health: AggregatedHealth): string {
  const rows = Object.entries(health.checks).map(([name, r]) => {
    const detail = r.detail ? `  ${r.detail}` : '';
    return `  ${name.padEnd(14)} ${r.status.padEnd(9)} ${String(r.latencyMs).padStart(5)}ms${detail}`;
  });
  return [`overall: ${health.status}`, ...rows].join('\n');
}
```

- [ ] **Step 7: Run it to verify pass**

Run: `pnpm --filter @openldr/cli test`
Expected: PASS (3 tests).

- [ ] **Step 8: Create `packages/cli/src/index.ts`**

```ts
import { Command } from 'commander';
import { loadConfig } from '@openldr/config';
import { createAppContext } from '@openldr/bootstrap';
import { errorMessage } from '@openldr/core';
import { exitCodeFor, formatHealthTable } from './format';

const program = new Command();
program.name('openldr').description('OpenLDR CE operator CLI');

program
  .command('health')
  .description('Probe every adapter (auth, blob, eventing, target-store)')
  .option('--json', 'emit machine-readable JSON', false)
  .action(async (opts: { json: boolean }) => {
    let ctx;
    try {
      const cfg = loadConfig();
      ctx = await createAppContext(cfg);
      const result = await ctx.health.runAll();
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatHealthTable(result) + '\n');
      }
      process.exitCode = exitCodeFor(result);
    } catch (err) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ status: 'down', error: errorMessage(err) }) + '\n');
      } else {
        process.stderr.write(`health failed: ${errorMessage(err)}\n`);
      }
      process.exitCode = 1;
    } finally {
      await ctx?.close();
    }
  });

program.parseAsync(process.argv);
```

- [ ] **Step 9: Build the CLI and typecheck**

Run: `pnpm install && pnpm --filter @openldr/cli build && pnpm --filter @openldr/cli typecheck`
Expected: `dist/index.js` produced; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(cli): openldr health with --json (P1-CLI-1, P1-CLI-2, DP-4)"
```

---

## Task 12: `apps/server` — Fastify `GET /health`

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/tsup.config.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`
- Test: `apps/server/src/app.test.ts`

- [ ] **Step 1: Create `apps/server/package.json`**

```json
{
  "name": "@openldr/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsup",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/bootstrap": "workspace:*",
    "@openldr/config": "workspace:*",
    "@openldr/core": "workspace:*",
    "fastify": "^5.2.0"
  },
  "devDependencies": {
    "tsup": "^8.3.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `apps/server/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `apps/server/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  noExternal: [/^@openldr\//],
});
```

- [ ] **Step 4: Write the failing test `apps/server/src/app.test.ts`**

The test injects a fake `AppContext` so it needs no live infra — it asserts the route shape and status-code mapping.

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from './app';
import type { AppContext } from '@openldr/bootstrap';
import { HealthRegistry, createLogger } from '@openldr/core';

function ctxWith(status: 'up' | 'down'): AppContext {
  const health = new HealthRegistry();
  health.register({ name: 'auth', check: async () => ({ status, latencyMs: 1 }) });
  return {
    logger: createLogger({ level: 'silent' }),
    auth: {} as never,
    blob: {} as never,
    eventing: {} as never,
    store: {} as never,
    health,
    async close() {},
  };
}

describe('GET /health', () => {
  it('returns 200 and overall up when all checks pass', async () => {
    const app = buildApp(ctxWith('up'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('up');
    await app.close();
  });

  it('returns 503 when any check is down', async () => {
    const app = buildApp(ctxWith('down'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('down');
    await app.close();
  });
});
```

- [ ] **Step 5: Run it to verify failure**

Run: `pnpm --filter @openldr/server test`
Expected: FAIL — cannot find module `./app`.

- [ ] **Step 6: Create `apps/server/src/app.ts`**

```ts
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';

// Return type is inferred: passing our pino logger as `loggerInstance` makes
// Fastify specialize its logger generic to pino's `Logger`, which is narrower
// than the default `FastifyBaseLogger` — so we must not force that annotation.
export function buildApp(ctx: AppContext) {
  const app = Fastify({ loggerInstance: ctx.logger });

  app.get('/health', async (_req, reply) => {
    const result = await ctx.health.runAll();
    reply.code(result.status === 'down' ? 503 : 200);
    return result;
  });

  return app;
}
```

- [ ] **Step 7: Run it to verify pass**

Run: `pnpm install && pnpm --filter @openldr/server test`
Expected: PASS (2 tests).

- [ ] **Step 8: Create `apps/server/src/index.ts`**

```ts
import { loadConfig } from '@openldr/config';
import { createAppContext } from '@openldr/bootstrap';
import { buildApp } from './app';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const ctx = await createAppContext(cfg);
  const app = buildApp(ctx);

  const close = async () => {
    await app.close();
    await ctx.close();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  // Bind to all interfaces; the reverse proxy owns the external port (P1-NFR-7).
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  process.stderr.write(`server failed to start: ${String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 9: Build and typecheck**

Run: `pnpm --filter @openldr/server build && pnpm --filter @openldr/server typecheck`
Expected: `dist/index.js` produced; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(server): Fastify GET /health off shared aggregator (P1-CORE-3, P1-NFR-7)"
```

---

## Task 13: dependency-cruiser boundary enforcement (DP-1)

**Files:**
- Create: `.dependency-cruiser.cjs`
- Modify: none

- [ ] **Step 1: Create `.dependency-cruiser.cjs`**

```js
/** Enforces hexagonal boundaries (DP-1). Only `bootstrap` may import a concrete adapter. */
module.exports = {
  forbidden: [
    {
      name: 'no-adapter-imports-outside-bootstrap',
      comment: 'Only @openldr/bootstrap may import a concrete adapter-* package.',
      severity: 'error',
      from: { pathNot: '(^|/)packages/(bootstrap|adapter-[^/]+)/' },
      to: { path: '(^|/)packages/adapter-[^/]+/' },
    },
    {
      name: 'no-inter-adapter-imports',
      comment: 'An adapter may not import another adapter; only bootstrap composes them.',
      severity: 'error',
      from: { path: 'packages/(adapter-[^/]+)/' },
      to: { path: 'packages/(adapter-[^/]+)/', pathNot: 'packages/$1/' },
    },
    {
      name: 'ports-stays-pure',
      comment: 'ports must not depend on any other workspace package.',
      severity: 'error',
      from: { path: '(^|/)packages/ports/' },
      to: { path: '(^|/)packages/(?!ports/)[^/]+/' },
    },
    {
      name: 'domain-modules-no-apps',
      comment: 'Domain modules must not reach into apps.',
      severity: 'error',
      from: { path: '(^|/)packages/(fhir|forms|ingest|plugins|reporting|audit|users)/' },
      to: { path: '(^|/)apps/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
    },
  },
};
```

- [ ] **Step 2: Run dependency-cruiser — expect a clean pass**

Run: `pnpm depcruise`
Expected: `no dependency violations found` (analyzes `packages` and `apps`).

- [ ] **Step 3: Prove the rule has teeth (temporary violation)**

Temporarily add this line to the top of `packages/core/src/index.ts`:
```ts
import '@openldr/adapter-db-store';
```
Run: `pnpm depcruise`
Expected: FAIL — `no-adapter-imports-outside-bootstrap` error on `packages/core`.
Then **remove** that line and re-run `pnpm depcruise` → clean again.

- [ ] **Step 4: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "chore: enforce hexagonal boundaries via dependency-cruiser (DP-1)"
```

---

## Task 14: docker-compose stack + `.env.example` + acceptance

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `scripts/init-target-db.sql`

- [ ] **Step 1: Create `.env.example`**

```dotenv
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

AUTH_ADAPTER=keycloak
BLOB_ADAPTER=minio
EVENTING_ADAPTER=pg
TARGET_STORE_ADAPTER=pg

INTERNAL_DATABASE_URL=postgres://openldr:openldr@localhost:5432/openldr
TARGET_DATABASE_URL=postgres://openldr:openldr@localhost:5432/openldr_target

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=openldr
S3_FORCE_PATH_STYLE=true

OIDC_ISSUER_URL=http://localhost:8080/realms/master
```

- [ ] **Step 2: Create `scripts/init-target-db.sql`** (creates the second database the target store points at)

```sql
CREATE DATABASE openldr_target OWNER openldr;
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: openldr
      POSTGRES_PASSWORD: openldr
      POSTGRES_DB: openldr
    ports:
      - '5432:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U openldr']
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      - ./scripts/init-target-db.sql:/docker-entrypoint-initdb.d/10-init-target-db.sql:ro

  minio:
    image: minio/minio:latest
    command: server /data --console-address ':9001'
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - '9000:9000'
      - '9001:9001'
    healthcheck:
      test: ['CMD', 'mc', 'ready', 'local']
      interval: 5s
      timeout: 3s
      retries: 10

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb --ignore-existing local/openldr &&
      echo 'bucket ready'"

  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
      KC_HEALTH_ENABLED: 'true'
    ports:
      - '8080:8080'
    healthcheck:
      test:
        - CMD-SHELL
        - "exec 3<>/dev/tcp/localhost/8080 && echo -e 'GET /realms/master/.well-known/openid-configuration HTTP/1.0\\r\\n\\r\\n' >&3 && cat <&3 | grep -q '200 OK'"
      interval: 10s
      timeout: 5s
      retries: 20
```

- [ ] **Step 4: Bring the stack up**

Run: `docker compose up -d`
Then wait for health: `docker compose ps`
Expected: `postgres`, `minio`, `keycloak` show `healthy`; `minio-init` exits 0 after creating the bucket.

- [ ] **Step 5: Create local `.env`**

Run (PowerShell): `Copy-Item .env.example .env`
(bash: `cp .env.example .env`)

- [ ] **Step 6: Acceptance — all adapters up**

Run: `pnpm openldr health --json`
Expected JSON: `status: "up"` and each of `auth`, `blob`, `eventing`, `target-store` with `status: "up"`. Exit code 0 (`echo $LASTEXITCODE` in PowerShell shows `0`).

- [ ] **Step 7: Acceptance — graceful degradation (DP-7)**

Run: `docker compose stop minio`
Then: `pnpm openldr health --json`
Expected: `blob` → `status: "down"`; `auth`, `eventing`, `target-store` stay `up`; overall `status: "down"`; exit code 1; no stack trace / crash.
Restore: `docker compose start minio`.

- [ ] **Step 8: Acceptance — server route mirrors CLI**

In one terminal: `pnpm --filter @openldr/server dev`
In another: `curl -i http://localhost:3000/health`
Expected: `HTTP/1.1 200 OK` with all four checks `up` (or `503` while MinIO is stopped). Stop the dev server with Ctrl+C.

- [ ] **Step 9: Full workspace gate**

Run: `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build`
Expected: typecheck clean, all unit tests pass, no boundary violations, apps build.

- [ ] **Step 10: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat: docker-compose stack + health acceptance (P1-CORE-3, DP-7)"
```

---

## Done criteria (maps to spec §9 acceptance checklist)

- [ ] Turborepo + pnpm workspace bootstraps; pnpm pinned; lockfile committed.
- [ ] All Phase-1 module packages exist with locked boundaries (P1-CORE-1).
- [ ] Four ports defined in `@openldr/ports` (P1-CORE-2).
- [ ] Four protocol-named adapters implemented; only `bootstrap` imports them — enforced by dependency-cruiser (P1-CORE-2, DP-1).
- [ ] Config selects adapters per deployment and fails fast on bad config (P1-CORE-3).
- [ ] Health-check per adapter; `GET /health` and `openldr health --json` share one aggregator (P1-CORE-3, P1-CLI-1/2).
- [ ] docker-compose stack runs; health reports true liveness.
- [ ] Graceful degradation proven: stopping MinIO degrades only `blob` (DP-7).
- [ ] No secrets in logs or health detail (P1-NFR-2); structured pino logging (P1-OBS-1).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` all green.
