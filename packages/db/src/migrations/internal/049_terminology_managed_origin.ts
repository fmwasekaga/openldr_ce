import { type Kysely } from 'kysely';

// Distributed sync S3: mark which terminology metadata rows are center-managed. Mirrors S2's
// 048_managed_origin (dashboards/reports/form_definitions) for the three small terminology
// metadata tables so they ride the same per-row pull model. A lab pulling from central reconciles
// ONLY rows stamped 'central' (incl. deletes); locally-authored rows stay `managed_origin IS NULL`
// and are never touched by pull. Nullable, no default: existing/local rows remain null (lab-local)
// until the applier stamps them 'central'.
const TABLES = ['publishers', 'coding_systems', 'term_mappings'] as const;

export async function up(db: Kysely<any>): Promise<void> {
  for (const t of TABLES) {
    await db.schema.alterTable(t).addColumn('managed_origin', 'text').execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const t of TABLES) {
    await db.schema.alterTable(t).dropColumn('managed_origin').execute();
  }
}
