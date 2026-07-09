// Seeds a WORKING sample DHIS2 aggregate mapping + matching org-unit map so the DHIS2 settings
// page (and the workflow dhis2-push node picker) isn't empty and a dry-run actually yields values.
// Data lives in plugin_data under the dhis2-sink plugin (collections 'mappings' and 'orgUnitMaps'
// — see migration 036). Real DHIS2 dataElement/COC/orgUnit ids are discovered live from the
// seeded connector's target; the facilities are the ACTUAL ones the report emits (so the
// orgUnitMap keys match the report output and rows aren't all skipped). Idempotent.
//
//   pnpm seed:dhis2-mapping            # after pnpm seed:dhis2-connector
//
// Uses the `r-amr-facility-summary` data-driven report (wide format: one row per facility, with
// `tested` and `resistant` numeric columns) — unlike `amr-resistance` (long format, no facility
// dimension), this shape maps cleanly onto DHIS2 aggregate dataValues. The 7 hardcoded catalog
// reports (including the old `amr-facility-summary` id) were retired in favour of data-driven
// `r-<id>` report records (see docs/superpowers/plans/2026-07-09-reports-template-linking.md
// Slice S5) — this seed now goes through the full `ctx.reporting` resolver (via
// `createAppContext`) instead of calling the deleted catalog directly, so both the mapping
// record AND the facility-discovery run resolve the data-driven report. No plugin egress worker
// is spawned, so it is safe under tsx. Open Settings ▸ DHIS2 to refine the column→dataElement
// mapping if needed.
import { loadConfig } from '@openldr/config';
import { createAppContext } from '@openldr/bootstrap';
import { randomUUID } from 'node:crypto';

const PLUGIN_ID = 'dhis2-sink';
const CONNECTOR_NAME = process.env.DHIS2_CONNECTOR_NAME ?? 'DHIS2 SL Demo (local)';
const REPORT_ID = 'r-amr-facility-summary';
const MAPPING_NAME = 'AMR Resistance → DHIS2 (sample)';
const MAX_FACILITIES = 3;

async function dhis2<T>(base: string, auth: string, path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { headers: { authorization: auth } });
  if (!res.ok) throw new Error(`DHIS2 ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const ctx = await createAppContext(cfg);
  const connectors = ctx.connectors;
  const pdata = ctx.pluginData;
  try {
    const connector = (await connectors.list()).find((c) => c.name === CONNECTOR_NAME);
    if (!connector) throw new Error(`connector "${CONNECTOR_NAME}" not found — run \`pnpm seed:dhis2-connector\` first`);
    const config = await connectors.getDecryptedConfig(connector.id, cfg.SECRETS_ENCRYPTION_KEY);
    const base = config.baseUrl.replace(/\/$/, '');
    const auth = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;

    // Discover the actual facilities the report emits, so the org-unit map keys MATCH the report
    // output (otherwise every row skips with "no orgUnit mapping for facility 'X'"). Goes through
    // ctx.reporting (data-driven `r-<id>` source) rather than the retired catalog.
    const def = await ctx.reportDefs.get(REPORT_ID);
    if (!def) throw new Error(`report "${REPORT_ID}" not found`);
    const report = await ctx.reporting.run(REPORT_ID, {});
    const facilities = [...new Set(report.rows.map((r) => String((r as { facility?: unknown }).facility ?? '')).filter(Boolean))].slice(0, MAX_FACILITIES);
    if (facilities.length === 0) {
      console.warn(`⚠ report "${REPORT_ID}" produced no facilities (no AST data in the target store?) — seeding the mapping with an empty org-unit map. Ingest WHONET sample data, then re-run.`);
    }

    // Discover 2 aggregate numeric dataElements (+ each one's default category-option-combo) for
    // the `tested` and `resistant` columns.
    const { dataElements } = await dhis2<{ dataElements: { id: string; name: string; categoryCombo: { id: string } }[] }>(
      base, auth,
      '/api/dataElements.json?filter=domainType:eq:AGGREGATE&filter=valueType:in:[INTEGER,NUMBER,INTEGER_POSITIVE,INTEGER_ZERO_OR_POSITIVE]&fields=id,name,categoryCombo[id]&paging=true&pageSize=2',
    );
    if (dataElements.length < 2) throw new Error('need 2 aggregate numeric dataElements on the target');
    const cocFor = async (ccId: string): Promise<string> =>
      (await dhis2<{ categoryOptionCombos: { id: string }[] }>(base, auth, `/api/categoryCombos/${ccId}.json?fields=categoryOptionCombos[id]`)).categoryOptionCombos[0].id;
    // Column names MUST match the report's output keys (`tested`, `resistant`).
    const columns = [
      { column: 'tested', dataElement: dataElements[0].id, categoryOptionCombo: await cocFor(dataElements[0].categoryCombo.id) },
      { column: 'resistant', dataElement: dataElements[1].id, categoryOptionCombo: await cocFor(dataElements[1].categoryCombo.id) },
    ];

    // Discover enough leaf org units to map each discovered facility to a real DHIS2 org unit.
    const { organisationUnits } = await dhis2<{ organisationUnits: { id: string; name: string }[] }>(
      base, auth, `/api/organisationUnits.json?filter=level:eq:4&fields=id,name&paging=true&pageSize=${Math.max(facilities.length, 1)}`,
    );

    // Aggregate mapping — idempotent by name (reuse the existing id so a re-run updates in place).
    const existing = (await pdata.list(PLUGIN_ID, 'mappings')).find((e) => (e.doc as { name?: string })?.name === MAPPING_NAME);
    const mappingId = existing ? (existing.doc as { id: string }).id : randomUUID();
    const definition = {
      kind: 'aggregate', id: mappingId, name: MAPPING_NAME,
      source: { kind: 'report', reportId: REPORT_ID },
      orgUnitColumn: 'facility', columns, connectorId: connector.id,
    };
    await pdata.put(PLUGIN_ID, 'mappings', mappingId, { id: mappingId, name: MAPPING_NAME, definition });

    // Org-unit map — REAL report facilities → real DHIS2 leaf org units (keyed by the facility id
    // the report emits, so a dry-run resolves them instead of skipping).
    const mapped: string[] = [];
    for (let i = 0; i < facilities.length && i < organisationUnits.length; i++) {
      const ou = organisationUnits[i];
      await pdata.put(PLUGIN_ID, 'orgUnitMaps', facilities[i], { facilityId: facilities[i], orgUnitId: ou.id, orgUnitName: ou.name });
      mapped.push(`${facilities[i]}→${ou.name}`);
    }

    console.log(`✓ Aggregate mapping "${MAPPING_NAME}" (${mappingId})`);
    console.log(`    report=${REPORT_ID}, connector=${connector.name}`);
    console.log(`    columns: ${columns.map((c) => `${c.column}→${c.dataElement}/${c.categoryOptionCombo}`).join(', ')}`);
    console.log(`✓ Org-unit map: ${mapped.length} facilities mapped${mapped.length ? ` → ${mapped.join(', ')}` : ''}`);
    console.log('\nOpen Settings ▸ DHIS2 and run the mapping (dry-run) — it should now produce dataValues.');
  } finally {
    await ctx.close();
  }
}

main().catch((e) => { console.error(`seed failed: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
