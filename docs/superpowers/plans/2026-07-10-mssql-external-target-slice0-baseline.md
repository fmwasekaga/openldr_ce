# MSSQL External Target — Slice 0: Baseline Validation + Version Decision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish and document a validated baseline for self-hosted SQL Server (2017/2019/2022) as an OpenLDR CE external target: a single source-of-truth version-support module, a version-matrix acceptance runner, edge-case coverage in the live acceptance script, and published support/no-cloud policy.

**Architecture:** Slice 0 is scoped to the target-store layer that already works (adapter, dialect-aware external migrations, FlatWriter MERGE) plus new edge-case coverage — all exercisable directly over the `Kysely<ExternalSchema>` handle without the connector-routed reporting path. The version-support policy becomes a pure, unit-tested module in `@openldr/adapter-mssql-store`; the live acceptance script (`scripts/mssql-live-acceptance.ts`, run via `pnpm mssql:accept`) is extended with Unicode/null/scale/datetime2 assertions; a bash matrix runner boots each supported version container in turn. Reports-over-MSSQL is explicitly deferred to Slice 2 (built-in reports now run their SQL through the default Postgres warehouse connector, not the raw `db` handle).

**Tech Stack:** TypeScript, Kysely (`MssqlDialect` + tedious + tarn), vitest, tsx, Docker (`mcr.microsoft.com/mssql/server`), bash.

---

## Context the engineer needs

- **Internal DB is always Postgres.** This slice only touches the *external/target* warehouse path. Do not change internal-DB code.
- **The acceptance script is not in the typecheck/lint/CI gate.** `scripts/` runs manually via `pnpm mssql:accept` (tsx imports workspace packages from source). "Tests" for the script are its own runtime assertions against a live SQL Server.
- **Live SQL Server via Docker.** Standalone isolated container (do NOT use the compose `mssql` profile — its network is stale). Example:
  ```bash
  docker run -d --name openldr-mssql-2022 -e ACCEPT_EULA=Y \
    -e MSSQL_SA_PASSWORD='Openldr_Local_2026!' -p 11433:1433 \
    mcr.microsoft.com/mssql/server:2022-latest
  ```
  Then create the target DB. **Windows/Git-Bash gotcha:** prefix `export MSYS_NO_PATHCONV=1` before any `docker exec … sqlcmd …` (path mangling), and use the `tools18` sqlcmd with `-C` (trust cert):
  ```bash
  MSYS_NO_PATHCONV=1 docker exec openldr-mssql-2022 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P 'Openldr_Local_2026!' -C -Q "CREATE DATABASE openldr_target;"
  ```
- **Real flat `patients` columns:** `id, identifier_system, identifier_value, family_name, given_name, gender, birth_date, managing_organization, source_system, plugin_id, plugin_version, batch_id, created_at` (`packages/db/src/migrations/external/001_flat_tables.ts`). **`service_requests`:** `id, identifier_value, status, intent, priority, code_code, code_text, subject_ref, authored_on, source_system, …`.
- **The acceptance script's `MssqlStoreConfig`** already reads `MSSQL_HOST/MSSQL_PORT/MSSQL_DATABASE/MSSQL_USER/MSSQL_PASSWORD` from env with localhost/11433/openldr_target/sa defaults — the matrix runner just varies `MSSQL_PORT` per container.

## File structure

- **Create** `packages/adapter-mssql-store/src/supported-versions.ts` — pure single-source-of-truth for supported SQL Server versions + the demo-container image. One responsibility: version policy.
- **Create** `packages/adapter-mssql-store/src/supported-versions.test.ts` — unit tests for the above.
- **Modify** `packages/adapter-mssql-store/src/index.ts` — re-export the version module so consumers (installer scripts, docs generation) import from the package root.
- **Modify** `scripts/mssql-live-acceptance.ts` — add steps 5–8 (Unicode, null, scale/idempotency, datetime2 ordering) and extend cleanup.
- **Create** `scripts/mssql-matrix-accept.sh` — boot each supported version container, create DB, run the acceptance against it, tear down; loop the matrix.
- **Modify** root `package.json` — add `mssql:accept:matrix` script.
- **Modify** `DEPLOYMENT.md` — add the "Supported external databases" section (matrix + no-cloud/data-sovereignty policy).

