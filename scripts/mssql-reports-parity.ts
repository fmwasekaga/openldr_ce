// Live cross-dialect report parity harness (Task 3, mssql-slice2b).
//
// Proves the 9 built-in `SEED_QUERIES` (packages/reporting/src/seed/report-seeds.ts) produce
// SEMANTICALLY EQUIVALENT results on SQL Server vs Postgres: identical rows/numbers after
// normalizing numeric formatting (round floats to 3dp) and tie order (sort rows by all columns).
// Trivial formatting differences (`100` vs `100.0`) are OK; real data differences are not.
//
// Preconditions: a reachable Postgres 16 + SQL Server 2022, each with an `openldr_target` DB.
//   docker run -d --name openldr-parity-pg -e POSTGRES_PASSWORD=openldr -e POSTGRES_DB=openldr_target \
//     -p 5544:5432 postgres:16
//   docker run -d --name openldr-parity-mssql -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='Openldr_Local_2026!' \
//     -p 11433:1433 mcr.microsoft.com/mssql/server:2022-latest
//   MSYS_NO_PATHCONV=1 docker exec openldr-parity-mssql /opt/mssql-tools18/bin/sqlcmd \
//     -S localhost -U sa -P 'Openldr_Local_2026!' -C -Q "CREATE DATABASE openldr_target;"
//
// Run: node_modules/.bin/tsx scripts/mssql-reports-parity.ts   (or `pnpm reports:parity`)
//
// Connection config is read from env with the above defaults; override via TARGET_DATABASE_URL /
// MSSQL_HOST / MSSQL_PORT / MSSQL_DATABASE / MSSQL_USER / MSSQL_PASSWORD if needed.
//
// The harness migrates the flat schema into BOTH engines, wipes+reseeds an IDENTICAL fixed FHIR
// fixture into both via createFlatWriter, then for each of the 9 SEED_QUERIES substitutes a fixed
// param bag into both the `postgres` and `mssql` SQL variants and runs them directly against each
// engine, normalizes + sorts both result sets, and deep-compares them. Exits non-zero on any
// mismatch, printing the first differing row.
import { Kysely, sql } from 'kysely';
import { createMigrator, externalMigrations, createFlatWriter, type ExternalSchema } from '@openldr/db';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMssqlStore } from '@openldr/adapter-mssql-store';
import { prepareSelect } from '@openldr/dashboards';
import { SEED_QUERIES, type SqlDialect } from '../packages/reporting/src/seed/report-seeds';

const PG_URL = process.env.TARGET_DATABASE_URL ?? 'postgresql://postgres:openldr@localhost:5544/openldr_target';
const MSSQL_CFG = {
  host: process.env.MSSQL_HOST ?? 'localhost',
  port: Number(process.env.MSSQL_PORT ?? 11433),
  database: process.env.MSSQL_DATABASE ?? 'openldr_target',
  user: process.env.MSSQL_USER ?? 'sa',
  password: process.env.MSSQL_PASSWORD ?? 'Openldr_Local_2026!',
  encrypt: false,
  trustServerCertificate: true,
};

const TABLES = ['observations', 'diagnostic_reports', 'service_requests', 'specimens', 'patients', 'organizations', 'locations'] as const;

const PROV = { sourceSystem: 'reports-parity-harness', batchId: 'fixture-1' };

// ── Fixed FHIR fixture (no randomness) — sized to exercise every one of the 9 report queries and
// every risky construct flagged in the task brief: age-band borrow-day boundaries, first-isolate
// dedup ties, dateless isolates, NULL-date exclusion, non-integer avg (truncation trap), an
// issued-before-received exclusion, and a 100%/0% antibiogram cell (no-trailing-zero format). ──

