// Live DHIS2 acceptance for the DHIS2 sink-plugin + connector stack (SP-1..SP-6).
//
// SKIP-GUARDED: only runs when DHIS2_LIVE=1 AND the dhis2-sink wasm is staged, so the
// normal gate skips it. Launch it via `pnpm dhis2:accept` (a runner that boots vitest
// with the env loaded), NOT the tsx CLI directly — the Extism worker-path HTTP egress
// crashes under tsx's source-map preflight, but runs green under vitest (Node 22/24).
//
// Exercises the REAL code paths against a live DHIS2 (the Sierra Leone demo):
//   1. createConnectorStore round-trip: seal config at rest -> getDecryptedConfig       (SP-3)
//   2. createWasmSink over the staged dhis2-sink.wasm + createPluginTarget               (SP-1/2/4)
//   3. healthCheck() / pullMetadata() live                                               (SP-4)
//   4. push_aggregate dry-run (maps rows -> dataValues, no egress)                       (SP-2)
//   5. push_aggregate REAL push to live DHIS2 (worker-path HTTP egress) + import summary (SP-4)
//   6. verify the dataValue landed via DHIS2 GET /api/dataValueSets                      (e2e)
//
// Preconditions: pnpm build:dhis2-sink; DHIS2 up at DHIS2_BASE_URL (admin/district);
// INTERNAL_DATABASE_URL reachable with migration 033 applied; SECRETS_ENCRYPTION_KEY set.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createWasmSink, createExtismRunner, parseManifest, sha256Hex, type WasmSink } from '@openldr/plugins';
import { createInternalDb, createConnectorStore, type ConnectorStore } from '@openldr/db';
import { createPluginTarget } from '@openldr/bootstrap';
import type { ReportingTargetPort } from '@openldr/ports';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'dhis2-sink', 'plugin.wasm');
const LIVE = process.env.DHIS2_LIVE === '1' && existsSync(wasmPath);

const BASE = process.env.DHIS2_BASE_URL ?? 'http://localhost:8085';
const USER = process.env.DHIS2_USERNAME ?? 'admin';
const PASS = process.env.DHIS2_PASSWORD ?? 'district';
const HOST = new URL(BASE).hostname;
const KEY = process.env.SECRETS_ENCRYPTION_KEY;
const INTERNAL = process.env.INTERNAL_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const PERIOD = process.env.DHIS2_TEST_PERIOD ?? '202401';
const VALUE = '7';

