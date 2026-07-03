/**
 * Finish making the AMR Report workflow runnable in the app:
 *   1. Create a "secret" connector holding the xlsx password under key `amr_report_pw`
 *      and point the Report workflow's excel-template node at it.
 *   2. Generate a header-only template .xlsx (AMR_TEMPLATE_COLUMNS) to upload in the
 *      builder in place of the lost temp/AMR_temp.xlsx.
 * Run from repo root: pnpm tsx <scratchpad>/wire-amr-extras.ts
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import XlsxPopulate from 'xlsx-populate';
import { createInternalDb, createConnectorStore } from '@openldr/db';
import { createWorkflowStore } from '@openldr/workflows';
import { AMR_TEMPLATE_COLUMNS } from '../packages/workflows/src/reports/amr-columns';

function envVal(name: string): string | undefined {
  try {
    const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith(name + '='));
    return line ? line.slice(name.length + 1).trim() : undefined;
  } catch { return undefined; }
}

const OUT = process.env.CLAUDE_SCRATCHPAD || join(process.cwd(), 'scratchpad');
const URL = process.env.INTERNAL_DATABASE_URL || envVal('INTERNAL_DATABASE_URL') || 'postgres://openldr:openldr@localhost:5433/openldr';
const KEY = process.env.SECRETS_ENCRYPTION_KEY || envVal('SECRETS_ENCRYPTION_KEY');
const PW = process.env.AMR_REPORT_PW || 'Micro!';
const CONNECTOR_NAME = 'AMR Report Password';

async function main() {
  if (!KEY) throw new Error('SECRETS_ENCRYPTION_KEY not found (env or .env)');
  const internal = createInternalDb(URL);
  const connectors = createConnectorStore(internal.db as any);
  const workflows = createWorkflowStore(internal.db as any);
  try {
    // 1) secret connector holding the report password
    let cid: string;
    const prior = (await connectors.list()).find((c) => c.name === CONNECTOR_NAME);
    if (prior) { cid = prior.id; await connectors.update(cid, { config: { amr_report_pw: PW }, enabled: true }, KEY); console.log(`updated connector "${CONNECTOR_NAME}" (${cid})`); }
    else { cid = randomUUID(); await connectors.create({ id: cid, name: CONNECTOR_NAME, type: 'secret', kind: 'secret', config: { amr_report_pw: PW } }, KEY); console.log(`created connector "${CONNECTOR_NAME}" (${cid})`); }

    // 2) point the Report workflow's excel-template password at it
    const rep = (await workflows.list()).find((w) => w.name.includes('Report'));
    if (!rep) throw new Error('Report workflow not found — run install-amr-workflows.ts first');
    const def = rep.definition as { nodes: any[]; edges: any[] };
    let patched = 0;
    for (const n of def.nodes) {
      if (/excel-template/.test(JSON.stringify(n.data))) {
        n.data.config = { ...(n.data.config ?? {}), password: { connectorId: cid, key: 'amr_report_pw' } };
        patched += 1;
      }
    }
    await workflows.update(rep.id, { ...rep, definition: def } as any);
    console.log(`pointed ${patched} excel-template node(s) at the password connector on "${rep.name}"`);

    // 3) header-only template to upload in the builder
    const tpl = await XlsxPopulate.fromBlankAsync();
    AMR_TEMPLATE_COLUMNS.forEach((h, i) => tpl.sheet(0).cell(1, i + 1).value(h));
    const outPath = join(OUT, 'AMR_temp.xlsx');
    writeFileSync(outPath, Buffer.from((await tpl.outputAsync()) as ArrayBuffer));
    console.log(`wrote template (${AMR_TEMPLATE_COLUMNS.length} columns) → ${outPath}`);
    console.log('\nUpload that file to the excel-template node in the builder (sets templateRef), then Run.');
  } finally {
    await (internal.db as any).destroy?.();
  }
}
main().catch((e) => { console.error('WIRE ERROR:', e); process.exit(1); });