---

### Task 1: Version-support module (pure, TDD)

**Files:**
- Create: `packages/adapter-mssql-store/src/supported-versions.ts`
- Test: `packages/adapter-mssql-store/src/supported-versions.test.ts`
- Modify: `packages/adapter-mssql-store/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/adapter-mssql-store/src/supported-versions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_MSSQL_VERSIONS,
  MIN_SUPPORTED_MSSQL_MAJOR,
  isSupportedMssqlVersion,
  demoMssqlImage,
} from './supported-versions';

describe('supported MSSQL versions', () => {
  it('supports exactly 2017, 2019, 2022 (self-hosted only)', () => {
    expect(SUPPORTED_MSSQL_VERSIONS.map((v) => v.major).sort()).toEqual([2017, 2019, 2022]);
  });

  it('floors at 2017', () => {
    expect(MIN_SUPPORTED_MSSQL_MAJOR).toBe(2017);
  });

  it('rejects 2014 and 2016 (no Linux container / EOL)', () => {
    expect(isSupportedMssqlVersion(2014)).toBe(false);
    expect(isSupportedMssqlVersion(2016)).toBe(false);
  });

  it('accepts each supported major', () => {
    for (const major of [2017, 2019, 2022]) {
      expect(isSupportedMssqlVersion(major)).toBe(true);
    }
  });

  it('has exactly one demo-default version, pinned to 2022', () => {
    const demos = SUPPORTED_MSSQL_VERSIONS.filter((v) => v.demoDefault);
    expect(demos).toHaveLength(1);
    expect(demos[0].major).toBe(2022);
    expect(demoMssqlImage()).toBe('mcr.microsoft.com/mssql/server:2022-latest');
  });

  it('every version has an official mcr Linux image tag', () => {
    for (const v of SUPPORTED_MSSQL_VERSIONS) {
      expect(v.image).toBe(`mcr.microsoft.com/mssql/server:${v.major}-latest`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/adapter-mssql-store test`
Expected: FAIL — `Cannot find module './supported-versions'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/adapter-mssql-store/src/supported-versions.ts`:

```ts
// Single source of truth for which self-hosted SQL Server versions OpenLDR CE validates and
// supports as an external/analytics target. Cloud SQL (Azure SQL Database / Managed Instance,
// AWS RDS, any hosted service) is NEVER supported — a data-sovereignty requirement, not a gap.

export interface MssqlVersion {
  /** Marketing major year, e.g. 2017. */
  major: number;
  /** Official Microsoft Linux container image for the acceptance matrix. */
  image: string;
  /** The single version used for the non-production managed demo container. */
  demoDefault: boolean;
}

/** Supported, self-hosted only. Ordered oldest → newest. */
export const SUPPORTED_MSSQL_VERSIONS: readonly MssqlVersion[] = [
  { major: 2017, image: 'mcr.microsoft.com/mssql/server:2017-latest', demoDefault: false },
  { major: 2019, image: 'mcr.microsoft.com/mssql/server:2019-latest', demoDefault: false },
  { major: 2022, image: 'mcr.microsoft.com/mssql/server:2022-latest', demoDefault: true },
];

/** Lowest supported major. Operators on 2014/2016 upgrade to this. */
export const MIN_SUPPORTED_MSSQL_MAJOR = 2017;

export function isSupportedMssqlVersion(major: number): boolean {
  return SUPPORTED_MSSQL_VERSIONS.some((v) => v.major === major);
}

/** Image for the pinned non-production managed demo container. */
export function demoMssqlImage(): string {
  const demo = SUPPORTED_MSSQL_VERSIONS.find((v) => v.demoDefault);
  if (!demo) throw new Error('no demo-default MSSQL version configured');
  return demo.image;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/adapter-mssql-store test`