const auth = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;
async function dhis2<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { authorization: auth, 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`DHIS2 ${path} -> ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

function buildSink(): WasmSink {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const manifest = parseManifest({
    id: 'dhis2-sink', version: '0.1.0', kind: 'sink',
    entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker', 'wf_push'],
    wasmSha256: sha256Hex(wasm), wasi: true,
  });
  const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, [{ kind: 'net-egress', allowedHosts: [] }]);
}

describe.skipIf(!LIVE)('DHIS2 live acceptance (SP-6)', () => {
  let internal: ReturnType<typeof createInternalDb>;
  let connectors: ConnectorStore;
  let target: ReportingTargetPort;
  const connectorId = randomUUID();
  // Unique name per run so a crashed prior run's orphaned row can't collide on the name UNIQUE.
  const connectorName = `sp6-live-${connectorId.slice(0, 8)}`;
  // Discovered from live metadata in the metadata test, reused by the push test.
  let de = '', coc = '', ou = '';

  beforeAll(() => {
    internal = createInternalDb(INTERNAL);
    connectors = createConnectorStore(internal.db as unknown as Parameters<typeof createConnectorStore>[0]);
  });
  afterAll(async () => {
    try { await connectors.remove(connectorId); } catch { /* ignore */ }
    try { await internal.db.destroy(); } catch { /* ignore */ }
  });

  it('connector store round-trips a sealed config and masks the secret (SP-3)', async () => {
    const config = { baseUrl: BASE, username: USER, password: PASS };
    await connectors.create({ id: connectorId, name: connectorName, pluginId: 'dhis2-sink', kind: 'sink', config, allowedHost: HOST }, KEY);
    const masked = await connectors.get(connectorId);
    expect(masked).toBeTruthy();
    expect((masked as unknown as Record<string, unknown>).config).toBeUndefined();
    expect(await connectors.getDecryptedConfig(connectorId, KEY)).toEqual(config);
  });

  it('healthCheck() reports the live DHIS2 as up (SP-4)', async () => {
    const config = await connectors.getDecryptedConfig(connectorId, KEY);
    target = createPluginTarget(buildSink(), config, HOST);
    const health = await target.healthCheck();
    expect(health.status).toBe('up');
  });

  it('pullMetadata() returns non-empty live SL-demo metadata (SP-4)', async () => {
    const md = await target.pullMetadata();
    // eslint-disable-next-line no-console
    console.log('  metadata counts =', JSON.stringify({ dataElements: md.dataElements.length, orgUnits: md.orgUnits.length, categoryOptionCombos: md.categoryOptionCombos.length, programs: md.programs?.length ?? 0, programStages: md.programStages?.length ?? 0 }));
    expect(md.dataElements.length).toBeGreaterThan(0);
    expect(md.orgUnits.length).toBeGreaterThan(0);
    expect(md.categoryOptionCombos.length).toBeGreaterThan(0);

    // Discover a valid aggregate numeric DE + its default COC + a leaf org unit.
    de = (await dhis2<{ dataElements: { id: string; categoryCombo: { id: string } }[] }>(
      '/api/dataElements.json?filter=domainType:eq:AGGREGATE&filter=valueType:in:[INTEGER,NUMBER,INTEGER_POSITIVE,INTEGER_ZERO_OR_POSITIVE]&fields=id,categoryCombo[id]&paging=true&pageSize=1',
    )).dataElements[0]?.id ?? '';
    const ccId = (await dhis2<{ dataElements: { categoryCombo: { id: string } }[] }>(
      `/api/dataElements.json?filter=id:eq:${de}&fields=categoryCombo[id]`,
    )).dataElements[0].categoryCombo.id;
    coc = (await dhis2<{ categoryOptionCombos: { id: string }[] }>(`/api/categoryCombos/${ccId}.json?fields=categoryOptionCombos[id]`)).categoryOptionCombos[0].id;
    ou = (await dhis2<{ organisationUnits: { id: string }[] }>('/api/organisationUnits.json?filter=level:eq:4&fields=id&paging=true&pageSize=1')).organisationUnits[0].id;
    expect(de && coc && ou).toBeTruthy();
  });

  it('push_aggregate dry-run maps rows to dataValues with no egress (SP-2)', async () => {
    const out = (await target.pushAggregate({
      rows: [{ ou, val: VALUE }],
      mapping: { orgUnitColumn: 'ou', columns: [{ column: 'val', dataElement: de, categoryOptionCombo: coc }] },
      orgUnitMap: { [ou]: ou }, period: PERIOD, dryRun: true,
    })) as { payload: { dataValues: unknown[] }; result?: unknown };
    expect(out.payload.dataValues).toHaveLength(1);
    expect(out.result).toBeUndefined();
  });

  it('push_aggregate REAL push lands in live DHIS2 and is served back (SP-4 + e2e)', async () => {
    const out = await target.pushAggregate({
      rows: [{ ou, val: VALUE }],
      mapping: { orgUnitColumn: 'ou', columns: [{ column: 'val', dataElement: de, categoryOptionCombo: coc }] },
      orgUnitMap: { [ou]: ou }, period: PERIOD, dryRun: false,
    });
    const r = out.result as { status?: string; imported?: number; updated?: number } | undefined;
    // eslint-disable-next-line no-console
    console.log('  import result =', JSON.stringify(r));
    expect(r).toBeTruthy();
    expect((r!.status ?? '').toLowerCase()).not.toBe('error');
    expect((r!.imported ?? 0) + (r!.updated ?? 0)).toBeGreaterThanOrEqual(1);

    const back = await dhis2<{ dataValues?: { dataElement: string; orgUnit: string; period: string; value: string }[] }>(
      `/api/dataValueSets.json?dataElement=${de}&orgUnit=${ou}&period=${PERIOD}`,
    );
    const landed = (back.dataValues ?? []).find((d) => d.dataElement === de && d.orgUnit === ou && d.period === PERIOD);
    expect(landed?.value).toBe(VALUE);

    // Best-effort cleanup of the test dataValue.
    try { await fetch(`${BASE}/api/dataValues?de=${de}&pe=${PERIOD}&ou=${ou}&co=${coc}`, { method: 'DELETE', headers: { authorization: auth } }); } catch { /* ignore */ }
  });

  // The SP-5a workflow node: the engine forwards upstream items + the denormalized
  // mapping/orgUnitMap as `config` to the `wf_push` entrypoint, resolving only the
  // connector (decrypted config + pinned egress host) — exactly what we pass here.
  it('wf_push (workflow node) dry-run builds dataValues, then REAL push lands + served back (SP-5a)', async () => {
    const config = await connectors.getDecryptedConfig(connectorId, KEY);
    const sink = buildSink();
    const WF_VALUE = '9';
    const node = (dryRun: boolean) => ({
      items: [{ json: { ou, val: WF_VALUE } }],
      config: {
        mapping: { orgUnitColumn: 'ou', columns: [{ column: 'val', dataElement: de, categoryOptionCombo: coc }] },
        orgUnitMap: { [ou]: ou }, period: PERIOD, dryRun,
      },
    });

    // Dry-run: items -> 1 dataValue, no egress, no import result (allowedHosts empty).
    const dry = (await sink.invoke('wf_push', node(true), { config, allowedHosts: [] })) as
      { items: unknown[]; meta: { kind: string; dataValues: number; result: unknown } };
    expect(dry.meta.kind).toBe('aggregate');
    expect(dry.meta.dataValues).toBe(1);
    expect(dry.meta.result).toBeNull();
    expect(dry.items).toHaveLength(1);

    // Real push: worker-path HTTP egress to the pinned host; import summary in meta.result.
    const live = (await sink.invoke('wf_push', node(false), { config, allowedHosts: [HOST] })) as
      { meta: { result?: { status?: string; imported?: number; updated?: number } } };
    const r = live.meta.result;
    // eslint-disable-next-line no-console
    console.log('  wf_push import result =', JSON.stringify(r));
    expect(r).toBeTruthy();
    expect((r!.status ?? '').toLowerCase()).not.toBe('error');
    expect((r!.imported ?? 0) + (r!.updated ?? 0)).toBeGreaterThanOrEqual(1);

    const back = await dhis2<{ dataValues?: { dataElement: string; orgUnit: string; period: string; value: string }[] }>(
      `/api/dataValueSets.json?dataElement=${de}&orgUnit=${ou}&period=${PERIOD}`,
    );
    const landed = (back.dataValues ?? []).find((d) => d.dataElement === de && d.orgUnit === ou && d.period === PERIOD);
    expect(landed?.value).toBe(WF_VALUE);

    // Best-effort cleanup of the test dataValue.
    try { await fetch(`${BASE}/api/dataValues?de=${de}&pe=${PERIOD}&ou=${ou}&co=${coc}`, { method: 'DELETE', headers: { authorization: auth } }); } catch { /* ignore */ }
  });
});
