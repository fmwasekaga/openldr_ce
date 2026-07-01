/**
 * Create a Postgres connector pointing at the seeded amr_fixture DB and attach it
 * to the Materialize workflow's two DB nodes (switching them to Postgres nodes),
 * so the workflow is runnable from the builder. Idempotent.
 *
 * Run: pnpm tsx scripts/wire-amr-postgres-connector.ts
 */
import { randomUUID } from 'node:crypto';
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
const KEY = process.env.SECRETS_ENCRYPTION_KEY || envVal('SECRETS_ENCRYPTION_KEY');

const CONNECTOR_NAME = 'AMR Fixture (Postgres)';
// host/port as seen by the workflow RUNTIME. Host dev server (`pnpm dev`) → localhost:5433.
// If the app runs INSIDE docker-compose, change host→'postgres', port→'5432'.
const PG_CONFIG: Record<string, string> = { host: 'localhost', port: '5433', user: 'openldr', password: 'openldr', database: 'amr_fixture', ssl: 'false' };

async function main() {
  if (!KEY) throw new Error('SECRETS_ENCRYPTION_KEY not found (env or .env)');
  const internal = createInternalDb(URL);
  const connectors = createConnectorStore(internal.db as any);
  const workflows = createWorkflowStore(internal.db as any);
  try {
    // 1) connector
    let cid: string;
    const prior = (await connectors.list()).find((c) => c.name === CONNECTOR_NAME);
    if (prior) { cid = prior.id; await connectors.update(cid, { config: PG_CONFIG, enabled: true }, KEY); console.log(`updated connector "${CONNECTOR_NAME}" (${cid})`); }
    else { cid = randomUUID(); await connectors.create({ id: cid, name: CONNECTOR_NAME, type: 'postgres', kind: 'database', config: PG_CONFIG }, KEY); console.log(`created connector "${CONNECTOR_NAME}" (${cid})`); }

    // 2) attach to the Materialize workflow's DB nodes
    const mat = (await workflows.list()).find((w) => w.name.includes('Materialize'));
    if (!mat) throw new Error('Materialize workflow not found — run install-amr-workflows.ts first');
    const def = mat.definition as { nodes: any[]; edges: any[] };
    let patched = 0;
    for (const n of def.nodes) {
      if (n.id === 'isolates' || n.id === 'ast_long') {
        n.data.action = 'postgres';
        n.data.templateId = 'postgres';
        n.data.iconName = 'Database';
        n.data.config = { ...(n.data.config ?? {}), connectorId: cid };
        patched += 1;
      }
    }
    await workflows.update(mat.id, { ...mat, definition: def } as any);
    console.log(`attached connector to ${patched} DB nodes on "${mat.name}"`);
    console.log('\nRefresh the builder, open "AMR Ndola — Materialize (monthly)", and Run it.');
  } finally {
    await (internal.db as any).destroy?.();
  }
}
main().catch((e) => { console.error('WIRE ERROR:', e); process.exit(1); });