Expected: PASS — all 6 `supported MSSQL versions` tests green.

- [ ] **Step 5: Re-export from the package root**

In `packages/adapter-mssql-store/src/index.ts`, add near the top-level exports (after the existing `createMssqlStore` export block):

```ts
export {
  SUPPORTED_MSSQL_VERSIONS,
  MIN_SUPPORTED_MSSQL_MAJOR,
  isSupportedMssqlVersion,
  demoMssqlImage,
  type MssqlVersion,
} from './supported-versions';
```

- [ ] **Step 6: Verify typecheck + test still pass**

Run: `pnpm --filter @openldr/adapter-mssql-store typecheck && pnpm --filter @openldr/adapter-mssql-store test`
Expected: typecheck exits 0; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/adapter-mssql-store/src/supported-versions.ts \
        packages/adapter-mssql-store/src/supported-versions.test.ts \
        packages/adapter-mssql-store/src/index.ts
git commit -m "feat(mssql): version-support policy module (2017/2019/2022, self-hosted only)"
```

---

### Task 2: Version-matrix acceptance runner

**Files:**
- Create: `scripts/mssql-matrix-accept.sh`
- Modify: `package.json` (root scripts)

- [ ] **Step 1: Write the matrix runner script**

Create `scripts/mssql-matrix-accept.sh`:

```bash
#!/usr/bin/env bash
# Boot each supported SQL Server version in an isolated container, create the target DB,
# run the live acceptance against it, then tear it down. Versions/ports are kept in lockstep
# with packages/adapter-mssql-store/src/supported-versions.ts (2017/2019/2022).
#
# Usage: scripts/mssql-matrix-accept.sh
# Requires: docker, pnpm. Safe to re-run (containers are removed on entry + exit).
set -uo pipefail

PW='Openldr_Local_2026!'
DB='openldr_target'
# major:hostPort pairs — one free port each so versions can run sequentially without conflict.
VERSIONS=( "2017:11417" "2019:11419" "2022:11422" )

overall=0

for pair in "${VERSIONS[@]}"; do
  major="${pair%%:*}"
  port="${pair##*:}"
  name="openldr-mssql-${major}"
  image="mcr.microsoft.com/mssql/server:${major}-latest"

  echo ""
  echo "=================================================================="
  echo " SQL Server ${major}  (image ${image}, host port ${port})"
  echo "=================================================================="

  docker rm -f "${name}" >/dev/null 2>&1 || true
  docker run -d --name "${name}" -e ACCEPT_EULA=Y \
    -e "MSSQL_SA_PASSWORD=${PW}" -p "${port}:1433" "${image}" >/dev/null

  # Wait for the server to accept connections (up to ~90s).
  echo "  waiting for SQL Server ${major} to become ready..."
  ready=0
  for _ in $(seq 1 45); do
    if MSYS_NO_PATHCONV=1 docker exec "${name}" /opt/mssql-tools18/bin/sqlcmd \
         -S localhost -U sa -P "${PW}" -C -Q "SELECT 1" >/dev/null 2>&1; then
      ready=1; break
    fi
    sleep 2
  done
  if [ "${ready}" -ne 1 ]; then
    echo "  ❌ SQL Server ${major} did not become ready — skipping"
    docker logs --tail 20 "${name}" || true
    docker rm -f "${name}" >/dev/null 2>&1 || true
    overall=1
    continue
  fi

  MSYS_NO_PATHCONV=1 docker exec "${name}" /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "${PW}" -C -Q "IF DB_ID('${DB}') IS NULL CREATE DATABASE ${DB};"

  # MSSQL_ACCEPT_TARGET_ONLY=1 skips the app-context/reporting step (step 4) so the matrix
  # runner needs only Docker + a SQL Server container — no internal Postgres / S3 / Keycloak.
  MSSQL_HOST=localhost MSSQL_PORT="${port}" MSSQL_DATABASE="${DB}" \
    MSSQL_USER=sa MSSQL_PASSWORD="${PW}" MSSQL_ACCEPT_TARGET_ONLY=1 \
    pnpm mssql:accept
  rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "  ❌ acceptance FAILED on SQL Server ${major} (exit ${rc})"
    overall=1
  else
    echo "  ✅ acceptance PASSED on SQL Server ${major}"
  fi

  docker rm -f "${name}" >/dev/null 2>&1 || true