const patients = [
  { resourceType: 'Patient', id: 'pt-01', name: [{ family: 'Doe', given: ['John'] }], gender: 'male', birthDate: '1990-03-02', managingOrganization: { reference: 'Facility A' } },
  { resourceType: 'Patient', id: 'pt-02', name: [{ family: 'Roe', given: ['Jane'] }], gender: 'female', birthDate: '2019-06-15', managingOrganization: { reference: 'Facility A' } },
  { resourceType: 'Patient', id: 'pt-03', name: [{ family: 'Poe', given: ['Sam'] }], gender: 'female', birthDate: '1965-01-20', managingOrganization: { reference: 'Facility B' } },
  { resourceType: 'Patient', id: 'pt-04', name: [{ family: 'Kim', given: ['Alex'] }], gender: 'male', birthDate: '1960-01-01', managingOrganization: { reference: 'Facility B' } },
  { resourceType: 'Patient', id: 'pt-05', name: [{ family: 'Nil', given: ['Un'] }], managingOrganization: { reference: 'Facility A' } }, // gender + birth_date both unset -> null
  { resourceType: 'Patient', id: 'pt-06', name: [{ family: 'Cee', given: ['Ori'] }], gender: 'other', birthDate: '2010-05-05', managingOrganization: { reference: 'Facility C' } },
  { resourceType: 'Patient', id: 'pt-07', name: [{ family: 'Sev', given: ['Ann'] }], gender: 'male', birthDate: '2000-01-15', managingOrganization: { reference: 'Facility A' } },
  { resourceType: 'Patient', id: 'pt-08', name: [{ family: 'Eit', given: ['Bea'] }], gender: 'female', birthDate: '2023-08-01', managingOrganization: { reference: 'Facility A' } },
  { resourceType: 'Patient', id: 'pt-09', name: [{ family: 'Nin', given: ['Cy'] }], gender: 'other', managingOrganization: { reference: 'Facility B' } }, // birth_date null
  { resourceType: 'Patient', id: 'pt-10', name: [{ family: 'Ten', given: ['Di'] }], gender: 'male', birthDate: '1960-01-01', managingOrganization: { reference: 'Facility B' } },
  { resourceType: 'Patient', id: 'pt-11', name: [{ family: 'Ele', given: ['Fu'] }], gender: 'female', birthDate: '2027-06-01', managingOrganization: { reference: 'Facility B' } }, // future birth date -> 'unknown' band
  { resourceType: 'Patient', id: 'pt-12', name: [{ family: 'Twe', given: ['Gia'] }], gender: 'male', birthDate: '1975-07-07' }, // no managing_organization at all
];

