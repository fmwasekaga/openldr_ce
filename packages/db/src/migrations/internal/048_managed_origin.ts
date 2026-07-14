import { type Kysely } from 'kysely';

// Distributed sync S2: mark which reference-config rows are center-managed. A lab pulling
// from central reconciles ONLY rows stamped 'central' (incl. deletes); locally-authored rows
// stay `managed_origin IS NULL` and are never touched by pull. Nullable, no default:
// existing/local rows remain null (lab-local) until the applier stamps them 'central'.
const TABLES = ['form_definitions', 'dashboards', 'reports'] as const;

export async function up(db: Kysely<any>): Promise<void> {
  for (const table of TABLES) {
    await db.schema.alterTable(table).addColumn('managed_origin', 'text').execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of TABLES) {
    await db.schema.alterTable(table).dropColumn('managed_origin').execute();
  }
}
