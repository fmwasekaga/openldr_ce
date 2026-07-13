// Golden acceptance for the built-in reports + the sample dashboard, over the canonical relational
// read model (restructure R3e Task 9 — the load-bearing proof of the drop-thin + rename slice).
//
// The thin external schema is gone and the v2_* read-model tables have been renamed to canonical
// (`patients`, `lab_requests`, `lab_results`, `facilities`, `specimens`, `diagnostic_reports`). The
// old thin-vs-v2 parity harnesses proved the two schemas AGREED; with thin retired they have no
// oracle. This harness instead pins each report's output to a committed golden snapshot: it seeds a
// fixed FHIR fixture into the canonical read model via createRelationalWriter, runs each report's
// Postgres SQL, and asserts row-for-row equality against scripts/lib/reports-golden.json (captured in
// R3e Task 1 from the pre-rename output — so any rename that changed a report's output shows up here
// as a firstDiff, NOT a silent pass).
//
// It also SMOKE-tests the bundled sample dashboard (@openldr/dashboards SAMPLE_DASHBOARD) against the
// same seeded canonical DB: every filter `optionsSql` and every `mode:'sql'` widget query must EXECUTE
// without throwing (Metabase optional `[[...]]` clauses stripped), and any returned rows must carry
// the widget's declared output column keys. Some widgets return 0 rows over the fixture — that's fine
// for smoke; only a THROWN error or a missing declared key is a failure.
//
// Preconditions: a reachable dev Postgres external target on :5433 with an `openldr_target` DB.
//   docker compose up -d postgres
//
// Run: tsx scripts/reports-golden-accept.ts   (or `pnpm reports:accept`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Kysely, sql } from 'kysely';
import { createMigrator, externalMigrations, createRelationalWriter, type ExternalSchema } from '@openldr/db';
import { createDbStore } from '@openldr/adapter-db-store';
import { prepareSelect, SAMPLE_DASHBOARD } from '@openldr/dashboards';
import { SEED_QUERIES } from '../packages/reporting/src/seed/report-seeds';
import { TABLES, PROV, patients, specimens, serviceRequests, diagnosticReports, observations, normalizeRows, firstDiff } from './lib/reports-parity-fixture';

const PG_URL = process.env.TARGET_DATABASE_URL ?? 'postgresql://openldr:openldr@localhost:5433/openldr_target';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface GoldenEntry {
  id: string;
  bag: Record<string, string>;
  rows: Record<string, unknown>[];
}
const GOLDEN: GoldenEntry[] = JSON.parse(readFileSync(join(__dirname, 'lib', 'reports-golden.json'), 'utf8'));

async function migrateAndClean(db: Kysely<ExternalSchema>): Promise<void> {
  const migrator = createMigrator(db as unknown as Kysely<unknown>, externalMigrations('postgres'));
  const res = await migrator.migrateToLatest();
  if (res.error) throw res.error;
  for (const t of TABLES) await sql.raw(`delete from ${t}`).execute(db as unknown as Kysely<unknown>);
}

async function seedFixture(db: Kysely<ExternalSchema>): Promise<void> {
  const items = [...patients, ...specimens, ...serviceRequests, ...diagnosticReports, ...observations].map((resource) => ({ resource, provenance: PROV }));
  const rel = createRelationalWriter(db, 'postgres');
  await rel.writeMany(items);
  // rel intentionally skips resource types it doesn't project; don't assert its skip count.
}

async function runQuery(db: Kysely<ExternalSchema>, sqlText: string): Promise<Record<string, unknown>[]> {
  const r = await sql.raw<Record<string, unknown>>(sqlText).execute(db as unknown as Kysely<unknown>);
  return r.rows;
}

// ── Dashboard smoke helpers ──
// Strip Metabase optional clauses (`[[ ... {{var}} ... ]]`). Every `{{var}}` token in the sample
// board lives INSIDE such a clause, so after stripping the SQL is plain, parameter-free SQL.
function stripOptional(sqlText: string): string {
  return sqlText.replace(/\[\[[^\]]*\]\]/g, '');
}

// The output column keys a widget's renderer expects: the table's declared column keys, plus any
// x/y/size axis keys the visual binds (covers kpi/gauge/traffic-light `value`, chart `label`+`value`,
// scatter `x`/`y`, and the table's `visual.columns[].key`).
function expectedKeys(widget: Record<string, unknown>): string[] {
  const v = (widget['visual'] as Record<string, unknown> | undefined) ?? {};
  const keys = new Set<string>();
  const cols = v['columns'];
  if (Array.isArray(cols)) for (const c of cols) { const k = (c as Record<string, unknown>)?.['key']; if (typeof k === 'string') keys.add(k); }
  for (const axis of ['xAxisKey', 'yAxisKey', 'sizeKey']) { const k = v[axis]; if (typeof k === 'string') keys.add(k); }
  return [...keys];
}