const specimens = [
  // Turnaround-time fixture: pt-01 has two specimens (min() must pick the earlier one).
  { resourceType: 'Specimen', id: 'tat-sp1', subject: { reference: 'Patient/pt-01' }, receivedTime: '2026-03-01T08:00:00Z' },
  { resourceType: 'Specimen', id: 'tat-sp2', subject: { reference: 'Patient/pt-01' }, receivedTime: '2026-03-01T10:00:00Z' },
  { resourceType: 'Specimen', id: 'tat-sp3', subject: { reference: 'Patient/pt-03' }, receivedTime: '2026-03-10T08:00:00Z' },
  // AMR isolate fixture (mirrors the amr-glass-ris/amr-antibiogram parity-test fixtures).
  { resourceType: 'Specimen', id: 'amr-sp1', type: { coding: [{ code: 'blood' }], text: 'Blood' }, subject: { reference: 'Patient/pt-07' }, receivedTime: '2026-05-01T00:00:00Z', extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/specimen-origin', valueCode: 'inpatient' }] },
  { resourceType: 'Specimen', id: 'amr-sp2', type: { coding: [{ code: 'urine' }], text: 'Urine' }, subject: { reference: 'Patient/pt-08' }, receivedTime: '2026-05-10T00:00:00Z', extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/specimen-origin', valueCode: 'outpatient' }] },
  { resourceType: 'Specimen', id: 'amr-sp3', type: { coding: [{ code: 'csf' }], text: 'CSF' }, subject: { reference: 'Patient/pt-09' } }, // no receivedTime, no origin -> dateless/unknown
];

const serviceRequests = [
  { resourceType: 'ServiceRequest', id: 'sr1', status: 'active', intent: 'order', code: { text: 'Blood culture' }, subject: { reference: 'Patient/pt-01' }, authoredOn: '2026-02-10T09:00:00Z' },
  { resourceType: 'ServiceRequest', id: 'sr2', status: 'active', intent: 'order', code: { text: 'Blood culture' }, subject: { reference: 'Patient/pt-02' }, authoredOn: '2026-02-22T09:00:00Z' },
  { resourceType: 'ServiceRequest', id: 'sr3', status: 'active', intent: 'order', code: { text: 'Urine culture' }, subject: { reference: 'Patient/pt-03' }, authoredOn: '2026-03-03T09:00:00Z' },
  { resourceType: 'ServiceRequest', id: 'sr4', status: 'active', intent: 'order', code: { text: 'Urine culture' }, subject: { reference: 'Patient/pt-01' }, authoredOn: '2026-03-18T09:00:00Z' },
  { resourceType: 'ServiceRequest', id: 'sr5', status: 'active', intent: 'order', subject: { reference: 'Patient/pt-04' }, authoredOn: '2026-04-05T09:00:00Z' }, // no code.text -> '(unknown)'
  { resourceType: 'ServiceRequest', id: 'sr6', status: 'active', intent: 'order', code: { text: 'Malaria RDT' }, subject: { reference: 'Patient/pt-06' }, authoredOn: '2026-04-20T09:00:00Z' },
  { resourceType: 'ServiceRequest', id: 'sr7', status: 'active', intent: 'order', code: { text: 'Blood culture' }, subject: { reference: 'Patient/pt-03' }, authoredOn: '2026-05-11T09:00:00Z' },
];

const diagnosticReports = [
  // CBC x3 (pt-01 x2 via tat-sp1's earliest receipt 08:00, pt-03 x1) -> avg (11+14+12)/3 = 12.333...
  // deliberately non-integer to trip the T-SQL avg(int)-truncates bug if the mssql cast is missing.
  { resourceType: 'DiagnosticReport', id: 'dr1', status: 'final', code: { text: 'CBC' }, subject: { reference: 'Patient/pt-01' }, issued: '2026-03-01T19:00:00Z' }, // 11h
  { resourceType: 'DiagnosticReport', id: 'dr2', status: 'final', code: { text: 'CBC' }, subject: { reference: 'Patient/pt-01' }, issued: '2026-03-01T22:00:00Z' }, // 14h
  { resourceType: 'DiagnosticReport', id: 'dr3', status: 'final', subject: { reference: 'Patient/pt-01' }, issued: '2026-03-02T08:00:00Z' }, // 24h, code_text null -> '(unknown)'
  { resourceType: 'DiagnosticReport', id: 'dr4', status: 'final', code: { text: 'Malaria RDT' }, subject: { reference: 'Patient/pt-01' }, issued: '2026-02-28T08:00:00Z' }, // issued BEFORE received -> excluded
  { resourceType: 'DiagnosticReport', id: 'dr5', status: 'final', code: { text: 'CBC' }, subject: { reference: 'Patient/pt-03' }, issued: '2026-03-10T20:00:00Z' }, // 12h
];

function obs(
  id: string,
  opts: { subject?: string; specimen?: string; codeCode?: string; codeText?: string; valueCode?: string; valueText?: string; interpretation?: string; effective?: string },
): Record<string, unknown> {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    ...(opts.codeCode || opts.codeText ? { code: { ...(opts.codeCode ? { coding: [{ code: opts.codeCode }] } : {}), ...(opts.codeText ? { text: opts.codeText } : {}) } } : {}),
    ...(opts.subject ? { subject: { reference: opts.subject } } : {}),
    ...(opts.specimen ? { specimen: { reference: opts.specimen } } : {}),
    ...(opts.valueCode || opts.valueText ? { valueCodeableConcept: { ...(opts.valueCode ? { coding: [{ code: opts.valueCode }] } : {}), ...(opts.valueText ? { text: opts.valueText } : {}) } } : {}),
    ...(opts.interpretation ? { interpretation: [{ coding: [{ code: opts.interpretation }] }] } : {}),
    ...(opts.effective ? { effectiveDateTime: opts.effective } : {}),
  };
}

const observations = [
  // Organism-identification (code_code 634-6) isolates.
  obs('obs-org1', { subject: 'Patient/pt-07', specimen: 'Specimen/amr-sp1', codeCode: '634-6', valueCode: 'ECOLI', valueText: 'Escherichia coli', effective: '2026-05-02T00:00:00Z' }),
  obs('obs-org1b', { subject: 'Patient/pt-07', specimen: 'Specimen/amr-sp1', codeCode: '634-6', valueCode: 'ECOLI', valueText: 'Escherichia coli', effective: '2026-04-20T00:00:00Z' }), // duplicate isolate key, EARLIER -> dedup must keep this one
  obs('obs-org2', { subject: 'Patient/pt-08', specimen: 'Specimen/amr-sp2', codeCode: '634-6', valueCode: 'KPNEU', valueText: 'Klebsiella pneumoniae', effective: '2026-05-11T00:00:00Z' }),
  obs('obs-org3', { subject: 'Patient/pt-09', specimen: 'Specimen/amr-sp3', codeCode: '634-6', valueCode: 'SAUREUS', valueText: 'Staphylococcus aureus' }), // dateless (no effective, specimen also dateless) -> retained
  obs('obs-org4', { subject: 'Patient/pt-10', specimen: 'Specimen/amr-sp1', codeCode: '634-6', valueCode: 'ECOLI', valueText: 'Escherichia coli', effective: '2026-05-05T00:00:00Z' }), // shares amr-sp1 with pt-07's isolate
  // Specimen-scoped AST results (also carry subject/effective so amr-resistance/amr-facility-summary can see them).
  obs('obs-ast-sp1-1', { subject: 'Patient/pt-07', specimen: 'Specimen/amr-sp1', codeText: 'Ciprofloxacin', interpretation: 'R', effective: '2026-05-02T00:00:00Z' }),
  obs('obs-ast-sp1-2', { subject: 'Patient/pt-07', specimen: 'Specimen/amr-sp1', codeText: 'Gentamicin', interpretation: 'S', effective: '2026-05-02T00:00:00Z' }),
  obs('obs-ast-sp2-1', { subject: 'Patient/pt-08', specimen: 'Specimen/amr-sp2', codeText: 'Ampicillin', interpretation: 'I', effective: '2026-05-11T00:00:00Z' }),
  obs('obs-ast-sp3-1', { subject: 'Patient/pt-09', specimen: 'Specimen/amr-sp3', codeText: 'Ceftriaxone', interpretation: 'S' }), // dateless -> excluded from amr-resistance/amr-facility-summary's date filter, but NOT from glass-ris/first-isolate/antibiogram (no date filter on ast_obs there)
  // Non-specimen-scoped AST results (only feed amr-resistance / amr-facility-summary).
  obs('obs-extra-1', { subject: 'Patient/pt-01', codeText: 'Ampicillin', interpretation: 'R', effective: '2026-06-01T00:00:00Z' }),
  obs('obs-extra-2', { subject: 'Patient/pt-01', codeText: 'Ampicillin', interpretation: 'S', effective: '2026-06-05T00:00:00Z' }),
  obs('obs-extra-3', { subject: 'Patient/pt-03', codeText: 'Gentamicin', interpretation: 'I', effective: '2026-06-10T00:00:00Z' }),
  obs('obs-extra-4', { subject: 'Patient/pt-04', interpretation: 'R', effective: '2026-06-15T00:00:00Z' }), // code_text null -> '(unknown)'
];

// ── Fixed param bag — superset of every SEED_QUERIES param, so every query's declared
// {{param.x}} tokens resolve regardless of which params it actually declares. ──
const PARAM_BAG: Record<string, unknown> = {
  from: '2026-01-01',
  to: '2026-12-31',
  facility: '',
  asOf: '',
  country: '',
  year: '',
};

// ── Normalization: round numbers (incl. numeric strings, and the antibiogram's embedded
// "<pct>% (<n>)" cell format) to 3dp, then sort rows by a stable full-row stringification. ──
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
const CELL_RE = /^(-?\d+(?:\.\d+)?)% \((\d+)\)$/;
const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;
function normalizeValue(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? round3(v) : v;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    const cell = trimmed.match(CELL_RE);
    if (cell) {
      const pct = round3(Number(cell[1]));
      return `${pct}% (${cell[2]})`;
    }
    if (trimmed !== '' && NUMERIC_RE.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return round3(n);
    }
    return v;
  }
  if (v instanceof Date) return v.toISOString();
  return v;
}
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row).sort()) out[k] = normalizeValue(row[k]);
  return out;
}
function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(normalizeRow).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

