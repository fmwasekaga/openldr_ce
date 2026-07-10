# MSSQL External Target — Slice 1: Installer external-DB selection + adapter-aware default connector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator choose SQL Server as the external/target database at install time (BYO or a managed demo container), so a fresh install migrates + seeds against MSSQL and provisions a matching default warehouse connector — Postgres remaining the untouched default.

**Architecture:** The backend is already fully adapter-aware — `selectTargetStore` (`packages/bootstrap/src/target-store.ts`) picks MSSQL from `TARGET_STORE_ADAPTER=mssql` + `MSSQL_*`, and migrate-on-start runs `externalMigrations('mssql')` automatically; demo FHIR data reaches the target through the normal persist→assembler pipeline regardless of adapter. So Slice 1 touches only three things: (1) the seed's **default warehouse connector** (postgres-only today), (2) the **installer** scripts (`install/install.sh` + `install/install.ps1`), and (3) an optional **managed-demo MSSQL** compose overlay. The Postgres-dialect built-in report queries are intentionally left to skip on MSSQL (they resolve a connector named `Target Warehouse (Postgres)`; the MSSQL connector uses a different name), keeping report *execution* on MSSQL as Slice 2 work.

**Tech Stack:** TypeScript, Kysely, vitest (bootstrap package), POSIX sh + PowerShell installers, Docker Compose, Docker (`mcr.microsoft.com/mssql/server:2022-latest`).

---

## Context the engineer needs

- **Internal DB is always Postgres.** Do not touch internal-DB config. Only the external/target path changes.
- **Config schema is already MSSQL-ready** (`packages/config/src/schema.ts`): `TARGET_STORE_ADAPTER: 'pg'|'mssql'` (default `pg`); when `mssql`, `MSSQL_HOST/MSSQL_DATABASE/MSSQL_USER/MSSQL_PASSWORD` are required and `MSSQL_PORT`(1433)/`MSSQL_ENCRYPT`(false)/`MSSQL_TRUST_SERVER_CERT`(true) have defaults. When `pg`, `TARGET_DATABASE_URL` is required. Do NOT set `TARGET_DATABASE_URL` in the MSSQL case.
- **Default connector seed** lives in `packages/bootstrap/src/seed.ts` → `seedDefaultConnector()`. Today it creates one `type:'postgres'`, `kind:'database'` connector named `'Target Warehouse (Postgres)'` from `TARGET_DATABASE_URL` (`DEFAULT_CONNECTOR_NAME`, line 46). It skips gracefully if `SECRETS_ENCRYPTION_KEY` or `TARGET_DATABASE_URL` is unset.
- **Connector config keys for `microsoft-sql`** (from `packages/bootstrap/src/connector-db.ts`): `host`, `port`, `database`, `user`, `password`, `encrypt` (any value other than the string `'false'` ⇒ encrypt on), `trustServerCertificate` (the string `'true'` ⇒ trust on). Connector `config` is `Record<string,string>` (values MUST be strings).
- **Report seeding is Postgres-only by design.** `seedDataDrivenReports` (`@openldr/reporting`, `packages/reporting/src/seed/report-seeds.ts`) resolves the warehouse connector by the literal `'Target Warehouse (Postgres)'` and *skips with a log* if absent. Its `SEED_QUERIES` use Postgres SQL (`age()`, etc.). By naming the MSSQL connector differently, these reports skip cleanly on MSSQL — do NOT change `report-seeds.ts` in this slice.
- **Installer is non-interactive** (`curl … | bash`), so selection is via **CLI flags**, not prompts. Existing `.env` is never overwritten (idempotent re-runs).
- **The installer compose file** is `deploy/install/docker-compose.yml` (services: api, studio, web, gateway, postgres, minio, minio-init, keycloak, certbot). The installer downloads it to `$DIR/docker-compose.yml`. The `postgres` service seeds the target DB via `config/init-target-db.sql`.
- **Do NOT add a Co-Authored-By trailer** (neither Claude nor Codex) to any commit. Windows machine; Bash tool = Git Bash; `pnpm` is the package manager.

## File structure

- **Modify** `packages/bootstrap/src/seed.ts` — make `seedDefaultConnector` adapter-aware (add MSSQL branch + a second connector name). Keep it one focused function.
- **Modify** `packages/bootstrap/src/seed.test.ts` — add MSSQL-path unit tests.
- **Modify** `install/install.sh` — new flags + MSSQL `.env` block + managed-demo overlay wiring.
- **Modify** `install/install.ps1` — mirror the sh changes for Windows.
- **Create** `deploy/install/docker-compose.mssql.yml` — a compose overlay adding the managed-demo `mssql` service + init, layered only when `--mssql-demo`.
- **Create** `scripts/init-target-db-mssql.sql` — creates the `openldr_target` database on the demo MSSQL container.

