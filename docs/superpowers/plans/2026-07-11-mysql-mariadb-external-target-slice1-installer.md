# MySQL/MariaDB External Target — S1 (Installer + Config Wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator select MySQL/MariaDB as the external analytics target at install time — `TARGET_STORE_ADAPTER=mysql` + `MYSQL_*` config wired end-to-end (adapter selection, dialect-aware migrate, seed a `mysql` default connector + demo data), plus installer `--target-db mysql` with a managed-demo (MySQL 8.4) and BYO path.

**Architecture:** Mirror the completed MSSQL installer slice 1:1. S0 already delivered the adapter, migrations, and FlatWriter; S1 flips the composition root (`selectTargetStore`), config schema, seed, and installer to be able to CHOOSE mysql. Built-in **reports are intentionally NOT seeded on a mysql target** — `seedDataDrivenReports` resolves the connector by `WAREHOUSE_NAMES` (Postgres/SQL-Server only) and the MySQL report-SQL variant lands in S2, so a mysql connector under a new name is simply not picked up. No `report-seeds.ts` change here.

**Tech Stack:** TypeScript, zod (`@openldr/config`), kysely, vitest, POSIX sh (`install/install.sh`), PowerShell (`install/install.ps1`), Docker Compose, MySQL 8.4.

**Scope note:** Read surfaces (query workbench, dashboards raw SQL, tri-variant report SQL, `reports:parity`) are **S2**. S1 = config + composition root + seed + installer + a live boot/migrate/seed e2e on a mysql target.

---

## File Structure

