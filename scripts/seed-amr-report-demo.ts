/**
 * AMR Ndola report demo generator.
 *
 * Reproduces the Zambia `sp_Ndola_ast_data_month` pm2 job (temp/app.js) as two
 * importable Workflow Builder graphs plus a portable SQL fixture:
 *
 *   1. amr-materialize.workflow.json  — schedule → date-bounds → two portable
 *      SELECTs → pivot (antibiotics long→wide) → combineByKey join → materialize
 *      the "amr_ndola_monthly" dataset.
 *   2. amr-report.workflow.json       — schedule → load-dataset → excel-template
 *      (fill AMR_temp.xlsx + autofilter + secret password) → send-email attachment.
 *   3. amr-fixture.sql                — DDL + a few sample rows + the two extract
 *      queries, to run against whatever DB the connector points at (Postgres shown;
 *      MSSQL notes inline). No live DB is contacted by this script.
 *
 * Run: pnpm tsx scripts/seed-amr-report-demo.ts
 * Output: written under the scratchpad dir (or ./scratchpad fallback).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AMR_ANTIBIOTICS, AMR_TEMPLATE_COLUMNS } from '../packages/workflows/src/reports/amr-columns';

const OUT_DIR = process.env.CLAUDE_SCRATCHPAD || join(process.cwd(), 'scratchpad');
mkdirSync(OUT_DIR, { recursive: true });

const DATASET = 'amr_ndola_monthly';
const FACILITY = 'ZNP';

// ── Portable extract SQL (Postgres dialect; the connector's type drives the real
//    dialect). Date bounds are injected from the `set` node via the SQL template
//    engine ({{ $json.periodStart }} / {{ $json.periodEnd }}). MSSQL note: replace
//    ILIKE with LIKE under a case-insensitive collation. ──
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
  AND r.testingfacilitycode = '${FACILITY}'
  AND r.authoriseddatetime IS NOT NULL
  AND r.registereddatetime >= '{{ $json.periodStart }}' AND r.registereddatetime < '{{ $json.periodEnd }}'`;

const AST_LONG_SQL = `SELECT r.requestid, a.organism AS organism,
       a.limssubstancename AS "LIMSSubstanceName", a.astvalue AS "ASTValue"
FROM astresults a
JOIN requests r ON a.requestid = r.requestid AND a.obrsetid = r.obrsetid
WHERE r.limspaneldesc ILIKE '%sens%'
  AND r.testingfacilitycode = '${FACILITY}'
  AND r.authoriseddatetime IS NOT NULL
  AND r.registereddatetime >= '{{ $json.periodStart }}' AND r.registereddatetime < '{{ $json.periodEnd }}'`;

const node = (id: string, type: string, x: number, y: number, data: Record<string, unknown>) => ({
  id, type, position: { x, y }, data,
});
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}->${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}),
});

// ── Workflow 1: Materialize ──
const materialize = {
  name: 'AMR Ndola — Materialize (monthly)',
  description: 'Portable extract → pivot antibiotics → join isolates → materialize amr_ndola_monthly.',
  nodes: [
    node('trigger', 'trigger', 40, 240, { label: 'Monthly', triggerType: 'schedule', templateId: 'schedule-trigger', iconName: 'Clock', config: { cron: '0 20 10 5 * *' } }),
    node('dates', 'action', 220, 240, { label: 'Last-month bounds', action: 'set', templateId: 'set', iconName: 'Pencil', config: { keepExisting: true, fields: [
      { name: 'periodStart', value: '2026-06-01' },
      { name: 'periodEnd', value: '2026-07-01' },
    ] } }),
    node('isolates', 'action', 420, 140, { label: 'Isolates', action: 'microsoft-sql', templateId: 'microsoft-sql', iconName: 'Database', config: { connectorId: '', sql: ISOLATES_SQL } }),
    node('ast_long', 'action', 420, 360, { label: 'AST (long)', action: 'microsoft-sql', templateId: 'microsoft-sql', iconName: 'Database', config: { connectorId: '', sql: AST_LONG_SQL } }),
    node('pivot', 'action', 620, 360, { label: 'Pivot antibiotics', action: 'pivot', templateId: 'pivot', iconName: 'Table2', config: {
      groupBy: ['requestid', 'organism'], pivotColumn: 'LIMSSubstanceName', valueColumn: 'ASTValue',
      columns: [...AMR_ANTIBIOTICS], carry: [], aggregate: 'max',
    } }),
    node('join', 'action', 820, 240, { label: 'Join isolates+AST', action: 'merge', templateId: 'merge', iconName: 'Combine', config: { mode: 'combineByKey', joinKeys: ['requestid', 'organism'], joinType: 'left' } }),
    node('materialize', 'action', 1020, 240, { label: 'Materialize', action: 'materialize-dataset', templateId: 'materialize-dataset', iconName: 'Save', config: { datasetName: DATASET } }),
  ],
  // NOTE: isolates→join edge is listed FIRST so the join treats isolates as the LEFT branch.
  edges: [
    edge('trigger', 'dates'),
    edge('dates', 'isolates'),
    edge('dates', 'ast_long'),
    edge('ast_long', 'pivot'),
    edge('isolates', 'join'),
    edge('pivot', 'join'),
    edge('join', 'materialize'),
  ],
};

// ── Workflow 2: Report & email ──
const report = {
  name: 'AMR Ndola — Report & email (monthly)',
  description: 'Load amr_ndola_monthly → fill AMR_temp.xlsx (autofilter + password) → email attachment.',
  nodes: [
    node('trigger', 'trigger', 40, 200, { label: 'Monthly', triggerType: 'schedule', templateId: 'schedule-trigger', iconName: 'Clock', config: { cron: '0 40 10 5 * *' } }),
    node('load', 'action', 240, 200, { label: 'Load dataset', action: 'load-dataset', templateId: 'load-dataset', iconName: 'Database', config: { datasetName: DATASET } }),
    node('xlsx', 'action', 440, 200, { label: 'Fill AMR template', action: 'excel-template', templateId: 'excel-template', iconName: 'Sheet', config: {
      templateRef: '', sheetIndex: 0, startCell: 'A2', columns: [...AMR_TEMPLATE_COLUMNS], autoFilter: 'A1',
      fileName: 'NTH_AMR_LastMonth_{{ $now.format("yyyyMMdd") }}.xlsx', binaryField: 'file',
      password: { connectorId: '', key: 'amr_report_pw' },
    } }),
    node('email', 'action', 640, 200, { label: 'Email report', action: 'send-email', templateId: 'send-email', iconName: 'AtSign', config: {
      connectorId: '', to: 'elijahchinyante@outlook.com', cc: 'chizimuyjoseph@yahoo.com,clmusyani@yahoo.com',
      subject: 'Ndola Teaching Hospital Antimicrobial Sensitivity Testing Report for Last Month',
      body: 'Please find the Ndola Teaching Hospital Antimicrobial Sensitivity Testing Report for last Month attached.',
      html: false, attachBinaryField: 'file',
    } }),
  ],
  edges: [
    edge('trigger', 'load'),
    edge('load', 'xlsx'),
    edge('xlsx', 'email'),
  ],
};

// ── Fixture SQL (DDL + a couple of sample rows + the two extract queries) ──
const FIXTURE_SQL = `-- AMR Ndola fixture (Postgres). Apply to the DB your connector points at.
-- Minimal columns for the two portable extract SELECTs. MSSQL: swap ILIKE→LIKE.
CREATE TABLE IF NOT EXISTS requests (
  requestid text, obrsetid text, limspanelcode text, limspaneldesc text,
  limsspecimensourcecode text, limsspecimensourcedesc text, limspointofcaredesc text,
  testingfacilitycode text, hl7sexcode text, registereddatetime timestamp,
  specimendatetime timestamp, authoriseddatetime timestamp
);
CREATE TABLE IF NOT EXISTS labresults (
  requestid text, obrsetid text, limsobservationcode text, limsrptresult text
);
CREATE TABLE IF NOT EXISTS patients (
  requestid text, firstname text, surname text, ageinyears int, dob date, ward text
);
CREATE TABLE IF NOT EXISTS astresults (
  requestid text, obrsetid text, organism text, limssubstancename text, astvalue text
);

INSERT INTO requests VALUES
  ('R1','1','CULUR','Urine Culture','UR','Urine','OPD','${FACILITY}','F','2026-06-02','2026-06-01','2026-06-03'),
  ('R1','1','SENS','Sensitivity Testing','UR','Urine','OPD','${FACILITY}','F','2026-06-02','2026-06-01','2026-06-03');
INSERT INTO labresults VALUES ('R1','1','ORGS','E.coli');
INSERT INTO patients VALUES ('R1','Jane','Doe',34,'1992-01-01','Ward 1');
INSERT INTO astresults VALUES
  ('R1','1','E.coli','Amikacin','S'),
  ('R1','1','E.coli','Ampicillin','R');

-- Extract 1 (isolates) — paste into the "Isolates" DB node:
${ISOLATES_SQL};

-- Extract 2 (AST long) — paste into the "AST (long)" DB node:
${AST_LONG_SQL};
`;

writeFileSync(join(OUT_DIR, 'amr-materialize.workflow.json'), JSON.stringify(materialize, null, 2));
writeFileSync(join(OUT_DIR, 'amr-report.workflow.json'), JSON.stringify(report, null, 2));
writeFileSync(join(OUT_DIR, 'amr-fixture.sql'), FIXTURE_SQL);

console.log(`AMR report demo written to ${OUT_DIR}:`);
console.log('  - amr-materialize.workflow.json  (import into Workflow Builder)');
console.log('  - amr-report.workflow.json       (import into Workflow Builder)');
console.log('  - amr-fixture.sql                (apply to the connector target DB)');
console.log(`Pivot columns: ${AMR_ANTIBIOTICS.length} antibiotics; template columns: ${AMR_TEMPLATE_COLUMNS.length}.`);
console.log('\nNext (manual, in your environment):');
console.log('  1. Create connectors: the source DB (microsoft-sql/postgres), an SMTP email connector,');
console.log("     and a connector holding the report password under key 'amr_report_pw'.");
console.log('  2. Import both workflows; set connectorId on the DB / email / password fields.');
console.log('  3. Upload temp/AMR_temp.xlsx as the excel-template artifact; paste its object key into templateRef.');
console.log('  4. Run Materialize, then Report; confirm a password-protected .xlsx is emailed.');
