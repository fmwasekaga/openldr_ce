import { type Kysely, sql } from 'kysely';

// R1 of the FHIR storage restructure: make the canonical store versioned and emit an
// append-only change-log. All objects live in the `fhir` schema (created in R0). up() uses
// the plain DDL forms verified to run under pg-mem; down() runs only on real Postgres.

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Monotonic per-resource version on the canonical table. Default 1 means every existing
  //    row is its own first live version, and an insert that omits `version` still lands a
  //    valid v1 rather than a stray 0 that disagrees with resource_history/change_log.
  await sql`alter table fhir.fhir_resources add column version bigint not null default 1`.execute(db);

  // 2. Append-only per-version history (upserts store the resource; deletes store null = tombstone).
  await sql`create table fhir.resource_history (
    resource_type text not null,
    id text not null,
    version bigint not null,
    op text not null,
    resource jsonb,
    recorded_at timestamptz not null default now(),
    primary key (resource_type, id, version)
  )`.execute(db);

  // 3. Append-only change-log — the frozen contract. seq (bigserial) is the cursor axis.
  await sql`create table fhir.change_log (
    seq bigserial primary key,
    resource_type text not null,
    resource_id text not null,
    version bigint not null,
    op text not null,
    content_hash text,
    site_id text,
    recorded_at timestamptz not null default now()
  )`.execute(db);

  // 4. Per-consumer high-water-mark cursors (created now to freeze the contract; unused until R2).
  await sql`create table fhir.change_cursors (
    consumer text primary key,
    last_seq bigint not null default 0,
    updated_at timestamptz not null default now()
  )`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop table if exists fhir.change_cursors`.execute(db);
  await sql`drop table if exists fhir.change_log`.execute(db);
  await sql`drop table if exists fhir.resource_history`.execute(db);
  await sql`alter table fhir.fhir_resources drop column if exists version`.execute(db);
}