---

### Task 1: Adapter-aware default warehouse connector (bootstrap, TDD)

**Files:**
- Modify: `packages/bootstrap/src/seed.ts`
- Test: `packages/bootstrap/src/seed.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/bootstrap/src/seed.test.ts` and find the existing default-connector test that drives `seedDatabase` / `seedDefaultConnector` with a fake `connectors` store (search for `Target Warehouse`). Add a new test alongside it. Use the SAME fake-app helper the file already uses (`fakeApp(...)`); pass an MSSQL config. Add:

```ts
it('seeds a microsoft-sql warehouse connector when TARGET_STORE_ADAPTER=mssql', async () => {
  const created: Array<{ name: string; type: string; config: Record<string, string> }> = [];
  const app = fakeApp({
    SECRETS_ENCRYPTION_KEY: 'k'.repeat(32),
    TARGET_STORE_ADAPTER: 'mssql',
    MSSQL_HOST: 'sqlserver.local',
    MSSQL_PORT: 1433,
    MSSQL_DATABASE: 'openldr_target',
    MSSQL_USER: 'sa',
    MSSQL_PASSWORD: 'p@ss',
    MSSQL_ENCRYPT: false,
    MSSQL_TRUST_SERVER_CERT: true,
  });
  // capture connector creations
  app.connectors.create = async (rec: { name: string; type: string; config: Record<string, string> }) => {
    created.push({ name: rec.name, type: rec.type, config: rec.config });
  };
  app.connectors.list = async () => [];

  const n = await seedDefaultConnector(app);

  expect(n).toBe(1);
  expect(created).toHaveLength(1);
  expect(created[0].type).toBe('microsoft-sql');
  expect(created[0].name).toBe('Target Warehouse (SQL Server)');
  expect(created[0].config).toMatchObject({
    host: 'sqlserver.local',
    port: '1433',
    database: 'openldr_target',
    user: 'sa',
    password: 'p@ss',
    encrypt: 'false',
    trustServerCertificate: 'true',
  });
});

it('skips the mssql connector when required MSSQL_* vars are missing', async () => {
  const app = fakeApp({
    SECRETS_ENCRYPTION_KEY: 'k'.repeat(32),
    TARGET_STORE_ADAPTER: 'mssql',
    MSSQL_HOST: 'sqlserver.local',
    // MSSQL_DATABASE / MSSQL_USER / MSSQL_PASSWORD intentionally absent
  });
  app.connectors.list = async () => [];
  const n = await seedDefaultConnector(app);
  expect(n).toBe(0);
});
```

If `seedDefaultConnector` is not currently exported from `seed.ts`, export it (add `export` to `async function seedDefaultConnector`). If `fakeApp` doesn't accept these config keys, extend its `cfg` type in the test helper to include `TARGET_STORE_ADAPTER` and the `MSSQL_*` keys (they already exist on the real `Config`). Match the exact shape the existing tests use.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test -- seed.test`
Expected: FAIL — the new tests fail because `seedDefaultConnector` currently only handles the Postgres path (creates 0 connectors for an mssql cfg / or references `DEFAULT_CONNECTOR_NAME` only).

- [ ] **Step 3: Implement the MSSQL branch**

In `packages/bootstrap/src/seed.ts`, just below the existing `DEFAULT_CONNECTOR_NAME` (line ~46), add:

```ts
/** Name for the MSSQL target-warehouse connector — deliberately DIFFERENT from
 *  DEFAULT_CONNECTOR_NAME so the Postgres-dialect built-in report seeding (which resolves
 *  'Target Warehouse (Postgres)') skips cleanly on an MSSQL install. */
const MSSQL_CONNECTOR_NAME = 'Target Warehouse (SQL Server)';
```

Replace the body of `seedDefaultConnector` with an adapter branch. The new full function:

```ts
export async function seedDefaultConnector(app: FormSeedTarget): Promise<number> {
  if (!app.cfg.SECRETS_ENCRYPTION_KEY) {
    console.log('[seed] SECRETS_ENCRYPTION_KEY unset — skipping default connector');
    return 0;
  }

  if (app.cfg.TARGET_STORE_ADAPTER === 'mssql') {
    const missing = (['MSSQL_HOST', 'MSSQL_DATABASE', 'MSSQL_USER', 'MSSQL_PASSWORD'] as const)
      .filter((k) => !app.cfg[k]);
    if (missing.length > 0) {
      console.log(`[seed] ${missing.join(', ')} unset — skipping default MSSQL connector`);
      return 0;
    }
    const existing = await app.connectors.list();
    if (existing.some((c) => c.name === MSSQL_CONNECTOR_NAME)) return 0; // idempotent by name
    await app.connectors.create(
      {
        id: randomUUID(),
        name: MSSQL_CONNECTOR_NAME,
        type: 'microsoft-sql',
        kind: 'database',
        config: {
          host: app.cfg.MSSQL_HOST!,
          port: String(app.cfg.MSSQL_PORT),
          database: app.cfg.MSSQL_DATABASE!,
          user: app.cfg.MSSQL_USER!,
          password: app.cfg.MSSQL_PASSWORD!,
          encrypt: String(app.cfg.MSSQL_ENCRYPT),
          trustServerCertificate: String(app.cfg.MSSQL_TRUST_SERVER_CERT),
        },
      },
      app.cfg.SECRETS_ENCRYPTION_KEY,
    );
    console.log(`[seed] created default connector "${MSSQL_CONNECTOR_NAME}"`);
    return 1;
  }

  if (!app.cfg.TARGET_DATABASE_URL) {
    console.log('[seed] TARGET_DATABASE_URL unset — skipping default connector');
    return 0;
  }
  const existing = await app.connectors.list();
  if (existing.some((c) => c.name === DEFAULT_CONNECTOR_NAME)) return 0; // idempotent by name

  const url = new URL(app.cfg.TARGET_DATABASE_URL);
  await app.connectors.create(
    {
      id: randomUUID(),
      name: DEFAULT_CONNECTOR_NAME,
      type: 'postgres',
      kind: 'database',
      config: {
        host: url.hostname,
        port: url.port || '5432',
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ''),
        ssl: url.searchParams.get('sslmode') === 'require' ? 'true' : 'false',
      },
    },
    app.cfg.SECRETS_ENCRYPTION_KEY,
  );
  console.log(`[seed] created default connector "${DEFAULT_CONNECTOR_NAME}"`);
  return 1;
}
```

Ensure `FormSeedTarget`'s `cfg` type includes `TARGET_STORE_ADAPTER` and the `MSSQL_*` fields. It's a `Pick`/subset of `Config` — if these keys aren't already in the picked type, add them (they exist on the real `Config`). Check the `cfg:` type near the top of `seed.ts` (the `FormSeedTarget` interface) and widen it to include: `TARGET_STORE_ADAPTER?: 'pg' | 'mssql'; MSSQL_HOST?: string; MSSQL_PORT?: number; MSSQL_DATABASE?: string; MSSQL_USER?: string; MSSQL_PASSWORD?: string; MSSQL_ENCRYPT?: boolean; MSSQL_TRUST_SERVER_CERT?: boolean;` (mirror how existing optional cfg keys are typed there).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap test -- seed.test`
Expected: PASS — new MSSQL tests green AND the pre-existing Postgres default-connector test still green (no regression).

