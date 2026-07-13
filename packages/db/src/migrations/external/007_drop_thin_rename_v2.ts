import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';

const THIN_TABLES = ['patients', 'specimens', 'service_requests', 'diagnostic_reports', 'observations', 'organizations', 'locations'];
const RENAMES: [string, string][] = [
  ['v2_patients', 'patients'],
  ['v2_lab_requests', 'lab_requests'],
  ['v2_lab_results', 'lab_results'],
  ['v2_facilities', 'facilities'],
  ['v2_specimens', 'specimens'],
  ['v2_diagnostic_reports', 'diagnostic_reports'],
];

async function rename(db: Kysely<unknown>, engine: TargetEngine, from: string, to: string): Promise<void> {
  if (engine === 'mssql') {
    // SQL Server has no ALTER TABLE ... RENAME TO; sp_rename does the same job.
    await sql`EXEC sp_rename ${sql.lit(from)}, ${sql.lit(to)}`.execute(db);
  } else {
    await db.schema.alterTable(from).renameTo(to).execute();
  }
}

// R3e: the thin flat read-model is fully superseded by the v2 relational tables. Drop the 7 thin
// tables, THEN rename the 6 v2_ tables to canonical (drop first so v2_specimens->specimens etc. do
// not collide with the thin table of the same name).
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  for (const t of THIN_TABLES) await db.schema.dropTable(t).ifExists().execute();
  for (const [from, to] of RENAMES) await rename(db, engine, from, to);
}

// One-directional: renames canonical back to v2_ only (restores the pre-007 table NAMES). Recreating
// the dropped thin tables is intentionally out of scope — the thin schema is gone for good. down()
// runs only on real PG in dev, never under pg-mem tests.
export async function down(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  for (const [from, to] of RENAMES) await rename(db, engine, to, from);
}
