import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, migrateAllDown } from '../../migrator';
import { externalMigrations } from './index';

// The external migration set must be fully REVERSIBLE, because `db reset`
// (bootstrap db-context.reset) runs migrateAllDown — every down() in reverse — then re-migrates up.
// Migration 007 drops the 7 thin tables and renames the 6 v2_ tables to canonical; if its down()
// only reverses the rename and never recreates the thin tables, the reverse chain later reaches
// 002 down (`alter specimens drop origin`) against a table that no longer exists and fails with
// `relation "specimens" does not exist` — the failure that made `db reset` unusable on a migrated DB.
//
// This can only be exercised on a REAL Postgres: pg-mem's DROP TABLE does not release the
// primary-key index name, so create -> drop -> create of any PK table throws `<t>_pkey already
// exists` there — a limitation of the mock, not of the migrations — and the reversibility we pin is
// a real-Postgres property (drop frees the index). So this runs only when TARGET_DATABASE_URL points
// at a live Postgres (the migrated dev target DB); the default hermetic `pnpm test` skips it.
//
// It provisions its OWN throwaway database so it never touches the shared dev target schema.
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

live('external migrations reset round-trip (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_rt_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<Record<string, never>>;

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString() }) }) });
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined); // ends the target pool so the drop can proceed
    // Terminate any lingering backends, then drop the throwaway DB.
    await admin
      .query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName])
      .catch(() => undefined);
    await admin.query(`drop database if exists "${dbName}"`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it('migrates up -> fully down -> up again (the reset() sequence) with a reversible down chain', async () => {
    const migrator = createMigrator(db, externalMigrations('postgres'));

    // 1) up to latest
    const up1 = await migrator.migrateToLatest();
    expect(up1.error).toBeUndefined();

    // 2) all the way down. Pre-fix this threw at 002 down because 007 down never recreated the thin
    //    `specimens` table. migrateAllDown rethrows the first down() error, so this resolving is the
    //    core assertion.
    await expect(migrateAllDown(migrator)).resolves.toBeUndefined();
    // every canonical + v2_ table is gone after the full down chain
    for (const t of ['patients', 'specimens', 'diagnostic_reports', 'lab_requests', 'lab_results', 'facilities', 'v2_specimens']) {
      await expect(sql`select 1 from ${sql.raw(t)}`.execute(db)).rejects.toThrow();
    }

    // 3) up again — the re-migrate half of reset(). Canonical (relational v2) shape is restored and writable.
    const up2 = await migrator.migrateToLatest();
    expect(up2.error).toBeUndefined();
    await sql`insert into specimens (id, patient_id, origin) values ('s1', 'p1', 'inpatient')`.execute(db);
    expect((await sql<{ id: string }>`select id from specimens`.execute(db)).rows).toHaveLength(1);
  });
});
