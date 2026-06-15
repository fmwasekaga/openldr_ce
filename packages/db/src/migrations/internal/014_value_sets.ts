import { type Kysely, sql } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('value_sets')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('url', 'text', (c) => c.notNull())
    .addColumn('version', 'text')
    .addColumn('name', 'text')
    .addColumn('title', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('experimental', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('description', 'text')
    .addColumn('compose', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('source_json', 'jsonb')
    .addColumn('immutable', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('category', 'text')
    .addColumn('publisher_id', 'text')
    .addColumn('expanded_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('value_sets_url_key').ifNotExists().unique()
    .on('value_sets').column('url').execute();
  await db.schema
    .createIndex('value_sets_publisher').ifNotExists()
    .on('value_sets').column('publisher_id').execute();

  await db.schema
    .createTable('valueset_expansions')
    .ifNotExists()
    .addColumn('value_set_id', 'text', (c) => c.notNull().references('value_sets.id').onDelete('cascade'))
    .addColumn('system_url', 'text', (c) => c.notNull())
    .addColumn('code', 'text', (c) => c.notNull())
    .addColumn('display', 'text')
    .addColumn('inactive', 'boolean', (c) => c.notNull().defaultTo(false))
    .addPrimaryKeyConstraint('valueset_expansions_pk', ['value_set_id', 'system_url', 'code'])
    .execute();
  await db.schema
    .createIndex('valueset_expansions_vs').ifNotExists()
    .on('valueset_expansions').column('value_set_id').execute();

  // Seeds (idempotent)
  const seedDb = db as Kysely<any>;
  const LOCAL_CS = 'urn:openldr:cs:local';
  const PUB = 'pub-system';

  await seedDb.insertInto('coding_systems').values({
    id: 'cs-openldr-local', system_code: 'LOCAL', system_name: 'OpenLDR Local Codes',
    url: LOCAL_CS, system_version: null, description: 'Local enumerated codes for seed value sets',
    active: true, publisher_id: PUB, seeded: true,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

  const SEEDS: { slug: string; title: string; status: string; concepts: [string, string][] }[] = [
    { slug: 'yes-no', title: 'Yes / No', status: 'active', concepts: [['Y', 'Yes'], ['N', 'No']] },
    { slug: 'biological-sex', title: 'Biological Sex', status: 'active', concepts: [['M', 'Male'], ['F', 'Female'], ['O', 'Other'], ['U', 'Unknown']] },
    { slug: 'result-interpretation', title: 'Result Interpretation', status: 'active', concepts: [['POS', 'Positive'], ['NEG', 'Negative'], ['IND', 'Indeterminate']] },
    { slug: 'specimen-type', title: 'Specimen Type', status: 'draft', concepts: [['BLD', 'Blood'], ['UR', 'Urine'], ['CSF', 'CSF'], ['SPT', 'Sputum']] },
    { slug: 'malaria-species', title: 'Malaria Species', status: 'draft', concepts: [['PF', 'P. falciparum'], ['PV', 'P. vivax'], ['PM', 'P. malariae'], ['PO', 'P. ovale']] },
    { slug: 'hiv-result', title: 'HIV Result', status: 'draft', concepts: [['R', 'Reactive'], ['NR', 'Non-reactive'], ['IND', 'Indeterminate']] },
  ];

  const conceptKeys = new Set<string>();
  for (const s of SEEDS) for (const [code, display] of s.concepts) {
    if (conceptKeys.has(code)) continue;
    conceptKeys.add(code);
    await seedDb.insertInto('terminology_concepts').values({ system: LOCAL_CS, code, display, status: 'ACTIVE', properties: null } as never)
      .onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
  }

  for (const s of SEEDS) {
    const url = `urn:openldr:valueset:${s.slug}`;
    const id = `vs-seed-${s.slug}`;
    const compose = { include: [{ system: LOCAL_CS, concept: s.concepts.map(([code, display]) => ({ code, display })) }] };
    await seedDb.insertInto('value_sets').values({
      id, url, version: null, name: s.slug, title: s.title, status: s.status, experimental: false,
      description: null, compose: JSON.stringify(compose) as never, immutable: false, category: null, publisher_id: PUB,
      expanded_at: sql`now()`,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

    for (const [code, display] of s.concepts) {
      await seedDb.insertInto('valueset_expansions').values({ value_set_id: id, system_url: LOCAL_CS, code, display, inactive: false } as never)
        .onConflict((oc) => oc.columns(['value_set_id', 'system_url', 'code']).doNothing()).execute();
    }

    const resource = valueSetToFhirResource(
      { id, url, status: s.status as never, experimental: false, version: null, name: s.slug, title: s.title, description: null, compose },
      s.concepts.map(([code, display]) => ({ system: LOCAL_CS, code, display })),
    );
    await seedDb.insertInto('fhir_resources').values({
      id, resource_type: 'ValueSet', resource: JSON.stringify(resource),
    } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();
    await seedDb.insertInto('terminology_systems').values({ url, version: null, kind: 'ValueSet', resource_id: id } as never)
      .onConflict((oc) => oc.column('url').doNothing()).execute();
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('valueset_expansions').ifExists().execute();
  await db.schema.dropTable('value_sets').ifExists().execute();
}
