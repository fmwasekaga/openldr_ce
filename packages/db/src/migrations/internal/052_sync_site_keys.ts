import { type Kysely } from 'kysely';

// Distributed sync S5: extend the S4d sync_sites registry with per-site signing material for
// offline bundle verification. `signing_public_key` is the site's ed25519 SPKI DER public key
// (hex) — central verifies the lab's push bundles with it (the site's PRIVATE key is handed to
// the lab once at enroll/rotate and NEVER persisted centrally). `reported_pull_cursor` piggybacks
// the lab's last-applied 'sync-pull' position so central can report per-site pull progress.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('sync_sites').addColumn('signing_public_key', 'text').execute();     // SPKI DER, hex
  await db.schema.alterTable('sync_sites').addColumn('reported_pull_cursor', 'bigint').execute();  // piggybacked lab 'sync-pull' pos
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('sync_sites').dropColumn('reported_pull_cursor').execute();
  await db.schema.alterTable('sync_sites').dropColumn('signing_public_key').execute();
}
