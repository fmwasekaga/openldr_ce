import { type Kysely, sql } from 'kysely';
import { SEED_PUBLISHERS } from '../../seed-publishers';
import { resolvePublisher } from '../../resolve-publisher';

const SYSTEM_PUBLISHER_ID = SEED_PUBLISHERS[0].id; // the 'System' (local) publisher

/** Derive a short system code from a canonical URL: last non-empty path segment
 * upper-cased; falls back to the host's first label; finally the whole url. */
export function deriveSystemCode(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return (seg || u.hostname.split('.')[0] || url).toUpperCase();
  } catch {
    return url.toUpperCase();
  }
}

export interface BackfillRow {
  id: string;
  url: string;
  system_code: string;
  system_name: string;
  publisher_id: string;
  publisherName: string; // for tests only; not stored
}

/**
 * Project canonical URLs into coding_systems seed rows. The id scheme
 * `cs-<CODE>-<PUB>` hashes (last-path-segment, publisher), NOT the full url — so two
 * distinct URLs that share the same last segment under the same publisher collide on
 * id and the second is silently skipped by `ON CONFLICT (id) DO NOTHING`. Acceptable
 * for this display-only backfill (the underlying terminology_concepts rows are
 * unaffected); standard terminology URLs (LOINC/SNOMED/ICD/HL7) do not collide.
 */
export function computeBackfill(urls: string[]): BackfillRow[] {
  const pubs = SEED_PUBLISHERS.map((p) => ({ id: p.id, name: p.name, matchPrefixes: p.matchPrefixes }));
  return urls.map((url) => {
    const pub = resolvePublisher(url, pubs);
    const publisher = pub ?? { id: SYSTEM_PUBLISHER_ID, name: 'System' };
    const code = deriveSystemCode(url);
    return {
      id: `cs-${code}-${publisher.id}`,
      url,
      system_code: code,
      system_name: code,
      publisher_id: publisher.id,
      publisherName: publisher.name,
    };
  });
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('publishers')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('role', 'text', (c) => c.notNull())
    .addColumn('icon', 'text')
    .addColumn('match_prefixes', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('seeded', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable('coding_systems')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('system_code', 'text', (c) => c.notNull())
    .addColumn('system_name', 'text', (c) => c.notNull())
    .addColumn('url', 'text')
    .addColumn('system_version', 'text')
    .addColumn('description', 'text')
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('publisher_id', 'text', (c) => c.references('publishers.id').onDelete('set null'))
    .addColumn('seeded', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();

  // Partial unique index: enforce uniqueness only on non-NULL urls so multiple
  // draft/internal systems (url = NULL) can coexist. pg-mem ignores the WHERE
  // predicate, but it is correct and explicit on real Postgres.
  await db.schema
    .createIndex('coding_systems_url_uq')
    .ifNotExists()
    .unique()
    .on('coding_systems')
    .column('url')
    .where('url', 'is not', null)
    .execute();

  // Seed publishers (idempotent on the text pk).
  for (const p of SEED_PUBLISHERS) {
    await sql`
      INSERT INTO publishers (id, name, role, icon, match_prefixes, seeded, sort_order)
      VALUES (${p.id}, ${p.name}, ${p.role}, NULL, ${JSON.stringify(p.matchPrefixes)}::jsonb, true, ${p.sortOrder})
      ON CONFLICT (id) DO NOTHING
    `.execute(db);
  }

  // Project every existing concept-system URL into a seeded coding_systems row.
  const urlRows = await sql<{ url: string }>`
    SELECT DISTINCT system AS url FROM terminology_concepts
    UNION
    SELECT DISTINCT url FROM terminology_systems
  `.execute(db);
  const urls = urlRows.rows.map((r) => r.url).filter((u): u is string => !!u);
  for (const row of computeBackfill(urls)) {
    await sql`
      INSERT INTO coding_systems (id, system_code, system_name, url, publisher_id, seeded)
      VALUES (${row.id}, ${row.system_code}, ${row.system_name}, ${row.url}, ${row.publisher_id}, true)
      ON CONFLICT (id) DO NOTHING
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('coding_systems').ifExists().execute();
  await db.schema.dropTable('publishers').ifExists().execute();
}