- [ ] **Step 5: Typecheck the cross-package boundary**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: exit 0. (If the `cfg` widening surfaces a type error where `seedDatabase` is called with a real `Config`, that's fine — `Config` is a superset; only fix genuine mismatches.)

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/seed.ts packages/bootstrap/src/seed.test.ts
git commit -m "feat(mssql): seed a microsoft-sql default warehouse connector when target is mssql"
```

---

### Task 2: Installer (sh) — target-db selection + MSSQL .env

**Files:**
- Modify: `install/install.sh`

- [ ] **Step 1: Add the new flags to the parser**

In `install/install.sh`, add default vars near the other defaults (after `NO_PULL=0`, line ~21):

```sh
TARGET_DB="postgres"
MSSQL_DEMO=0
MSSQL_HOST=""
MSSQL_PORT="1433"
MSSQL_DATABASE="openldr_target"
MSSQL_USER=""
MSSQL_PASSWORD=""
MSSQL_ENCRYPT="false"
MSSQL_TRUST_CERT="true"
```

In the `while [ $# -gt 0 ]` case block, add these arms before the `*)` catch-all:

```sh
    --target-db) TARGET_DB="$2"; shift 2 ;;
    --mssql-demo) MSSQL_DEMO=1; TARGET_DB="mssql"; shift ;;
    --mssql-host) MSSQL_HOST="$2"; shift 2 ;;
    --mssql-port) MSSQL_PORT="$2"; shift 2 ;;
    --mssql-database) MSSQL_DATABASE="$2"; shift 2 ;;
    --mssql-user) MSSQL_USER="$2"; shift 2 ;;
    --mssql-password) MSSQL_PASSWORD="$2"; shift 2 ;;
    --mssql-encrypt) MSSQL_ENCRYPT="$2"; shift 2 ;;
    --mssql-trust-cert) MSSQL_TRUST_CERT="$2"; shift 2 ;;
```

Also update the header usage comment (lines 4–9) to document `--target-db postgres|mssql`, `--mssql-demo`, and the `--mssql-*` connection flags.

- [ ] **Step 2: Validate the target-db choice + gather demo defaults**

After the flag loop and the existing `.env`-adoption block (after line ~55, before `err()` is first used is fine; place it right after the `ORIGIN` is computed), add validation:

```sh
if [ "$TARGET_DB" != "postgres" ] && [ "$TARGET_DB" != "mssql" ]; then
  echo "✗ --target-db must be 'postgres' or 'mssql' (got '$TARGET_DB')" >&2; exit 2
fi

# Managed-demo MSSQL: point the app at the bundled 'mssql' compose service and generate a
# policy-compliant SA password. (Developer/Express editions are NOT licensed for production —
# this container is for evaluation only.)
if [ "$MSSQL_DEMO" -eq 1 ]; then
  MSSQL_HOST="mssql"
  MSSQL_PORT="1433"
  MSSQL_USER="sa"
  MSSQL_ENCRYPT="false"
  MSSQL_TRUST_CERT="true"
fi

# BYO MSSQL: require connection details up front (before writing .env / starting the stack).
if [ "$TARGET_DB" = "mssql" ] && [ "$MSSQL_DEMO" -eq 0 ]; then
  for pair in "MSSQL_HOST=$MSSQL_HOST" "MSSQL_USER=$MSSQL_USER" "MSSQL_PASSWORD=$MSSQL_PASSWORD"; do
    key="${pair%%=*}"; val="${pair#*=}"
    [ -n "$val" ] || err "--target-db mssql (BYO) requires --mssql-host, --mssql-user, and --mssql-password (missing $key). The target database '$MSSQL_DATABASE' must already exist on your SQL Server."
  done
fi
```

- [ ] **Step 3: Generate the demo SA password alongside the other secrets**

In the secrets block (inside `if [ ! -f "$DIR/.env" ]; then`, after the `PG_PW=... KC_PW=...` line ~124), add a guaranteed-complex SA password for the demo (SQL Server requires ≥3 of upper/lower/digit/symbol):

```sh
  if [ "$MSSQL_DEMO" -eq 1 ] && [ -z "$MSSQL_PASSWORD" ]; then MSSQL_PASSWORD="$(rand)Aa1!"; fi
```

- [ ] **Step 4: Write the adapter-specific target block in `.env`**

In the heredoc that writes `.env` (lines 148–178), replace the single line:

```sh
TARGET_DATABASE_URL=postgres://openldr:$PG_PW@postgres:5432/openldr_target
```

with a placeholder token you then fill conditionally. The simplest robust approach: keep the heredoc but move the target line out. Change that heredoc line to:

```sh
$TARGET_DB_ENV_BLOCK
```

and, immediately BEFORE the `cat > "$DIR/.env" <<EOF` line, compute the block:

```sh
  if [ "$TARGET_DB" = "mssql" ]; then
    TARGET_DB_ENV_BLOCK="TARGET_STORE_ADAPTER=mssql
MSSQL_HOST=$MSSQL_HOST
MSSQL_PORT=$MSSQL_PORT
MSSQL_DATABASE=$MSSQL_DATABASE
MSSQL_USER=$MSSQL_USER
MSSQL_PASSWORD=$MSSQL_PASSWORD
MSSQL_ENCRYPT=$MSSQL_ENCRYPT
MSSQL_TRUST_SERVER_CERT=$MSSQL_TRUST_CERT"
  else
    TARGET_DB_ENV_BLOCK="TARGET_STORE_ADAPTER=pg
TARGET_DATABASE_URL=postgres://openldr:$PG_PW@postgres:5432/openldr_target"
  fi
```

(The heredoc is unquoted `<<EOF`, so `$TARGET_DB_ENV_BLOCK` expands, preserving its embedded newlines.)

- [ ] **Step 5: Layer the managed-demo compose overlay + fetch its files**

In the scaffold section (after `fetch "deploy/install/docker-compose.yml" ...`, line ~103), add a conditional fetch of the overlay + init script:

```sh
if [ "$MSSQL_DEMO" -eq 1 ]; then
  fetch "deploy/install/docker-compose.mssql.yml" "$DIR/docker-compose.mssql.yml"
  fetch "scripts/init-target-db-mssql.sql" "$DIR/config/init-target-db-mssql.sql"
fi
```

Then define a compose-file argument used by every `docker compose` call. After `cd "$DIR"` (line ~213), set:

```sh
COMPOSE_FILES="-f docker-compose.yml"
[ "$MSSQL_DEMO" -eq 1 ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.mssql.yml"
```

and change the two invocations:
- `docker compose pull` → `docker compose $COMPOSE_FILES pull`
- `docker compose up -d` → `docker compose $COMPOSE_FILES up -d`

(Leave the Let's Encrypt `docker compose --profile letsencrypt …` and `docker compose exec gateway …` calls as-is; they don't need the overlay, and the certbot flow is independent of the target DB.)

- [ ] **Step 6: Report the demo SA password on success**

In the closing echo block (after line ~249, the Keycloak password echo), add:

```sh
if [ "$MSSQL_DEMO" -eq 1 ]; then
  echo "  MSSQL (demo) SA password: $(grep '^MSSQL_PASSWORD=' .env | cut -d= -f2-)"
  echo "  ⚠ The demo SQL Server container is for evaluation only — not licensed for production."
fi
```

- [ ] **Step 7: Syntax-check the script**

Run: `sh -n install/install.sh && echo "install.sh OK"`
Expected: `install.sh OK` (exit 0). (Full install e2e is Task 5.)

- [ ] **Step 8: Commit**

```bash
git add install/install.sh
git commit -m "feat(mssql): install.sh --target-db mssql (BYO) + --mssql-demo managed container"
```

---

### Task 3: Installer (ps1) — mirror the sh changes on Windows

**Files:**
- Modify: `install/install.ps1`

- [ ] **Step 1: Read the current ps1 to match its style**

Read `install/install.ps1` fully first. It mirrors `install.sh`: `param(...)` block for flags, an `.env` heredoc/here-string, a `docker compose up` call. Match its existing param naming + string style exactly.

- [ ] **Step 2: Add the parameters**

Add to the `param(...)` block (match existing casing, e.g. `[string]$ServerName`):

```powershell
  [ValidateSet('postgres','mssql')] [string]$TargetDb = 'postgres',
  [switch]$MssqlDemo,
  [string]$MssqlHost = '',
  [string]$MssqlPort = '1433',
  [string]$MssqlDatabase = 'openldr_target',
  [string]$MssqlUser = '',
  [string]$MssqlPassword = '',
  [string]$MssqlEncrypt = 'false',
  [string]$MssqlTrustCert = 'true',
```

- [ ] **Step 3: Demo defaults + BYO validation**

After the param block / arg handling, add (place near where other validation like the LE/host checks live):

```powershell
if ($MssqlDemo) {
  $TargetDb = 'mssql'; $MssqlHost = 'mssql'; $MssqlPort = '1433'; $MssqlUser = 'sa'
  $MssqlEncrypt = 'false'; $MssqlTrustCert = 'true'
}
if ($TargetDb -eq 'mssql' -and -not $MssqlDemo) {
  foreach ($p in @(@{k='-MssqlHost';v=$MssqlHost}, @{k='-MssqlUser';v=$MssqlUser}, @{k='-MssqlPassword';v=$MssqlPassword})) {
    if (-not $p.v) { Write-Error "-TargetDb mssql (BYO) requires -MssqlHost, -MssqlUser and -MssqlPassword (missing $($p.k)). The target database '$MssqlDatabase' must already exist on your SQL Server."; exit 2 }
  }
}
```

- [ ] **Step 4: Demo SA password generation**

Where the ps1 generates the other secrets (find the `Rand`/random-secret helper it already uses), add — guaranteeing SQL Server password complexity:

```powershell
if ($MssqlDemo -and -not $MssqlPassword) { $MssqlPassword = (Rand) + 'Aa1!' }
```

(Use whatever the ps1's existing random-string function is called; if it differs from `Rand`, use that name.)

- [ ] **Step 5: Write the adapter-specific target block in `.env`**

In the ps1's `.env` writing (a here-string or an array of lines), replace the single Postgres `TARGET_DATABASE_URL=...` line with a conditional block. Before assembling the `.env` content, compute:

```powershell
if ($TargetDb -eq 'mssql') {
  $TargetDbEnvBlock = @"
TARGET_STORE_ADAPTER=mssql
MSSQL_HOST=$MssqlHost
MSSQL_PORT=$MssqlPort
MSSQL_DATABASE=$MssqlDatabase
MSSQL_USER=$MssqlUser
MSSQL_PASSWORD=$MssqlPassword
MSSQL_ENCRYPT=$MssqlEncrypt
MSSQL_TRUST_SERVER_CERT=$MssqlTrustCert
"@
} else {
  $TargetDbEnvBlock = @"
TARGET_STORE_ADAPTER=pg
TARGET_DATABASE_URL=postgres://openldr:$PgPw@postgres:5432/openldr_target
"@
}
```

and substitute `$TargetDbEnvBlock` where the old `TARGET_DATABASE_URL` line was in the `.env` here-string (use the ps1's existing password variable name in place of `$PgPw` if it differs).

- [ ] **Step 6: Compose overlay for demo**

Mirror the sh overlay logic. Where the ps1 fetches `docker-compose.yml`, add a conditional fetch of `docker-compose.mssql.yml` + `init-target-db-mssql.sql` when `$MssqlDemo`. Where it runs `docker compose pull` / `docker compose up -d`, build a `$ComposeFiles` argument list:

```powershell
$ComposeFiles = @('-f','docker-compose.yml')
if ($MssqlDemo) { $ComposeFiles += @('-f','docker-compose.mssql.yml') }
# then: docker compose @ComposeFiles pull ; docker compose @ComposeFiles up -d
```

Add a closing note echoing the demo SA password + the non-production warning, mirroring the sh version.

- [ ] **Step 7: Syntax-check the script**

Run: `pwsh -NoProfile -Command "$null = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path install/install.ps1), [ref]$null, [ref]$null); 'install.ps1 OK'"`
(If `pwsh` is unavailable, use `powershell` instead of `pwsh`.)
Expected: `install.ps1 OK` with no parser errors.

- [ ] **Step 8: Commit**

```bash
git add install/install.ps1
git commit -m "feat(mssql): install.ps1 --TargetDb mssql (BYO) + --MssqlDemo managed container"
```

---

### Task 4: Managed-demo MSSQL compose overlay

**Files:**
- Create: `deploy/install/docker-compose.mssql.yml`
- Create: `scripts/init-target-db-mssql.sql`

- [ ] **Step 1: Write the target-DB init SQL**

Create `scripts/init-target-db-mssql.sql`:

```sql
IF DB_ID('openldr_target') IS NULL
BEGIN
  CREATE DATABASE openldr_target;
END
```

- [ ] **Step 2: Write the compose overlay**

Create `deploy/install/docker-compose.mssql.yml`. It adds a demo `mssql` service + a one-shot `mssql-init` that creates the target DB, and makes `api` wait for the DB to exist. The overlay is only layered in (`-f docker-compose.yml -f docker-compose.mssql.yml`) when `--mssql-demo`, so no profiles/cross-profile depends_on issues arise.

```yaml
# Managed-demo SQL Server overlay. Layered ONLY when the installer is run with --mssql-demo.
# NOT for production — SQL Server Developer/Express editions are not licensed for production use.
services:
  mssql:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      ACCEPT_EULA: "Y"
      MSSQL_SA_PASSWORD: ${MSSQL_PASSWORD}
      MSSQL_PID: Developer
    volumes:
      - mssqldata:/var/opt/mssql
    healthcheck:
      # tools18 sqlcmd (2022 image); -C trusts the self-signed server cert.
      test: ["CMD-SHELL", "/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P \"$MSSQL_SA_PASSWORD\" -C -Q 'SELECT 1' || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    restart: unless-stopped

  mssql-init:
    image: mcr.microsoft.com/mssql/server:2022-latest
    depends_on:
      mssql:
        condition: service_healthy
    entrypoint: >
      /bin/bash -c "/opt/mssql-tools18/bin/sqlcmd -S mssql -U sa -P \"$MSSQL_SA_PASSWORD\" -C -i /init/init-target-db-mssql.sql"
    environment:
      MSSQL_SA_PASSWORD: ${MSSQL_PASSWORD}
    volumes:
      - ./config/init-target-db-mssql.sql:/init/init-target-db-mssql.sql:ro
    restart: "no"

  api:
    depends_on:
      mssql-init:
        condition: service_completed_successfully

volumes:
  mssqldata:
```

Note: the base compose already declares `api.depends_on.postgres`. Compose merges `depends_on` maps across `-f` files, so this overlay ADDS the `mssql-init` dependency without dropping the postgres one. Verify this after Step 3.

- [ ] **Step 3: Validate the merged compose config**

From a scratch dir, simulate the installer's layering to confirm the overlay is valid and merges as expected. Run:

```bash
cd "$(mktemp -d)" && \
cp "D:/Projects/Repositories/openldr_ce/deploy/install/docker-compose.yml" . && \
cp "D:/Projects/Repositories/openldr_ce/deploy/install/docker-compose.mssql.yml" . && \
mkdir -p config && cp "D:/Projects/Repositories/openldr_ce/scripts/init-target-db-mssql.sql" config/ && \
MSSQL_PASSWORD='Demo_Pw_1!' OPENLDR_VERSION=latest POSTGRES_PASSWORD=x SERVER_NAME=localhost PUBLIC_ORIGIN=https://localhost GATEWAY_HTTP_PORT=80 GATEWAY_HTTPS_PORT=443 COMPOSE_PROJECT_NAME=t \
  docker compose -f docker-compose.yml -f docker-compose.mssql.yml config >/dev/null && echo "compose merge OK"
```
Expected: `compose merge OK` (no error). Then confirm the merge kept BOTH dependencies:
```bash
MSSQL_PASSWORD='Demo_Pw_1!' OPENLDR_VERSION=latest POSTGRES_PASSWORD=x SERVER_NAME=localhost PUBLIC_ORIGIN=https://localhost GATEWAY_HTTP_PORT=80 GATEWAY_HTTPS_PORT=443 COMPOSE_PROJECT_NAME=t \
  docker compose -f docker-compose.yml -f docker-compose.mssql.yml config | grep -A6 "depends_on" | grep -E "postgres|mssql-init"
```
Expected: both `postgres` and `mssql-init` appear under `api`'s `depends_on`. If the overlay REPLACED rather than merged `depends_on` (only `mssql-init` shows), fix by restating the postgres dependency in the overlay's `api.depends_on` block:
```yaml
  api:
    depends_on:
      postgres:
        condition: service_healthy
      mssql-init:
        condition: service_completed_successfully
```
(and re-run the check).

- [ ] **Step 4: Commit**

```bash
git add deploy/install/docker-compose.mssql.yml scripts/init-target-db-mssql.sql
git commit -m "feat(mssql): managed-demo SQL Server compose overlay + target-db init"
```

---

### Task 5: Live end-to-end install verification (managed demo)

**Files:** none (verification task; may produce a fix commit if it surfaces a bug).

This exercises a real fresh install against the managed-demo MSSQL container, using the LOCAL repo files (not the published raw URLs). Docker is available on this machine.

- [ ] **Step 1: Stage a local install from the working tree**

The installer normally `curl`s files from GitHub. To test local changes, scaffold manually into a temp dir mirroring what `install.sh --mssql-demo --no-start` would produce, using the working-tree files:

```bash
WT=/d/Projects/Repositories/openldr_ce
DEST="$(mktemp -d)/openldr"; mkdir -p "$DEST/config/nginx/certs" "$DEST/config/keycloak"
cp "$WT/deploy/install/docker-compose.yml" "$DEST/docker-compose.yml"
cp "$WT/deploy/install/docker-compose.mssql.yml" "$DEST/docker-compose.mssql.yml"
cp "$WT/scripts/init-target-db-mssql.sql" "$DEST/config/init-target-db-mssql.sql"
cp "$WT/infra/keycloak/openldr-realm.json" "$DEST/config/keycloak/openldr-realm.json"
cp "$WT/scripts/init-target-db.sql" "$DEST/config/init-target-db.sql"
echo "staged $DEST"
```

Then run the real installer with `--no-start` pointed at a sibling dir to generate a correct `.env` (this validates the `.env` writing path itself):

```bash
sh "$WT/install/install.sh" --dir "$DEST" --mssql-demo --http-port 8080 --https-port 8443 --no-start --no-pull
grep -E "^TARGET_STORE_ADAPTER=|^MSSQL_" "$DEST/.env"
```
Expected: `.env` contains `TARGET_STORE_ADAPTER=mssql`, `MSSQL_HOST=mssql`, `MSSQL_PORT=1433`, `MSSQL_DATABASE=openldr_target`, `MSSQL_USER=sa`, a non-empty `MSSQL_PASSWORD` ending `Aa1!`, `MSSQL_ENCRYPT=false`, `MSSQL_TRUST_SERVER_CERT=true`, and NO `TARGET_DATABASE_URL` line.

- [ ] **Step 2: Bring the stack up with the overlay**

```bash
cd "$DEST" && docker compose -f docker-compose.yml -f docker-compose.mssql.yml pull && \
docker compose -f docker-compose.yml -f docker-compose.mssql.yml up -d
```
Wait for health, then confirm the mssql-init completed and api is running:
```bash
docker compose -f docker-compose.yml -f docker-compose.mssql.yml ps
```
Expected: `mssql` healthy, `mssql-init` exited 0, `api` up.

- [ ] **Step 3: Verify migrations + demo data landed in MSSQL**

```bash
PW="$(grep '^MSSQL_PASSWORD=' "$DEST/.env" | cut -d= -f2-)"
CID=$(docker compose -f "$DEST/docker-compose.yml" -f "$DEST/docker-compose.mssql.yml" ps -q mssql)
MSYS_NO_PATHCONV=1 docker exec "$CID" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$PW" -C -d openldr_target -Q \
  "SELECT name FROM sys.tables ORDER BY name; SELECT COUNT(*) AS patients FROM patients;"
```
Expected: the flat tables (`patients`, `service_requests`, `observations`, `specimens`, …) exist, and `patients` has a non-zero count (demo data flowed through the persist→assembler pipeline into MSSQL). If the count is 0, allow a few seconds for the assembler and re-query.

- [ ] **Step 4: Verify the default connector was seeded as microsoft-sql**

Query the internal Postgres connectors table (the connector store is in the internal DB):
```bash
PGCID=$(docker compose -f "$DEST/docker-compose.yml" -f "$DEST/docker-compose.mssql.yml" ps -q postgres)
docker exec "$PGCID" psql -U openldr -d openldr -c "select name, type from connectors order by name;"
```
Expected: a row `Target Warehouse (SQL Server) | microsoft-sql`. Confirm there is NO `Target Warehouse (Postgres)` row (Postgres connector not seeded on an mssql install), and that the api logs show the Postgres-dialect data-driven report seed skipped:
```bash
docker compose -f "$DEST/docker-compose.yml" -f "$DEST/docker-compose.mssql.yml" logs api | grep -iE "default connector|data-driven report seed|Target Warehouse"
```
Expected: a log line creating `"Target Warehouse (SQL Server)"` and a line noting the data-driven report seed skipped (connector `"Target Warehouse (Postgres)"` not found).

- [ ] **Step 5: Tear down**

```bash
cd "$DEST" && docker compose -f docker-compose.yml -f docker-compose.mssql.yml down -v
```

- [ ] **Step 6: If any step revealed a bug, fix it and re-verify**

Fix in the relevant file (seed / installer / overlay), commit with a clear message (no trailer), and re-run the affected steps. Only mark Task 5 complete when Steps 1–4 all pass. This is a verification task — no commit unless a fix was needed.

---

## Self-review notes

- **Spec coverage (Slice 1):** installer selects external DB type + writes correct target config → Tasks 2/3; default connector seeded to match (as `microsoft-sql`) → Task 1; managed-demo container → Task 4; BYO documented + validated → Tasks 2/3 (validation) + Task 5 (e2e); demo data targets the external DB → verified in Task 5 Step 3 (works via the existing adapter-aware pipeline, no code change). Built-in report *execution* over MSSQL is explicitly Slice 2 (the Postgres-dialect report seed skips cleanly by connector-name divergence).
- **No placeholders:** connector config keys, env var names, and connector names are verified against `connector-db.ts`, `schema.ts`, and `seed.ts`/`report-seeds.ts`. The MSSQL connector name (`Target Warehouse (SQL Server)`) is used consistently in Task 1 impl/test and Task 5 verification.
- **Type consistency:** `seedDefaultConnector` stays a single exported function; `MSSQL_CONNECTOR_NAME` is distinct from `DEFAULT_CONNECTOR_NAME`; all connector `config` values are strings (`String(...)` on the boolean/number cfg fields).
- **Risk note:** Task 4 (compose `depends_on` merge across `-f` files) has a verified fallback in Step 3 if merge semantics drop the postgres dependency. Task 4 is the riskiest; Tasks 1–3 are independently valuable even if the managed-demo overlay needs iteration.

## Deferred to Slice 2 (not this plan)

Dialect-aware `sql-runner.ts` + `query-routes.ts` (`SQL_TYPES`, pagination, identifier quoting, introspection), Custom Queries / Report Designer / dashboard raw-SQL over MSSQL, and making the built-in data-driven reports run on MSSQL (dialect-aware query model) — the work that makes the seeded `Target Warehouse (SQL Server)` connector fully usable in the workbench and reports.