done

echo ""
if [ "${overall}" -eq 0 ]; then
  echo "✅ MSSQL matrix acceptance PASSED for all supported versions (2017/2019/2022)"
else
  echo "❌ MSSQL matrix acceptance had FAILURES — see above"
fi
exit "${overall}"
```

- [ ] **Step 2: Add the npm script**

In root `package.json` `scripts`, directly after the existing `"mssql:accept"` line, add:

```json
    "mssql:accept:matrix": "bash scripts/mssql-matrix-accept.sh",
```

- [ ] **Step 3: Verify the script is syntactically valid**

Run: `bash -n scripts/mssql-matrix-accept.sh`
Expected: no output, exit 0 (syntax OK). (Do not run the full matrix yet — the acceptance assertions land in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add scripts/mssql-matrix-accept.sh package.json
git commit -m "feat(mssql): version-matrix acceptance runner (2017/2019/2022)"
```

---

### Task 3: Target-only mode + edge-case coverage in the live acceptance script

First makes the app-context/reporting step (step 4) skippable so the matrix runner is self-contained, then adds four assertions over the real FlatWriter → `db` path: Unicode `nvarchar` round-trip, null handling, scale/idempotency at N=500, and `datetime2` ordering. The edge-case blocks are inserted after the existing step 4 block (the `r-patient-demographics` `ok(...)` call) and before the `} catch` at the end of the `try`.

**Files:**
- Modify: `scripts/mssql-live-acceptance.ts`

- [ ] **Step 0a: Make the app context conditional**

Replace the unconditional app-context creation (currently `const appCtx = await createAppContext(loadConfig());` around line 59, with its preceding comment) with a target-only guard:

```ts
  // Step 4 resolves the data-driven reports through the DEFAULT (Postgres) warehouse connector,
  // so it needs the full app context (internal Postgres / S3 / OIDC). In target-only mode the
  // matrix runner skips it: MSSQL_ACCEPT_TARGET_ONLY=1 exercises only the SQL Server `db` handle.
  const targetOnly = process.env.MSSQL_ACCEPT_TARGET_ONLY === '1';
  const appCtx = targetOnly ? null : await createAppContext(loadConfig());
```

- [ ] **Step 0b: Guard step 4 and the appCtx close**

Replace the existing step 4 block (the two `appCtx.reporting.run(...)` calls and their `ok(...)` lines) with:

```ts
    if (appCtx) {
      step('4. data-driven reporting resolves (r-<id> records)');
      const tvRes = await appCtx.reporting.run('r-test-volume', {});
      console.table(tvRes.rows);
      ok(`r-test-volume: ${tvRes.rows.length} rows`);
      const pdRes = await appCtx.reporting.run('r-patient-demographics', {});
      console.table(pdRes.rows);
      ok(`r-patient-demographics: ${pdRes.rows.length} rows`);
    } else {
      step('4. data-driven reporting — SKIPPED (target-only mode)');
      ok('skipped (MSSQL_ACCEPT_TARGET_ONLY=1)');
    }
```

In the `finally` block, replace `await appCtx.close();` with `await appCtx?.close();`.

- [ ] **Step 0c: Verify the script still imports/parses**

tsx has no `--check` flag, so do a fast parse by importing the module in a way that fails on syntax errors but not on the missing live DB. Run:

```bash
MSSQL_ACCEPT_TARGET_ONLY=1 MSSQL_HOST=127.0.0.1 MSSQL_PORT=1 node_modules/.bin/tsx scripts/mssql-live-acceptance.ts
```
Expected: it parses and runs, then FAILS fast at step 1 with a connection error (e.g. `[FAIL] … ECONNREFUSED`/timeout) — a *connection* error, not a *syntax/TypeScript* error. A syntax error here means Step 0a/0b are malformed; fix before continuing. (Real pass happens in Step 6 against a live container.)

- [ ] **Step 1: Add the Unicode round-trip step**

Insert the following **after the entire `if (appCtx) { … } else { … }` block from Step 0b** (i.e. immediately before the `} catch` that closes the `try`):

```ts
    step('5. Unicode round-trip (nvarchar(max))');
    const uName = 'Иванов-Chëng-陈';
    await writer.writeMany([{
      resource: { resourceType: 'Patient', id: 'u1', name: [{ family: uName, given: ['Zoë'] }], gender: 'female', birthDate: '1980-05-05' },
      provenance: prov,
    }]);
    const uRow = await db.selectFrom('patients').select(['family_name', 'given_name']).where('id', '=', 'u1').executeTakeFirstOrThrow();
    if (uRow.family_name !== uName) throw new Error(`unicode family_name mismatch: got ${JSON.stringify(uRow.family_name)}`);
    if (uRow.given_name !== 'Zoë') throw new Error(`unicode given_name mismatch: got ${JSON.stringify(uRow.given_name)}`);
    ok('Unicode names round-trip intact (nvarchar)');
```

- [ ] **Step 2: Add the null-handling step**

Immediately after the step 5 block, insert:

```ts
    step('6. Null handling (missing optional fields)');
    await writer.writeMany([{
      resource: { resourceType: 'Patient', id: 'n1', gender: 'unknown' },
      provenance: prov,
    }]);
    const nRow = await db.selectFrom('patients').select(['family_name', 'birth_date']).where('id', '=', 'n1').executeTakeFirstOrThrow();
    if (nRow.family_name !== null) throw new Error(`expected null family_name, got ${JSON.stringify(nRow.family_name)}`);
    if (nRow.birth_date !== null) throw new Error(`expected null birth_date, got ${JSON.stringify(nRow.birth_date)}`);
    ok('Missing optional fields persist as SQL NULL (not empty string)');
```

- [ ] **Step 3: Add the scale + idempotency step**

Immediately after the step 6 block, insert:

```ts
    step('7. Scale + idempotency (N=500, batched MERGE)');
    const BULK = 500;
    const bulkProv = { source_system: 'mssql-accept-bulk', plugin_id: null, plugin_version: null, batch_id: 'accept-bulk' };
    const bulkItems = Array.from({ length: BULK }, (_, i) => ({
      resource: { resourceType: 'ServiceRequest', id: `b${i}`, status: 'active', intent: 'order', code: { text: 'Bulk test' }, subject: { reference: 'Patient/u1' }, authoredOn: '2026-03-01T09:00:00Z' },
      provenance: bulkProv,
    }));
    await writer.writeMany(bulkItems);
    await writer.writeMany(bulkItems); // second write must MERGE-update, not duplicate
    const bulkCount = await db.selectFrom('service_requests').select((eb) => eb.fn.countAll<number>().as('n')).where('source_system', '=', 'mssql-accept-bulk').executeTakeFirstOrThrow();
    if (Number(bulkCount.n) !== BULK) throw new Error(`expected ${BULK} bulk rows after 2x write, got ${bulkCount.n}`);
    ok(`${BULK} rows batched + idempotent across two writes`);
```

- [ ] **Step 4: Add the datetime2 ordering step**

Immediately after the step 7 block, insert:

```ts
    step('8. datetime2 column round-trips and orders correctly');
    await writer.writeMany([
      { resource: { resourceType: 'ServiceRequest', id: 'd-late', status: 'active', intent: 'order', code: { text: 'Date test' }, subject: { reference: 'Patient/u1' }, authoredOn: '2026-05-20T09:00:00Z' }, provenance: prov },
      { resource: { resourceType: 'ServiceRequest', id: 'd-early', status: 'active', intent: 'order', code: { text: 'Date test' }, subject: { reference: 'Patient/u1' }, authoredOn: '2026-01-05T09:00:00Z' }, provenance: prov },
    ]);
    const ordered = await db.selectFrom('service_requests').select(['id', 'authored_on']).where('code_text', '=', 'Date test').orderBy('authored_on', 'asc').execute();
    if (ordered.map((r) => r.id).join(',') !== 'd-early,d-late') throw new Error(`date ordering wrong: ${ordered.map((r) => r.id).join(',')}`);
    ok('authored_on orders chronologically (date type preserved)');
```

- [ ] **Step 5: Extend cleanup to remove the bulk rows**

In the `finally` block, the existing cleanup deletes `source_system = 'mssql-acceptance'`. Add a line for the bulk source_system. Replace:

```ts
      await sql`delete from service_requests where source_system = 'mssql-acceptance'`.execute(db);
      await sql`delete from patients where source_system = 'mssql-acceptance'`.execute(db);
```

with:

```ts
      await sql`delete from service_requests where source_system in ('mssql-acceptance', 'mssql-accept-bulk')`.execute(db);
      await sql`delete from patients where source_system = 'mssql-acceptance'`.execute(db);
```

- [ ] **Step 6: Run the acceptance against a live 2022 container**

Boot a container and create the DB (see Context section), then:

Run:
```bash
docker rm -f openldr-mssql-2022 >/dev/null 2>&1; \
docker run -d --name openldr-mssql-2022 -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=Openldr_Local_2026!' -p 11422:1433 mcr.microsoft.com/mssql/server:2022-latest && \
sleep 25 && \
MSYS_NO_PATHCONV=1 docker exec openldr-mssql-2022 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'Openldr_Local_2026!' -C -Q "IF DB_ID('openldr_target') IS NULL CREATE DATABASE openldr_target;" && \
MSSQL_HOST=localhost MSSQL_PORT=11422 MSSQL_DATABASE=openldr_target MSSQL_USER=sa MSSQL_PASSWORD='Openldr_Local_2026!' pnpm mssql:accept
```
Expected: steps 1–8 each print `✓`, ending with `✅ MSSQL live acceptance PASSED`. Steps 5–8 show the new Unicode / null / 500-row / date-ordering checks.

- [ ] **Step 7: Commit**

```bash
git add scripts/mssql-live-acceptance.ts
git commit -m "test(mssql): edge-case acceptance — unicode, null, N=500 idempotency, datetime2 ordering"
```

---

### Task 4: Run the full version matrix

**Files:** none (verification task).

- [ ] **Step 1: Run the matrix across all supported versions**

Run: `pnpm mssql:accept:matrix`
Expected: three blocks (2017, 2019, 2022) each ending `✅ acceptance PASSED on SQL Server <major>`, then `✅ MSSQL matrix acceptance PASSED for all supported versions (2017/2019/2022)`. Total runtime ~3–6 min (image pulls on first run may add time).

- [ ] **Step 2: If any version fails, capture and triage**

