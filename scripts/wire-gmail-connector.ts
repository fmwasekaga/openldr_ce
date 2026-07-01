/**
 * Create (or update) a Gmail SMTP connector and attach it to the AMR Report
 * workflow's Send Email node. Verifies the credentials against Gmail before
 * declaring success. Idempotent.
 *
 * Run (creds stay on YOUR machine — not in any chat/transcript):
 *   GMAIL_USER=you@gmail.com GMAIL_APP_PASSWORD='abcdefghijklmnop' pnpm tsx scripts/wire-gmail-connector.ts
 *
 * Optional:
 *   GMAIL_TO=someone@else.com   (recipient; defaults to GMAIL_USER)
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInternalDb, createConnectorStore } from '@openldr/db';
import { createWorkflowStore } from '@openldr/workflows';
import { createEmailTransport } from '../packages/bootstrap/src/connector-email';

function envFile(n: string): string | undefined {
  try { const l = readFileSync('.env', 'utf8').split(/\r?\n/).find((x) => x.startsWith(n + '=')); return l ? l.slice(n.length + 1).trim() : undefined; } catch { return undefined; }
}
const URL = process.env.INTERNAL_DATABASE_URL || envFile('INTERNAL_DATABASE_URL') || 'postgres://openldr:openldr@localhost:5433/openldr';
const KEY = process.env.SECRETS_ENCRYPTION_KEY || envFile('SECRETS_ENCRYPTION_KEY');

const USER = process.env.GMAIL_USER;
const PASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''); // Google shows the app password with spaces
const TO = process.env.GMAIL_TO || USER;
const NAME = 'Gmail (me)';

async function main() {
  if (!USER || !PASS) throw new Error('Set GMAIL_USER and GMAIL_APP_PASSWORD env vars. See the header comment.');
  if (!KEY) throw new Error('SECRETS_ENCRYPTION_KEY not found (env or .env)');

  const config: Record<string, string> = { host: 'smtp.gmail.com', port: '587', user: USER, password: PASS, secure: 'false' };

  // 1) Verify the credentials against Gmail FIRST (fail fast on a bad app password).
  const transport = createEmailTransport('smtp', config);
  try {
    await transport.verify();
    console.log(`✓ Gmail accepted the credentials for ${USER}`);
  } catch (e) {
    console.error('✗ Gmail rejected the credentials:', (e as Error).message);
    console.error('  - Is 2-Step Verification on and is this a 16-char App Password (not your login password)?');
    process.exit(1);
  } finally { transport.close(); }

  const internal = createInternalDb(URL);
  const connectors = createConnectorStore(internal.db as any);
  const workflows = createWorkflowStore(internal.db as any);
  try {
    // 2) connector
    let cid: string;
    const prior = (await connectors.list()).find((c) => c.name === NAME);
    if (prior) { cid = prior.id; await connectors.update(cid, { config, enabled: true }, KEY); console.log(`updated connector "${NAME}" (${cid})`); }
    else { cid = randomUUID(); await connectors.create({ id: cid, name: NAME, type: 'smtp', kind: 'host', config }, KEY); console.log(`created connector "${NAME}" (${cid})`); }

    // 3) attach to the Report workflow's Send Email node
    const rep = (await workflows.list()).find((w) => w.name.includes('Report'));
    if (rep) {
      const def = rep.definition as { nodes: any[]; edges: any[] };
      const email = def.nodes.find((n) => n.data?.action === 'send-email' || n.id === 'email');
      if (email) {
        email.data.config = { ...(email.data.config ?? {}), connectorId: cid, to: TO, attachBinaryField: 'file' };
        await workflows.update(rep.id, { ...rep, definition: def } as any);
        console.log(`attached connector to Send Email node on "${rep.name}" (to=${TO})`);
      }
    }
    console.log('\nDone. Refresh the builder → open "AMR Ndola — Report & email" → the Send Email node is set.');
  } finally {
    await (internal.db as any).destroy?.();
  }
}
main().catch((e) => { console.error('WIRE ERROR:', e.message); process.exit(1); });