- Modify: `packages/config/src/schema.ts` — `TARGET_STORE_ADAPTER` += `'mysql'`; add `MYSQL_*` env + superRefine branch.
- Modify: `packages/config/src/schema.test.ts` — cover mysql config validation.
- Modify: `packages/bootstrap/src/target-store.ts` — add the `mysql` composition-root branch.
- Modify: `packages/bootstrap/src/target-store.test.ts` (or wherever it's tested) — cover mysql selection.
- Modify: `packages/bootstrap/src/index.ts` — 3-way engine derivation (the `=== 'mssql' ? 'mssql' : 'postgres'` site).
- Modify: `packages/bootstrap/src/seed.ts` — `MYSQL_CONNECTOR_NAME`, `cfg` type += `MYSQL_*`, a `mysql` branch in `seedDefaultConnector`.
- Modify: `packages/bootstrap/src/seed.test.ts` — cover the mysql default-connector seed.
- Modify: `install/install.sh` — `--target-db mysql`, `--mysql-demo`, `--mysql-*` flags; env block; overlay fetch.
- Modify: `install/install.ps1` — PowerShell parity.
- Create: `deploy/install/docker-compose.mysql.yml` — managed-demo MySQL 8.4 + init service.
- Create: `scripts/init-target-db-mysql.sql` — creates `openldr_target`.
- Modify: `.env.prod.example` — documented `MYSQL_*` block.
- Modify: `apps/web/src/docs/0.1.0/install.md` — add mysql to the target-db section + flags.

---

## Task 1: Config schema — `mysql` adapter + `MYSQL_*`

**Files:**
- Modify: `packages/config/src/schema.ts`
- Test: `packages/config/src/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Read `packages/config/src/schema.test.ts` to match its `loadConfig`/parse harness and env-fixture style, then add tests analogous to the existing mssql ones:

```typescript
it('accepts TARGET_STORE_ADAPTER=mysql with the MYSQL_* vars', () => {
  const cfg = loadConfig({ ...baseEnv, TARGET_STORE_ADAPTER: 'mysql', MYSQL_HOST: 'db', MYSQL_DATABASE: 'openldr_target', MYSQL_USER: 'u', MYSQL_PASSWORD: 'p' });
  expect(cfg.TARGET_STORE_ADAPTER).toBe('mysql');
  expect(cfg.MYSQL_PORT).toBe(3306); // default
});
it('rejects TARGET_STORE_ADAPTER=mysql without required MYSQL_* vars', () => {
  expect(() => loadConfig({ ...baseEnv, TARGET_STORE_ADAPTER: 'mysql' })).toThrow(/MYSQL_HOST is required when TARGET_STORE_ADAPTER=mysql/);
});
```

`baseEnv`/`loadConfig` must match the file's existing helpers (copy from the mssql tests in the same file). If the pg case requires `TARGET_DATABASE_URL`, ensure `baseEnv` for the mysql case omits/doesn't conflict — follow the mssql test's exact fixture shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/config exec vitest run src/schema.test.ts`
Expected: FAIL — `TARGET_STORE_ADAPTER` enum rejects `'mysql'` (invalid enum value).

- [ ] **Step 3: Implement schema changes**

In `packages/config/src/schema.ts`:

(a) Widen the enum:
```typescript
    TARGET_STORE_ADAPTER: z.enum(['pg', 'mssql', 'mysql']).default('pg'),
```

(b) Add the `MYSQL_*` block right after the `MSSQL_*` block (mirror its style; `envBoolean` already imported):
```typescript
    // MySQL/MariaDB target store (required when TARGET_STORE_ADAPTER=mysql).
    MYSQL_HOST: z.string().min(1).optional(),
    MYSQL_PORT: z.coerce.number().int().positive().default(3306),
    MYSQL_DATABASE: z.string().min(1).optional(),
    MYSQL_USER: z.string().min(1).optional(),
    MYSQL_PASSWORD: z.string().min(1).optional(),
    MYSQL_SSL: envBoolean(false),
```

(c) In the `.superRefine(...)`, extend the branch so mysql requires its vars (keep the pg/mssql logic intact):
```typescript
    if (cfg.TARGET_STORE_ADAPTER === 'mssql') {
      for (const key of ['MSSQL_HOST', 'MSSQL_DATABASE', 'MSSQL_USER', 'MSSQL_PASSWORD'] as const) {
        if (!cfg[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when TARGET_STORE_ADAPTER=mssql` });
        }
      }
    } else if (cfg.TARGET_STORE_ADAPTER === 'mysql') {
      for (const key of ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'] as const) {
        if (!cfg[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when TARGET_STORE_ADAPTER=mysql` });
        }
      }
    } else if (!cfg.TARGET_DATABASE_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TARGET_DATABASE_URL'], message: 'TARGET_DATABASE_URL is required when TARGET_STORE_ADAPTER=pg' });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/config exec vitest run src/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/schema.ts packages/config/src/schema.test.ts
git commit -m "feat(config): TARGET_STORE_ADAPTER=mysql + MYSQL_* env + validation"
```

---

## Task 2: Composition root — select the mysql target store

**Files:**
- Modify: `packages/bootstrap/src/target-store.ts`
- Modify: `packages/bootstrap/src/index.ts` (the second engine-derivation site)
- Test: the existing target-store test (find it: `grep -rl selectTargetStore packages/bootstrap/src/*.test.ts`)

- [ ] **Step 1: Write the failing test**

Find the existing `selectTargetStore` test and mirror its mssql case for mysql. It should assert that with `TARGET_STORE_ADAPTER: 'mysql'` + `MYSQL_*` set, `selectTargetStore(cfg)` returns `engine === 'mysql'` and a store with `db`/`transaction`/`healthCheck`/`close` (do NOT connect to a real DB — the mssql test doesn't). Example shape (adapt to the real test harness):

```typescript
it('selects the mysql store when TARGET_STORE_ADAPTER=mysql', () => {
  const sel = selectTargetStore({ ...baseCfg, TARGET_STORE_ADAPTER: 'mysql', MYSQL_HOST: 'h', MYSQL_PORT: 3306, MYSQL_DATABASE: 'd', MYSQL_USER: 'u', MYSQL_PASSWORD: 'p', MYSQL_SSL: false } as any);
  expect(sel.engine).toBe('mysql');
  expect(typeof sel.store.healthCheck).toBe('function');
  return sel.store.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run <that test file>`
Expected: FAIL — `selectTargetStore` maps non-mssql to `'postgres'` and then throws `postgres target store requires TARGET_DATABASE_URL`.

- [ ] **Step 3: Implement the mysql branch**

In `packages/bootstrap/src/target-store.ts`:

(a) Import the adapter at the top:
```typescript
import { createMysqlStore } from '@openldr/adapter-mysql-store';
```

(b) Update the engine mapping and add the mysql branch (before the postgres fallback):
```typescript
  const engine: TargetEngine = engineOverride ?? (
    cfg.TARGET_STORE_ADAPTER === 'mssql' ? 'mssql'
    : cfg.TARGET_STORE_ADAPTER === 'mysql' ? 'mysql'
    : 'postgres'
  );
  if (engine === 'mssql') {
    // ...unchanged mssql branch...
  }
  if (engine === 'mysql') {
    const missing = (['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'] as const).filter((k) => !cfg[k]);
    if (missing.length > 0) {
      throw new ConfigError(`mysql target store requires ${missing.join(', ')} (set TARGET_STORE_ADAPTER=mysql + the MYSQL_* vars)`);
    }
    return {
      engine,
      store: createMysqlStore({
        host: cfg.MYSQL_HOST!,
        port: cfg.MYSQL_PORT,
        database: cfg.MYSQL_DATABASE!,
        user: cfg.MYSQL_USER!,
        password: cfg.MYSQL_PASSWORD!,
        ssl: cfg.MYSQL_SSL,
      }),
    };
  }
```

(c) In `packages/bootstrap/src/index.ts`, the OTHER engine-derivation site (currently `cfg.TARGET_STORE_ADAPTER === 'mssql' ? 'mssql' : 'postgres'`, ~line 435) must become 3-way too:
```typescript
      }, cfg.TARGET_STORE_ADAPTER === 'mssql' ? 'mssql' : cfg.TARGET_STORE_ADAPTER === 'mysql' ? 'mysql' : 'postgres');
```
First `grep -n "=== 'mssql' ? 'mssql' : 'postgres'" packages/bootstrap/src/index.ts` and update EVERY occurrence (there may be more than one). Add `@openldr/adapter-mysql-store` to `packages/bootstrap/package.json` dependencies (`"workspace:*"`) and run `pnpm install` if the import doesn't resolve.

- [ ] **Step 4: Run test to verify it passes + typecheck**

Run: `pnpm --filter @openldr/bootstrap exec vitest run <that test file>` → PASS
Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/target-store.ts packages/bootstrap/src/index.ts packages/bootstrap/package.json pnpm-lock.yaml <test file>
git commit -m "feat(bootstrap): select mysql target store when TARGET_STORE_ADAPTER=mysql"
```

---

## Task 3: Seed a `mysql` default connector

**Files:**
- Modify: `packages/bootstrap/src/seed.ts`
- Test: `packages/bootstrap/src/seed.test.ts`

- [ ] **Step 1: Write the failing test**

Mirror the existing `seed.test.ts` case "seeds a microsoft-sql warehouse connector when TARGET_STORE_ADAPTER=mssql" (around line 201) for mysql:

```typescript
it('seeds a mysql warehouse connector when TARGET_STORE_ADAPTER=mysql', async () => {
  const created: any[] = [];
  const app = makeSeedApp({  // mirror the mssql test's fake app
    cfg: { TARGET_STORE_ADAPTER: 'mysql', SECRETS_ENCRYPTION_KEY: 'k', MYSQL_HOST: 'h', MYSQL_PORT: 3306, MYSQL_DATABASE: 'openldr_target', MYSQL_USER: 'u', MYSQL_PASSWORD: 'p', MYSQL_SSL: false },
    connectors: { list: async () => [], create: async (c: any) => { created.push(c); } },
  });
  const n = await seedDefaultConnector(app);
  expect(n).toBe(1);
  expect(created[0].type).toBe('mysql');
  expect(created[0].name).toBe('Target Warehouse (MySQL/MariaDB)');
  expect(created[0].config.host).toBe('h');
});
```

Copy the exact fake-app construction from the adjacent mssql test (do not invent `makeSeedApp` if the file builds the fake inline).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/seed.test.ts`
Expected: FAIL — mysql is not handled, so `seedDefaultConnector` falls through to the pg branch and skips (no `TARGET_DATABASE_URL`), returning 0.

- [ ] **Step 3: Implement**

In `packages/bootstrap/src/seed.ts`:

(a) Add the connector name constant next to `MSSQL_CONNECTOR_NAME`:
```typescript
// Name for the MySQL/MariaDB target-warehouse connector — distinct from the PG/MSSQL names.
// Deliberately NOT in @openldr/reporting's WAREHOUSE_NAMES yet: built-in data-driven reports need
// the MySQL report-SQL variant (S2), so a mysql install seeds NO data-driven reports until then.
const MYSQL_CONNECTOR_NAME = 'Target Warehouse (MySQL/MariaDB)';
```

(b) Extend the `cfg` type in `FormSeedTarget` to include the mysql fields:
```typescript
    TARGET_STORE_ADAPTER?: 'pg' | 'mssql' | 'mysql';
    MYSQL_HOST?: string;
    MYSQL_PORT?: number;
    MYSQL_DATABASE?: string;
    MYSQL_USER?: string;
    MYSQL_PASSWORD?: string;
    MYSQL_SSL?: boolean;
```

(c) In `seedDefaultConnector`, add a mysql branch after the mssql branch and before the pg fallback:
```typescript
  if (app.cfg.TARGET_STORE_ADAPTER === 'mysql') {
    const missing = (['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'] as const).filter((k) => !app.cfg[k]);
    if (missing.length > 0) {
      console.log(`[seed] ${missing.join(', ')} unset — skipping default MySQL connector`);
      return 0;
    }
    const existing = await app.connectors.list();
    if (existing.some((c) => c.name === MYSQL_CONNECTOR_NAME)) return 0;
    await app.connectors.create(
      {
        id: randomUUID(),
        name: MYSQL_CONNECTOR_NAME,
        type: 'mysql',
        kind: 'database',
        config: {
          host: app.cfg.MYSQL_HOST!,
          port: String(app.cfg.MYSQL_PORT),
          database: app.cfg.MYSQL_DATABASE!,
          user: app.cfg.MYSQL_USER!,
          password: app.cfg.MYSQL_PASSWORD!,
          ssl: String(app.cfg.MYSQL_SSL),
        },
      },
      app.cfg.SECRETS_ENCRYPTION_KEY,
    );
    console.log(`[seed] created default connector "${MYSQL_CONNECTOR_NAME}"`);
    return 1;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/seed.test.ts`
Expected: PASS (mysql test passes; pg/mssql seed tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/seed.ts packages/bootstrap/src/seed.test.ts
git commit -m "feat(bootstrap): seed a mysql default warehouse connector (reports deferred to S2)"
```

---

## Task 4: Managed-demo compose overlay + target-DB init

**Files:**
- Create: `deploy/install/docker-compose.mysql.yml`
- Create: `scripts/init-target-db-mysql.sql`

- [ ] **Step 1: Create `scripts/init-target-db-mysql.sql`**

```sql
CREATE DATABASE IF NOT EXISTS openldr_target CHARACTER SET utf8mb4;
```

- [ ] **Step 2: Create `deploy/install/docker-compose.mysql.yml`**

Mirror `deploy/install/docker-compose.mssql.yml` (READ it first). Adapt: a pinned MySQL 8.4 `mysql` service + a `mysql-init` service that creates `openldr_target`, and the `api` `depends_on` the init. Content:

```yaml
# Managed-demo MySQL overlay. Layered ONLY when the installer is run with --mysql-demo.
# NOT for production — this bundled container is for evaluation only; production points at a
# self-hosted MySQL/MariaDB (BYO).
services:
  mysql:
    image: mysql:8.4
    command: ["--character-set-server=utf8mb4"]
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_PASSWORD}
      MYSQL_DATABASE: openldr_target
    volumes:
      - mysqldata:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h localhost -uroot -p\"$$MYSQL_ROOT_PASSWORD\" --silent || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    restart: unless-stopped

  mysql-init:
    image: mysql:8.4
    depends_on:
      mysql:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "mysql -h mysql -uroot -p\"$$MYSQL_ROOT_PASSWORD\" < /init/init-target-db-mysql.sql"
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_PASSWORD}
    volumes:
      - ./config/init-target-db-mysql.sql:/init/init-target-db-mysql.sql:ro
    restart: "no"

  api:
    depends_on:
      mysql-init:
        condition: service_completed_successfully

volumes:
  mysqldata:
```

Note: `MYSQL_DATABASE: openldr_target` already creates the DB on first boot, so `mysql-init` is belt-and-suspenders/idempotent (matches the mssql overlay's init pattern). Confirm the mssql overlay's env-var name conventions (it uses `MSSQL_PASSWORD`) — reuse `MYSQL_PASSWORD` written by the installer (Task 5).

- [ ] **Step 3: Validate compose syntax**

Run: `docker compose -f deploy/install/docker-compose.yml -f deploy/install/docker-compose.mysql.yml config >/dev/null && echo OK`
Expected: `OK` (compose merges + parses; needs a dummy `.env` with `MYSQL_PASSWORD` set, or run from a scratch dir — just verify no YAML/merge error).

- [ ] **Step 4: Commit**

```bash
git add deploy/install/docker-compose.mysql.yml scripts/init-target-db-mysql.sql
git commit -m "feat(install): MySQL 8.4 managed-demo compose overlay + target-db init"
```

---

## Task 5: Installer `install.sh` — mysql target selection

**Files:**
- Modify: `install/install.sh`

READ the mssql handling first — it's the exact template. `grep -n "mssql\|MSSQL\|target-db" install/install.sh` and mirror each site.

- [ ] **Step 1: Add flag parsing + defaults**

Mirror the `MSSQL_*` variable defaults (near the top) and `--mssql-*` case arms for mysql:
- Defaults: `MYSQL_DEMO=0`, `MYSQL_HOST=""`, `MYSQL_PORT="3306"`, `MYSQL_DATABASE="openldr_target"`, `MYSQL_USER=""`, `MYSQL_PASSWORD=""`, `MYSQL_SSL="false"`.
- Extend the `--target-db` validation to accept `mysql` (currently `postgres|mssql`): change the guard to allow `postgres`, `mssql`, `mysql`.
- Case arms: `--mysql-demo) MYSQL_DEMO=1; TARGET_DB="mysql"; shift ;;`, and `--mysql-host/--mysql-port/--mysql-database/--mysql-user/--mysql-password/--mysql-ssl` mirroring the `--mssql-*` arms.
- Update the usage/comment header to document the mysql flags.

- [ ] **Step 2: Managed-demo + BYO wiring**

Mirror the mssql demo/BYO blocks:
- `if [ "$MYSQL_DEMO" -eq 1 ]`: set `MYSQL_HOST="mysql"`, `MYSQL_PORT="3306"`, `MYSQL_DATABASE="openldr_target"`, `MYSQL_USER="root"`, `MYSQL_SSL="false"`; generate a password if empty (mirror `MSSQL_PASSWORD="$(rand)Aa1!"` → `MYSQL_PASSWORD="$(rand)Aa1"`; keep it free of `#`, spaces, quotes).
- BYO guard (mirror the mssql one): when `TARGET_DB=mysql` and not demo and `.env` doesn't exist, require `--mysql-host/--mysql-user/--mysql-password`.
- Re-run detection: mirror the mssql `EXISTING_ADAPTER=mssql` block for `mysql` (adopt `MYSQL_HOST` from an existing `.env`; host `mysql` re-enables the demo overlay).

- [ ] **Step 3: Fetch overlay + write env block**

- In the scaffold `fetch` section, mirror the mssql-demo fetch: `if [ "$MYSQL_DEMO" -eq 1 ]; then fetch "deploy/install/docker-compose.mysql.yml" "$DIR/docker-compose.mysql.yml"; fetch "scripts/init-target-db-mysql.sql" "$DIR/config/init-target-db-mysql.sql"; fi`.
- In the `.env` `TARGET_DB_ENV_BLOCK` construction, add a mysql arm:
```sh
  elif [ "$TARGET_DB" = "mysql" ]; then
    TARGET_DB_ENV_BLOCK="TARGET_STORE_ADAPTER=mysql
MYSQL_HOST=$MYSQL_HOST
MYSQL_PORT=$MYSQL_PORT
MYSQL_DATABASE=$MYSQL_DATABASE
MYSQL_USER=$MYSQL_USER
MYSQL_PASSWORD=$MYSQL_PASSWORD
MYSQL_SSL=$MYSQL_SSL"
```
- In `COMPOSE_FILES`: `[ "$MYSQL_DEMO" -eq 1 ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.mysql.yml"`.

- [ ] **Step 4: Shellcheck / syntax + a scaffold smoke**

Run: `bash -n install/install.sh && echo "syntax OK"`
Then a no-start scaffold smoke (BYO, no Docker needed):
```
bash install/install.sh --dir /tmp/olmy --target-db mysql --mysql-host h --mysql-user u --mysql-password p --no-pull --no-start 2>&1 | tail -5
grep -E "TARGET_STORE_ADAPTER=mysql|MYSQL_HOST=h" /tmp/olmy/.env && rm -rf /tmp/olmy
```
Expected: scaffolds, `.env` contains `TARGET_STORE_ADAPTER=mysql` + `MYSQL_HOST=h`. (On Windows Git Bash, the installer's cert-gen may warn — ignore; `--no-start` exits before compose.)

- [ ] **Step 5: Commit**

```bash
git add install/install.sh
git commit -m "feat(install): install.sh --target-db mysql (managed-demo + BYO)"
```

---

## Task 6: Installer `install.ps1` — PowerShell parity

**Files:**
- Modify: `install/install.ps1`

- [ ] **Step 1: Mirror the mysql params + logic**

READ `install/install.ps1`'s `-Mssql*`/`-TargetDb` handling and mirror for mysql: params `-MysqlDemo` (switch), `-MysqlHost`, `-MysqlPort` (default `'3306'`), `-MysqlDatabase` (default `'openldr_target'`), `-MysqlUser`, `-MysqlPassword`, `-MysqlSsl` (default `'false'`); accept `mysql` for `-TargetDb`; the demo/BYO env-block + overlay-fetch + COMPOSE_FILES logic mirroring the sh script. Keep the header comment in sync.

- [ ] **Step 2: Syntax check**

Run (PowerShell): `powershell -NoProfile -Command "$null = [ScriptBlock]::Create((Get-Content -Raw install/install.ps1))" ; echo ps-parse-ok`
Expected: parses without error (no execution).

- [ ] **Step 3: Commit**

```bash
git add install/install.ps1
git commit -m "feat(install): install.ps1 -TargetDb mysql parity (-MysqlDemo/-Mysql*)"
```

---

## Task 7: Docs — `.env.prod.example` + web install

**Files:**
- Modify: `.env.prod.example`
- Modify: `apps/web/src/docs/0.1.0/install.md`

- [ ] **Step 1: `.env.prod.example`**

After the documented `MSSQL_*` block, add a parallel `MYSQL_*` block:
```
# External analytics target = MySQL/MariaDB (set TARGET_STORE_ADAPTER=mysql).
# Self-hosted only — no cloud/hosted MySQL. Supported: MySQL 8.4 LTS, MariaDB 11.4 LTS.
# MYSQL_HOST=your-mysql-host
# MYSQL_PORT=3306
# MYSQL_DATABASE=openldr_target
# MYSQL_USER=openldr
# MYSQL_PASSWORD=change-me
# MYSQL_SSL=false
```

- [ ] **Step 2: `apps/web/src/docs/0.1.0/install.md`**

The Install doc has a "SQL Server as the analytics database" section + installer-flags table (added earlier this workstream). Add a short MySQL/MariaDB subsection alongside it (demo `--mysql-demo`, BYO `--target-db mysql --mysql-host …`, Windows `-MysqlDemo`/`-TargetDb mysql`, "self-hosted only, MySQL 8.4 + MariaDB 11.4"), and add the `--mysql-*` rows to the installer-flags table mirroring the `--mssql-*` rows. Match the existing markdown style.

- [ ] **Step 3: Commit**

```bash
git add .env.prod.example apps/web/src/docs/0.1.0/install.md
git commit -m "docs(mysql): document --target-db mysql install (env example + web install doc)"
```

---

## Task 8: Live e2e — boot + migrate + seed on a MySQL target

Validate the whole config→adapter→migrate→seed path against a real MySQL container, using the dev API (like the MSSQL dev-server validation). This is not committed code — it's an acceptance gate.

- [ ] **Step 1: Start a MySQL 8.4 container**

```bash
docker run -d --name openldr-s1-mysql -p 13306:3306 -e MYSQL_ROOT_PASSWORD='Openldr_Local_2026' -e MYSQL_DATABASE=openldr_target mysql:8.4 --character-set-server=utf8mb4
# wait for ready:
for i in $(seq 1 40); do docker exec openldr-s1-mysql sh -c "mysql -uroot -p'Openldr_Local_2026' -e 'select 1'" >/dev/null 2>&1 && break; sleep 3; done
```
(Also ensure the dev Postgres + Keycloak + MinIO are up: `docker compose up -d postgres minio minio-init keycloak` from the repo root.)

- [ ] **Step 2: Boot the dev API against the mysql target**

```bash
MIGRATE_ON_START=true SEED_ON_START=true \
NODE_OPTIONS="--dns-result-order=ipv4first" \
TARGET_STORE_ADAPTER=mysql MYSQL_HOST=127.0.0.1 MYSQL_PORT=13306 MYSQL_DATABASE=openldr_target \
MYSQL_USER=root MYSQL_PASSWORD='Openldr_Local_2026' MYSQL_SSL=false \
node apps/server/dev.mjs > /tmp/s1-api.log 2>&1 &
# wait for "startup seed complete", then inspect the log
```

- [ ] **Step 3: Verify**

Confirm in `/tmp/s1-api.log`:
- `startup migration complete` with `"external":["001_flat_tables","002_specimen_origin"]`.
- `created default connector "Target Warehouse (MySQL/MariaDB)"`.
- `startup seed complete` with `connectorsSeeded:1` and NO error (`"level":50`).
And in MySQL: `docker exec openldr-s1-mysql sh -c "mysql -uroot -p'Openldr_Local_2026' -D openldr_target -e 'show tables'"` shows the 7 flat tables. It's EXPECTED that no data-driven reports seed (mysql report SQL is S2) — confirm `dataDrivenReportsSeeded` is zero/empty and the "no default warehouse connector found (looked for …)" skip log appears (the mysql connector name isn't in WAREHOUSE_NAMES).

- [ ] **Step 4: Tear down**

```bash
# stop the dev api (kill the node on :3000 via taskkill by PID on Windows), then:
docker rm -f openldr-s1-mysql
```

---

## Final gate

- [ ] **Step 1: Typecheck + tests for touched packages (run directly, not via turbo)**

```
pnpm --filter @openldr/config exec tsc --noEmit
pnpm --filter @openldr/config exec vitest run
pnpm --filter @openldr/bootstrap exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec vitest run
```
Expected: all PASS.

- [ ] **Step 2: Live e2e (Task 8) is green** — API boots on a MySQL target, migrates + seeds + creates the mysql connector, no errors.

---

## Self-review — spec coverage

- `TARGET_STORE_ADAPTER += 'mysql'` + `MYSQL_*` config/validation: Task 1 ✅
- Composition-root adapter selection + engine derivation: Task 2 ✅
- Seed a `mysql` default connector (dialect-aware seed of demo data — the demo org/loc/patient already flow through the mysql FlatWriter from S0): Task 3 ✅
- Installer `--target-db mysql` (managed-demo MySQL 8.4 + BYO), PowerShell parity: Tasks 4–6 ✅
- Docs (env example + web install): Task 7 ✅
- Live boot/migrate/seed acceptance on MySQL: Task 8 ✅
- **Intentionally deferred to S2 (not S1):** dialect-aware read surfaces (sql-runner/query-routes), tri-variant report SQL, `reports:parity`, and registering the mysql connector name in `WAREHOUSE_NAMES` so built-in reports seed. S1 leaves a mysql install with a working write path + connector but no built-in reports — the honest boundary.
- **S2 follow-up noted:** expose an explicit strict-TLS-verify option rather than the adapter's carried-forward `rejectUnauthorized:false` (from the S0 final review).