If a version fails, note which step and error. Common causes: a T-SQL feature newer than the failing version (e.g. `GENERATE_SERIES` is 2022+ — must not be used), or an image pull/timeout. Fix in the relevant package (not the script's expectations) and re-run `pnpm mssql:accept:matrix`. Do not proceed to Task 5 until all three pass.

- [ ] **Step 3: No commit** (verification only). Record the passing output in the Task 5 doc.

---

### Task 5: Document the support matrix + no-cloud policy

**Files:**
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Add the "Supported external databases" section**

Append the following section to `DEPLOYMENT.md` (place it after the existing database/architecture content — find the first `## ` heading that discusses the database and add this as a new sibling `## ` section):

```markdown
## Supported external databases

OpenLDR CE stores operational data in an internal **PostgreSQL** database (always) and writes
flattened analytics/reporting data to a separate **external/target** database. The external
database may be **PostgreSQL** (default) or **self-hosted Microsoft SQL Server**.

### Microsoft SQL Server support matrix

| SQL Server version | Supported | Notes |
|--------------------|-----------|-------|
| 2017               | ✅ Yes    | Minimum supported release (nearest upgrade for 2014 sites). |
| 2019               | ✅ Yes    | |
| 2022               | ✅ Yes    | Used for the optional managed **demo** container. |
| 2016 and earlier   | ❌ No     | End of life / no official Linux container. Upgrade to 2017. |
| Azure SQL, Managed Instance, AWS RDS, any hosted/cloud SQL | ❌ Never | See data-sovereignty policy below. |

The supported set is validated end-to-end on every listed version by the acceptance matrix
(`pnpm mssql:accept:matrix`), and is the single source of truth defined in
`packages/adapter-mssql-store/src/supported-versions.ts`.

### Data-sovereignty policy: no cloud databases

OpenLDR CE does **not** support any cloud-hosted or managed database service for either the
internal or external database. Ministry of Health and laboratory data must remain within the
operator's own geographic and administrative boundaries, on infrastructure they control.
SQL Server must be a self-hosted instance. This is a deliberate, permanent constraint — not a
roadmap gap.

### Demo vs. production

- **Demo/evaluation:** the installer can provision a pinned SQL Server 2022 container. SQL Server
  Developer/Express editions are **not licensed for production** — this container is for
  evaluation only and must never back a production deployment.
- **Production:** bring your own self-hosted SQL Server (2017/2019/2022) and provide its
  connection details at install time.
```

- [ ] **Step 2: Verify the section renders and links are correct**

Run: `grep -n "Supported external databases\|Data-sovereignty\|supported-versions.ts" DEPLOYMENT.md`
Expected: matches showing the new section landed and references the source-of-truth module path.

- [ ] **Step 3: Commit**

```bash
git add DEPLOYMENT.md
git commit -m "docs(mssql): supported external database matrix + no-cloud data-sovereignty policy"
```

---

## Self-review notes

- **Spec coverage (Slice 0):** version decision → Task 1 (module) + Task 5 (docs); matrix runner + per-version validation → Task 2 + Task 4; edge cases (unicode/null/scale/date) → Task 3; support-matrix + no-cloud docs → Task 5. Reports-over-MSSQL is intentionally **not** here — it is Slice 2 (reports run through the default Postgres connector, per the note in `mssql-live-acceptance.ts`). Managed demo container + installer selection are Slice 1.
- **No placeholders:** all code blocks are complete; column names verified against `001_flat_tables.ts`; API names (`SUPPORTED_MSSQL_VERSIONS`, `demoMssqlImage`, `isSupportedMssqlVersion`) are consistent across Task 1 test/impl/export and Task 5 docs.
- **Type consistency:** the acceptance edits reuse the script's existing `writer`, `prov`, `db`, `sql`, `ok`, `step` bindings — no new imports required.
```

## Deferred to later slices (not this plan)

- **Slice 1:** installer external-DB selection (`install.sh`/`install.ps1`), managed-demo `mssql` compose service (pinned via `demoMssqlImage()`), dialect-aware seed, and seeding the default connector as `microsoft-sql`.
- **Slice 2:** dialect-aware `sql-runner.ts` + `query-routes.ts` (`SQL_TYPES`, pagination wrapper, identifier quoting, introspection), Custom Queries / Report Designer / dashboard raw-SQL over MSSQL, and `compile.ts` builder-query validation under `MssqlDialect` — which is what finally makes reports and the query workbench work against a SQL Server target.
