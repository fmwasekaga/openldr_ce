// Seeds a DHIS2 connector pointing at a local DHIS2 demo so the sink plugin can be exercised
// from the UI (Settings ▸ Connectors ▸ Test, and the DHIS2 page). Idempotent: re-running
// refreshes the existing connector's config rather than creating a duplicate (name is UNIQUE).
//
//   pnpm seed:dhis2-demo                      # uses http://localhost:8085 admin/district
//   DHIS2_BASE_URL=... DHIS2_USERNAME=... DHIS2_PASSWORD=... pnpm seed:dhis2-demo
//
// Prereqs: SECRETS_ENCRYPTION_KEY set, the dhis2-sink plugin installed, and the internal DB
// reachable (migration 033 applied). Creating a connector does NO network egress — it only
// seals the config at rest — so this is safe to run under tsx.
import { loadConfig } from '@openldr/config';
import { createInternalDb, createConnectorStore } from '@openldr/db';
import { randomUUID } from 'node:crypto';

const NAME = process.env.DHIS2_CONNECTOR_NAME ?? 'DHIS2 SL Demo (local)';
const BASE = process.env.DHIS2_BASE_URL ?? 'http://localhost:8085';
const USER = process.env.DHIS2_USERNAME ?? 'admin';
const PASS = process.env.DHIS2_PASSWORD ?? 'district';

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.SECRETS_ENCRYPTION_KEY) {
    throw new Error('SECRETS_ENCRYPTION_KEY is not set — cannot seal the connector config. Set it in .env first.');
  }
  const host = new URL(BASE).hostname;
  const config = { baseUrl: BASE, username: USER, password: PASS };

  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const connectors = createConnectorStore(internal.db);
  try {
    const existing = (await connectors.list()).find((c) => c.name === NAME);
    if (existing) {
      await connectors.update(existing.id, { config, allowedHost: host, enabled: true }, cfg.SECRETS_ENCRYPTION_KEY);
      console.log(`↻ Updated connector "${NAME}" (${existing.id}) → ${BASE} (egress host: ${host})`);
    } else {
      const id = randomUUID();
      await connectors.create({ id, name: NAME, pluginId: 'dhis2-sink', kind: 'sink', config, allowedHost: host }, cfg.SECRETS_ENCRYPTION_KEY);
      console.log(`✓ Created connector "${NAME}" (${id}) → ${BASE} (egress host: ${host})`);
    }
    const all = await connectors.list();
    console.log(`\nConnectors now (${all.length}):`);
    for (const c of all) console.log(`  • ${c.name}  [plugin=${c.pluginId}, host=${c.allowedHost}, enabled=${c.enabled}]`);
    console.log('\nNext: open Settings ▸ Connectors in the app and click Test on this connector.');
  } finally {
    await internal.db.destroy();
  }
}

main().catch((e) => { console.error(`seed failed: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