interface Diff { reason: string; pg?: unknown; mssql?: unknown; }
function firstDiff(pg: Record<string, unknown>[], mssql: Record<string, unknown>[]): Diff | null {
  if (pg.length !== mssql.length) {
    return { reason: `row count mismatch: postgres=${pg.length} mssql=${mssql.length}`, pg: pg.slice(0, 3), mssql: mssql.slice(0, 3) };
  }
  for (let i = 0; i < pg.length; i++) {
    const a = JSON.stringify(pg[i]);
    const b = JSON.stringify(mssql[i]);
    if (a !== b) return { reason: `row ${i} differs`, pg: pg[i], mssql: mssql[i] };
  }
  return null;
}

async function migrateAndClean(db: Kysely<ExternalSchema>, engine: 'postgres' | 'mssql'): Promise<void> {
  const migrator = createMigrator(db as unknown as Kysely<unknown>, externalMigrations(engine));
  const res = await migrator.migrateToLatest();
  if (res.error) throw res.error;
  for (const t of TABLES) {
    await sql.raw(`delete from ${t}`).execute(db as unknown as Kysely<unknown>);
  }
}

async function seedFixture(db: Kysely<ExternalSchema>, engine: 'postgres' | 'mssql'): Promise<void> {
  const writer = createFlatWriter(db, engine);
  const items = [...patients, ...specimens, ...serviceRequests, ...diagnosticReports, ...observations].map((resource) => ({ resource, provenance: PROV }));
  const results = await writer.writeMany(items);
  const skipped = results.filter((r) => r === 'skipped').length;
  if (skipped > 0) throw new Error(`${engine}: ${skipped} fixture item(s) were skipped by the flat writer`);
}

