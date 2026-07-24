import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { createMigrator } from '../migrator';
import { externalMigrations } from '../migrations/external';
import { createRelationalWriter } from '../relational-writer';
import type { ExternalSchema } from '../schema/external';

// Mirrors the live-Postgres bootstrap in
// packages/db/src/migrations/external/reset-roundtrip-live.test.ts verbatim: same env var
// (TARGET_DATABASE_URL), same skip guard, same throwaway-database provisioning. This proves the
// full write -> migrated-schema -> read path for QuestionnaireResponse, so it needs a real
// Postgres (pg-mem is fine for the projector-shape tests elsewhere but not for exercising the
// actual migrated DDL end to end). Skips cleanly when no live test DB is configured.
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

live('QuestionnaireResponse round-trip (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_rt_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<ExternalSchema>;

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString() }) }) });
    const migrator = createMigrator(db, externalMigrations('postgres'));
    const { error } = await migrator.migrateToLatest();
    expect(error).toBeUndefined();
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined); // ends the target pool so the drop can proceed
    await admin
      .query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName])
      .catch(() => undefined);
    await admin.query(`drop database if exists "${dbName}"`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it('writes a QR through the relational writer and reads it back from questionnaire_responses', async () => {
    const writer = createRelationalWriter(db, 'postgres');
    const qr = {
      resourceType: 'QuestionnaireResponse',
      id: 'qr1',
      status: 'completed',
      questionnaire: 'urn:openldr:form:hiv_vl_documentation',
      subject: { reference: 'Patient/p1' },
      authored: '2026-01-01T00:00:00+02:00',
      basedOn: [{ reference: 'ServiceRequest/req1-obr1' }],
      item: [{ linkId: 'VL_REASON', text: 'VL reason', answer: [{ valueString: 'Routine' }] }],
    };

    const result = await writer.write(qr, { sourceSystem: 'disa', batchId: 'b1' });
    expect(result).toBe('written');

    const row = await db.selectFrom('questionnaire_responses').selectAll().where('id', '=', 'qr1').executeTakeFirst();
    expect(row).toBeDefined();
    expect(row!.form_code).toBe('hiv_vl_documentation');
    expect(JSON.parse(row!.items!)).toHaveLength(1);
    expect(row!.based_on_id).toBe('req1-obr1');
  });
});
