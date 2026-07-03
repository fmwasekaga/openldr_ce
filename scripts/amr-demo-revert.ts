/**
 * Tear down the AMR Ndola demo: remove the two demo workflows and the three demo
 * connectors ("AMR Fixture (Postgres)", "AMR Report Password", "Gmail (me)") from the
 * app's internal DB, leaving the default seeded workflows/connectors intact. Idempotent.
 *
 * (The amr_fixture Postgres database is dropped separately — see the run notes.)
 * Run: pnpm tsx scripts/amr-demo-revert.ts
 */
import { readFileSync } from 'node:fs';
import { createInternalDb, createConnectorStore } from '@openldr/db';
import { createWorkflowStore } from '@openldr/workflows';

function envVal(name: string): string | undefined {
  try {
    const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith(name + '='));
    return line ? line.slice(name.length + 1).trim() : undefined;
  } catch { return undefined; }
}

const URL = process.env.INTERNAL_DATABASE_URL || envVal('INTERNAL_DATABASE_URL') || 'postgres://openldr:openldr@localhost:5433/openldr';

const CONNECTORS = ['AMR Fixture (Postgres)', 'AMR Report Password', 'Gmail (me)'];
const WORKFLOW_MATCH = 'AMR Ndola';

async function main() {
  const internal = createInternalDb(URL);
  const connectors = createConnectorStore(internal.db as any);
  const workflows = createWorkflowStore(internal.db as any);
  try {
    for (const w of await workflows.list()) {
      if (w.name.includes(WORKFLOW_MATCH)) { await workflows.remove(w.id); console.log(`removed workflow "${w.name}"`); }
    }
    for (const c of await connectors.list()) {
      if (CONNECTORS.includes(c.name)) { await connectors.remove(c.id); console.log(`removed connector "${c.name}"`); }
    }
    console.log('\nAMR demo removed from the app DB. Remaining:');
    console.log('  workflows:', (await workflows.list()).map((w) => w.name).join(' | ') || '(none)');
    console.log('  connectors:', (await connectors.list()).map((c) => c.name).join(' | ') || '(none)');
  } finally {
    await (internal.db as any).destroy?.();
  }
}
main().catch((e) => { console.error('REVERT ERROR:', e); process.exit(1); });
