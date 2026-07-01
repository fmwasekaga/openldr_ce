/**
 * AMR Ndola report — LIVE integration harness.
 *
 * Drives the REAL runWorkflow graph executor end-to-end against a live Postgres
 * (localhost:5433 / db `amr_fixture`), using the real connector DB path for the
 * two extract SELECTs. Dataset store, blob store, secret and email are faithful
 * in-memory/captured stand-ins so we can inspect the produced attachment.
 *
 * Prereq: `docker exec openldr_ce-postgres-1 psql -U openldr -d openldr -c "CREATE DATABASE amr_fixture;"`
 * Run:    pnpm tsx scripts/amr-report-integration.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import XlsxPopulate from 'xlsx-populate';
import { runWorkflow } from '../packages/workflows/src/engine/run-workflow';
import { createConnectorDb } from '../packages/bootstrap/src/connector-db';
import { AMR_ANTIBIOTICS, AMR_TEMPLATE_COLUMNS } from '../packages/workflows/src/reports/amr-columns';
import type { WorkflowServices } from '../packages/workflows/src/engine/services';

const OUT = process.env.CLAUDE_SCRATCHPAD || join(process.cwd(), 'scratchpad');
mkdirSync(OUT, { recursive: true });

const PG = { host: 'localhost', port: '5433', user: 'openldr', password: 'openldr', database: 'amr_fixture' };

const ISOLATES_SQL = `SELECT r.requestid,
       l.limsrptresult          AS organism,
       r.limspanelcode          AS "cultureTestCode",
       r.limspaneldesc          AS "CultureTestDescription",
       l.limsrptresult          AS "LIMSRptResult",
       r.requestid              AS "RequestID",
       r.limsspecimensourcecode AS "LIMSSpecimenSourceCode",
       CASE r.limspanelcode WHEN 'CULPU' THEN 'Pus' WHEN 'CULUR' THEN 'Urine'
            WHEN 'CULBC' THEN 'Blood' ELSE r.limsspecimensourcedesc END AS "LIMSSpecimenSourceDesc",
       p.firstname AS "FIRSTNAME", p.surname AS "LastName", p.ageinyears AS "AgeInYears",
       p.dob AS "DOB", r.hl7sexcode AS sex, p.ward AS "LocationCode",
       r.limspointofcaredesc AS "Location", r.registereddatetime AS "AccessionDate",
       r.specimendatetime AS "SpecimenDate", r.limspanelcode AS "AST_TestCode",
       r.limspaneldesc AS "AST_Test", l.limsrptresult AS "ORGANISM"
FROM requests r
JOIN labresults l ON r.requestid = l.requestid AND r.obrsetid = l.obrsetid
JOIN patients p ON r.requestid = p.requestid
WHERE (r.limspaneldesc ILIKE '%cult%' OR r.limspaneldesc ILIKE '%microbiology%')
  AND l.limsobservationcode LIKE 'ORGS%'
  AND r.testingfacilitycode = 'ZNP'
  AND r.authoriseddatetime IS NOT NULL
  AND r.registereddatetime >= '{{ $json.periodStart }}' AND r.registereddatetime < '{{ $json.periodEnd }}'`;

const AST_LONG_SQL = `SELECT r.requestid, a.organism AS organism,
       a.limssubstancename AS "LIMSSubstanceName", a.astvalue AS "ASTValue"
FROM astresults a
JOIN requests r ON a.requestid = r.requestid AND a.obrsetid = r.obrsetid
WHERE r.limspaneldesc ILIKE '%sens%'
  AND r.testingfacilitycode = 'ZNP'
  AND r.authoriseddatetime IS NOT NULL
  AND r.registereddatetime >= '{{ $json.periodStart }}' AND r.registereddatetime < '{{ $json.periodEnd }}'`;

// ── One statement per array element (extended protocol = single statement each) ──
const SEED = [
  `DROP TABLE IF EXISTS requests, labresults, patients, astresults`,
  `CREATE TABLE requests (requestid text, obrsetid text, limspanelcode text, limspaneldesc text,
     limsspecimensourcecode text, limsspecimensourcedesc text, limspointofcaredesc text,
     testingfacilitycode text, hl7sexcode text, registereddatetime timestamp,
     specimendatetime timestamp, authoriseddatetime timestamp)`,
  `CREATE TABLE labresults (requestid text, obrsetid text, limsobservationcode text, limsrptresult text)`,
  `CREATE TABLE patients (requestid text, firstname text, surname text, ageinyears int, dob date, ward text)`,
  `CREATE TABLE astresults (requestid text, obrsetid text, organism text, limssubstancename text, astvalue text)`,
  `INSERT INTO requests VALUES ('R1','1','CULUR','Urine Culture','UR','Urine','OPD','ZNP','F','2026-06-01','2026-06-01','2026-06-03')`,
  `INSERT INTO requests VALUES ('R1','2','SENS','Sensitivity Testing','UR','Urine','OPD','ZNP','F','2026-06-01','2026-06-01','2026-06-03')`,
  `INSERT INTO labresults VALUES ('R1','1','ORGS','E.coli')`,
  `INSERT INTO patients VALUES ('R1','Jane','Doe',34,'1992-01-01','Ward 1')`,
  `INSERT INTO astresults VALUES ('R1','2','E.coli','Amikacin','S')`,
  `INSERT INTO astresults VALUES ('R1','2','E.coli','Ampicillin','R')`,
];

async function seed() {
  const db = createConnectorDb('postgres', PG);
  try { for (const stmt of SEED) await db.query(stmt); }
  finally { await db.close(); }
  console.log(`seeded amr_fixture (${SEED.length} statements)`);
}

// ── Faithful in-memory services; runConnectorSql hits LIVE Postgres ──
const datasets = new Map<string, { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>();
const blobs = new Map<string, Uint8Array>();
let blobN = 0;
let capturedEmail: any = null;

const services: WorkflowServices = {
  runConnectorSql: async ({ sql }) => {
    const db = createConnectorDb('postgres', PG);
    try { const r = await db.query(sql); return { columns: [], rows: r.rows }; }
    finally { await db.close(); }
  },
  materializeDataset: async (name, columns, rows) => { datasets.set(name, { columns, rows }); return { dataset: name, rowCount: rows.length }; },
  loadDataset: async (name) => datasets.get(name) ?? { columns: [], rows: [] },
  writeBinary: async ({ bytes, fileName, contentType }) => { const objectKey = `blob-${blobN++}`; blobs.set(objectKey, bytes); return { objectKey, contentType, fileName, byteSize: bytes.byteLength }; },
  readBinary: async (objectKey) => { const b = blobs.get(objectKey); if (!b) throw new Error(`blob ${objectKey} not found`); return b; },
  resolveSecret: async ({ key }) => (key === 'amr_report_pw' ? 'Micro!' : undefined),
  runConnectorEmail: async (input) => { capturedEmail = input; return { messageId: 'test-msg', accepted: [input.to], rejected: [] }; },
} as unknown as WorkflowServices;

const n = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (source: string, target: string) => ({ id: `${source}->${target}`, source, target });

function printRun(label: string, res: any) {
  console.log(`\n── ${label}: status=${res.status} ──`);
  for (const nr of res.nodes ?? res.results ?? []) {
    const tag = nr.status === 'failed' ? 'FAIL' : nr.status;
    console.log(`   [${tag}] ${nr.nodeId} (${nr.type})${nr.error ? ' — ' + nr.error : ''}`);
  }
}

async function main() {
  await seed();

  // ── Workflow 1: Materialize ──
  const mNodes = [
    n('trigger', 'trigger', { triggerType: 'schedule', config: {} }),
    n('dates', 'action', { action: 'set', config: { keepExisting: true, fields: [
      { name: 'periodStart', value: '2026-06-01' }, { name: 'periodEnd', value: '2026-07-01' },
    ] } }),
    n('isolates', 'action', { action: 'postgres', config: { connectorId: 'src', sql: ISOLATES_SQL } }),
    n('ast_long', 'action', { action: 'postgres', config: { connectorId: 'src', sql: AST_LONG_SQL } }),
    n('pivot', 'action', { action: 'pivot', config: { groupBy: ['requestid', 'organism'], pivotColumn: 'LIMSSubstanceName', valueColumn: 'ASTValue', columns: [...AMR_ANTIBIOTICS], aggregate: 'max' } }),
    n('join', 'action', { action: 'merge', config: { mode: 'combineByKey', joinKeys: ['requestid', 'organism'], joinType: 'left' } }),
    n('materialize', 'action', { action: 'materialize-dataset', config: { datasetName: 'amr_ndola_monthly' } }),
  ];
  const mEdges = [
    e('trigger', 'dates'), e('dates', 'isolates'), e('dates', 'ast_long'),
    e('ast_long', 'pivot'), e('isolates', 'join'), e('pivot', 'join'), e('join', 'materialize'),
  ];
  const mRes = await runWorkflow(mNodes as any, mEdges as any, { services });
  printRun('MATERIALIZE', mRes);
  const ds = datasets.get('amr_ndola_monthly');
  console.log(`   dataset rows: ${ds?.rows.length ?? 0}`);
  if (ds?.rows.length) {
    const row = ds.rows[0];
    console.log(`   row[0]: requestid=${row.requestid} organism=${row.organism} Amikacin=${row.Amikacin} Ampicillin=${row.Ampicillin}`);
  }

  // ── Pre-seed the branded template blob ──
  const tpl = await XlsxPopulate.fromBlankAsync();
  AMR_TEMPLATE_COLUMNS.forEach((h, i) => tpl.sheet(0).cell(1, i + 1).value(h));
  const tplBytes = new Uint8Array((await tpl.outputAsync()) as ArrayBuffer);
  const tplRef = await services.writeBinary!({ bytes: tplBytes, fileName: 'AMR_temp.xlsx', contentType: 'app/xlsx' });

  // ── Workflow 2: Report & email ──
  const rNodes = [
    n('trigger', 'trigger', { triggerType: 'schedule', config: {} }),
    n('load', 'action', { action: 'load-dataset', config: { datasetName: 'amr_ndola_monthly' } }),
    n('xlsx', 'action', { action: 'excel-template', config: {
      templateRef: tplRef.objectKey, startCell: 'A2', columns: [...AMR_TEMPLATE_COLUMNS], autoFilter: 'A1',
      fileName: 'NTH_AMR_LastMonth.xlsx', binaryField: 'file', password: { connectorId: 'pw', key: 'amr_report_pw' },
    } }),
    n('email', 'action', { action: 'send-email', config: {
      connectorId: 'smtp', to: 'elijahchinyante@outlook.com', cc: 'chizimuyjoseph@yahoo.com',
      subject: 'Ndola AMR Report', body: 'Please find attached.', attachBinaryField: 'file',
    } }),
  ];
  const rEdges = [e('trigger', 'load'), e('load', 'xlsx'), e('xlsx', 'email')];
  const rRes = await runWorkflow(rNodes as any, rEdges as any, { services });
  printRun('REPORT', rRes);

  // ── Inspect the captured email + attachment ──
  console.log('\n── EMAIL CAPTURE ──');
  if (!capturedEmail) { console.error('   NO EMAIL CAPTURED'); process.exit(1); }
  console.log(`   to=${capturedEmail.to} cc=${capturedEmail.cc} subject="${capturedEmail.subject}"`);
  const att = capturedEmail.attachments?.[0];
  if (!att) { console.error('   NO ATTACHMENT'); process.exit(1); }
  const outPath = join(OUT, att.filename);
  writeFileSync(outPath, Buffer.from(att.content));
  console.log(`   attachment: ${att.filename} (${att.content.length} bytes) → ${outPath}`);

  // ── Open the produced xlsx WITH the password and verify the data landed ──
  await XlsxPopulate.fromDataAsync(Buffer.from(att.content)).then(
    () => { console.error('   SECURITY FAIL: opened WITHOUT password'); process.exit(1); },
    () => console.log('   ✓ rejects open without password (encrypted)'),
  );
  const wb = await XlsxPopulate.fromDataAsync(Buffer.from(att.content), { password: 'Micro!' });
  const a1 = wb.sheet(0).cell('A1').value();
  const a2 = wb.sheet(0).cell('A2').value();
  const amikacinCol = AMR_TEMPLATE_COLUMNS.indexOf('Amikacin') + 1;
  const amikacin = wb.sheet(0).cell(2, amikacinCol).value();
  console.log(`   ✓ opens with password. A1(header)=${a1} A2(data)=${a2} Amikacin(row2)=${amikacin}`);

  const ok = mRes.status !== 'failed' && rRes.status !== 'failed' && ds?.rows.length === 1 && a2 === 'CULUR' && amikacin === 'S';
  console.log(`\n${ok ? 'PASS ✅ full live pipeline' : 'FAIL ❌ see above'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error('HARNESS ERROR:', err); process.exit(1); });
