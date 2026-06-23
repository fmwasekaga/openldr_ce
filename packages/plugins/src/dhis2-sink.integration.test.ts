import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/dhis2-sink/plugin.wasm is a gitignored build artifact
// (run `pnpm build:dhis2-sink` first). Absent ⇒ the whole suite skips.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'dhis2-sink', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const manifest = parseManifest({
    id: 'dhis2-sink', version: '0.1.0', kind: 'sink',
    entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker'],
    wasmSha256: sha256Hex(wasm), wasi: true,
  });
  // Pass a net-egress grant so the push path is allowed once a host is pinned.
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, [{ kind: 'net-egress', allowedHosts: [] }]);
}

const aggInput = (dryRun: boolean) => ({
  rows: [{ facility: 'fac-1', tested: 4, r: 2 }],
  mapping: {
    orgUnitColumn: 'facility',
    columns: [
      { column: 'tested', dataElement: 'DE_TESTED' },
      { column: 'r', dataElement: 'DE_RESISTANT', categoryOptionCombo: 'COC_DEFAULT' },
    ],
  },
  orgUnitMap: { 'fac-1': 'OU_AAA' },
  period: '2026Q1',
  dryRun,
});

describe.skipIf(!present)('dhis2-sink through the real Extism runner', () => {
  it('push_aggregate dry-run maps rows to dataValues with no egress', async () => {
    const out = (await sink().invoke('push_aggregate', aggInput(true))) as {
      payload: { dataValues: unknown[] }; skipped: unknown[]; result?: unknown;
    };
    expect(out.payload.dataValues).toEqual([
      { dataElement: 'DE_TESTED', orgUnit: 'OU_AAA', period: '2026Q1', value: '4' },
      { dataElement: 'DE_RESISTANT', categoryOptionCombo: 'COC_DEFAULT', orgUnit: 'OU_AAA', period: '2026Q1', value: '2' },
    ]);
    expect(out.skipped).toEqual([]);
    expect(out.result).toBeUndefined();
  });

  // Real egress: the runner routes a pinned-host call through the Extism worker path
  // (HttpContext + Atomics bridge), which performs the fetch on the host restricted to
  // allowedHosts. Verified live on Node 22 (prod) and 24 (dev).
  it('push_aggregate real push POSTs to a mock DHIS2 and parses the import summary', async () => {
    let postedTo = '';
    let body = '';
    const server: Server = createServer((req, res) => {
      postedTo = req.url ?? '';
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        body = Buffer.concat(chunks).toString();
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'SUCCESS', importCount: { imported: 2, updated: 0, ignored: 0, deleted: 0 }, conflicts: [] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      // Extism allowed_hosts matches the URL host (hostname), so pin '127.0.0.1'.
      const out = (await sink().invoke('push_aggregate', aggInput(false), {
        config: { baseUrl: `http://127.0.0.1:${port}`, username: 'admin', password: 'district' },
        allowedHosts: ['127.0.0.1'],
      })) as { result?: { status: string; imported: number } };
      expect(postedTo).toContain('/api/dataValueSets');
      expect(body).toContain('DE_TESTED'); // the mapped dataValues reached the server
      expect(out.result).toMatchObject({ status: 'success', imported: 2 });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