async function runQuery(db: Kysely<ExternalSchema>, sqlText: string): Promise<Record<string, unknown>[]> {
  const r = await sql.raw<Record<string, unknown>>(sqlText).execute(db as unknown as Kysely<unknown>);
  return r.rows;
}

async function main(): Promise<void> {
  const pgStore = createDbStore({ url: PG_URL });
  const pgDb = pgStore.db as unknown as Kysely<ExternalSchema>;
  const mssqlStore = createMssqlStore(MSSQL_CFG);
  const mssqlDb = mssqlStore.db as unknown as Kysely<ExternalSchema>;

  let failures = 0;
  try {
    console.log('[setup] migrating + cleaning postgres...');
    await migrateAndClean(pgDb, 'postgres');
    console.log('[setup] migrating + cleaning mssql...');
    await migrateAndClean(mssqlDb, 'mssql');

    console.log('[setup] seeding fixture into postgres...');
    await seedFixture(pgDb, 'postgres');
    console.log('[setup] seeding fixture into mssql...');
    await seedFixture(mssqlDb, 'mssql');

    console.log(`\n[parity] running ${SEED_QUERIES.length} report queries on both engines...\n`);
    for (const q of SEED_QUERIES) {
      const dialects: SqlDialect[] = ['postgres', 'mssql'];
      const [pgSql, msSql] = dialects.map((d) => prepareSelect(q.sql[d], q.params, PARAM_BAG).replace(/;\s*$/, ''));
      const [pgRowsRaw, msRowsRaw] = await Promise.all([runQuery(pgDb, pgSql), runQuery(mssqlDb, msSql)]);
      const pgRows = normalizeRows(pgRowsRaw);
      const msRows = normalizeRows(msRowsRaw);
      const diff = firstDiff(pgRows, msRows);
      if (diff) {
        failures++;
        console.log(`✗ ${q.id}  (postgres=${pgRowsRaw.length} rows, mssql=${msRowsRaw.length} rows)`);
        console.log(`    ${diff.reason}`);
        console.log(`    postgres: ${JSON.stringify(diff.pg)}`);
        console.log(`    mssql:    ${JSON.stringify(diff.mssql)}`);
      } else {
        console.log(`✓ ${q.id}  (${pgRows.length} rows)`);
      }
    }
  } finally {
    await pgStore.close();
    await mssqlStore.close();
  }

  console.log(failures === 0 ? '\n✅ ALL 9 report queries are cross-dialect parity-equivalent' : `\n❌ ${failures} report quer${failures === 1 ? 'y' : 'ies'} mismatched`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