async function main(): Promise<void> {
  const pgStore = createDbStore({ url: PG_URL });
  const pgDb = pgStore.db as unknown as Kysely<ExternalSchema>;
  let reportFailures = 0;
  let dashFailures = 0;
  try {
    console.log(`[setup] postgres target: ${PG_URL}`);
    console.log('[setup] migrating external schema to latest (canonical read model)...');
    await migrateAndClean(pgDb);
    console.log('[setup] seeding fixture into the canonical relational tables...');
    await seedFixture(pgDb);

    // ── 1. Reports golden check ──
    console.log('\n=== reports golden check ===');
    for (const g of GOLDEN) {
      const seed = SEED_QUERIES.find((q) => q.id === g.id);
      if (!seed) {
        reportFailures++;
        console.log(`FAIL: ${g.id}  (SEED_QUERIES is missing this report)`);
        continue;
      }
      const text = prepareSelect(seed.sql.postgres, seed.params, g.bag).replace(/;\s*$/, '');
      const raw = await runQuery(pgDb, text);
      const actual = normalizeRows(raw);
      const expected = normalizeRows(g.rows);
      const diff = firstDiff(actual, expected);
      if (diff) {
        reportFailures++;
        console.log(`FAIL: ${g.id} ${JSON.stringify(g.bag)}  (actual=${raw.length} rows, golden=${g.rows.length} rows)`);
        console.log(`    ${diff.reason}`);
        console.log(`    actual: ${JSON.stringify(diff.a)}`);
        console.log(`    golden: ${JSON.stringify(diff.b)}`);
      } else {
        console.log(`PASS: ${g.id} ${JSON.stringify(g.bag)}  (${actual.length} rows == golden)`);
      }
    }

    // ── 2. Dashboard smoke check ──
    console.log('\n=== dashboard smoke check (SAMPLE_DASHBOARD) ===');
    const board = SAMPLE_DASHBOARD as unknown as Record<string, unknown>;
    const filters = (board['filters'] as Record<string, unknown>[] | undefined) ?? [];
    for (const f of filters) {
      const optionsSql = f['optionsSql'];
      if (typeof optionsSql !== 'string' || optionsSql.trim() === '') continue;
      const fid = String(f['id']);
      try {
        await runQuery(pgDb, stripOptional(optionsSql).replace(/;\s*$/, ''));
        console.log(`PASS: filter ${fid} optionsSql executed`);
      } catch (e) {
        dashFailures++;
        console.log(`FAIL: filter ${fid} optionsSql threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const widgets = (board['widgets'] as Record<string, unknown>[] | undefined) ?? [];
    for (const w of widgets) {
      const query = (w['query'] as Record<string, unknown> | undefined) ?? {};
      if (query['mode'] !== 'sql' || typeof query['sql'] !== 'string') continue;
      const wid = String(w['id']);
      const wtype = String(w['type']);
      const text = stripOptional(query['sql'] as string).replace(/;\s*$/, '');
      let rows: Record<string, unknown>[];
      try {
        rows = await runQuery(pgDb, text);
      } catch (e) {
        dashFailures++;
        console.log(`FAIL: widget ${wid} (${wtype}) SQL threw: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const keys = expectedKeys(w);
      if (rows.length > 0 && keys.length > 0) {
        const missing = keys.filter((k) => !(k in rows[0]!));
        if (missing.length > 0) {
          dashFailures++;
          console.log(`FAIL: widget ${wid} (${wtype}) output is missing declared key(s) [${missing.join(', ')}]; row keys = [${Object.keys(rows[0]!).join(', ')}]`);
          continue;
        }
      }
      console.log(`PASS: widget ${wid} (${wtype}) executed (${rows.length} rows${keys.length ? `, keys ok: ${keys.join('+')}` : ''})`);
    }
  } finally {
    // Leave the dev DB clean.
    for (const t of TABLES) await sql.raw(`delete from ${t}`).execute(pgDb as unknown as Kysely<unknown>);
    await pgStore.close();
  }

  const total = reportFailures + dashFailures;
  console.log('\n────────────────────────────────────────────────────────');
  if (total === 0) {
    console.log('✅ reports golden + dashboard smoke PASSED (all reports == golden, all widgets execute)');
    process.exit(0);
  } else {
    console.log(`❌ ${reportFailures} report(s) diverged from golden, ${dashFailures} dashboard target(s) failed`);
    process.exit(1);
  }
}

void main();
