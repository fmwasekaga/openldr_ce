import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import * as m001 from './001_flat_tables';
import * as m002 from './002_specimen_origin';

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

// True inverse of up(), so the full external down-chain is reversible (needed by `db reset`, which
// runs every down() in reverse then re-migrates up). Mirror up()'s two steps in reverse order:
// first rename canonical back to v2_ (freeing the patients/specimens/diagnostic_reports names that
// up() reused), THEN recreate the 7 thin tables up() dropped. Recreating them restores the exact
// pre-007 schema (001's tables + 002's specimens.origin) so the earlier down()s can unwind — 002
// down drops specimens.origin and 001 down drops the thin tables. Without this, the reverse chain
// hits `alter specimens drop origin` against a table that no longer exists. Recreated empty: down
// migrations do not restore dropped row data, which is fine for the reset/rebuild path.
export async function down(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  for (const [from, to] of RENAMES) await rename(db, engine, to, from);
  await m001.up(db, engine);
  await m002.up(db, engine);
}
