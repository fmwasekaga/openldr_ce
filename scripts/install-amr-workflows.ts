/**
 * Persist the two AMR workflows into the app's internal DB so they appear in the
 * Workflow Builder list. Idempotent: updates by name if already present.
 *
 * Prereq: run the emitter first to produce the JSON definitions:
 *   CLAUDE_SCRATCHPAD=<dir> pnpm tsx scripts/seed-amr-report-demo.ts
 * Then:
 *   CLAUDE_SCRATCHPAD=<dir> pnpm tsx scripts/install-amr-workflows.ts
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInternalDb } from '@openldr/db';
import { createWorkflowStore } from '@openldr/workflows';

const DIR = process.env.CLAUDE_SCRATCHPAD || join(process.cwd(), 'scratchpad');
const URL = process.env.INTERNAL_DATABASE_URL || 'postgres://openldr:openldr@localhost:5433/openldr';

const FILES = ['amr-materialize.workflow.json', 'amr-report.workflow.json'];

async function main() {
  const internal = createInternalDb(URL);
  const store = createWorkflowStore(internal.db as any);
  try {
    const existing = await store.list();
    for (const f of FILES) {
      const j = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
      const prior = existing.find((w) => w.name === j.name);
      const wf = {
        id: prior?.id ?? randomUUID(),
        name: j.name,
        description: j.description ?? null,
        definition: { nodes: j.nodes, edges: j.edges },
        enabled: true,
        createdBy: null,
      };
      if (prior) { await store.update(prior.id, wf as any); console.log(`updated  "${j.name}" (${wf.id})`); }
      else { await store.create(wf as any); console.log(`created  "${j.name}" (${wf.id})`); }
    }
    console.log(`\nWorkflows in store: ${(await store.list()).map((w) => w.name).join(' | ')}`);
    console.log('Refresh the Workflow Builder list (no server restart needed).');
  } finally {
    await (internal.db as any).destroy?.();
  }
}
main().catch((e) => { console.error('INSTALL ERROR:', e); process.exit(1); });
