import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '../schema/internal';

export async function readCursor(db: Kysely<InternalSchema>, consumer: string): Promise<number> {
  const row = await db.selectFrom('fhir.change_cursors').select('last_seq').where('consumer', '=', consumer).executeTakeFirst();
  return row ? Number(row.last_seq) : 0;
}

export async function advanceCursor(db: Kysely<InternalSchema>, consumer: string, seq: number): Promise<void> {
  await db
    .insertInto('fhir.change_cursors')
    .values({ consumer, last_seq: seq })
    .onConflict((oc) => oc.column('consumer').doUpdateSet({ last_seq: seq, updated_at: sql`now()` }))
    .execute();
}
