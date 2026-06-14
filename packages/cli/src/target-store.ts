import { loadConfig } from '@openldr/config';
import { selectTargetStore } from '@openldr/bootstrap';
import { redactError } from './redact-error';
import type { TargetEngine } from '@openldr/db';

export async function runTargetStoreTest(opts: { engine?: string; json: boolean }): Promise<number> {
  let engine: TargetEngine | undefined;
  if (opts.engine !== undefined) {
    if (opts.engine !== 'postgres' && opts.engine !== 'mssql') {
      const msg = `invalid --engine '${opts.engine}' (expected postgres|mssql)`;
      process.stderr.write(`${msg}\n`);
      return 1;
    }
    engine = opts.engine;
  }
  let store: { healthCheck: () => Promise<{ status: string; detail?: string }>; close: () => Promise<void> } | undefined;
  try {
    const cfg = loadConfig();
    const selected = selectTargetStore(cfg, engine);
    store = selected.store;
    const result = await selected.store.healthCheck();
    if (opts.json) {
      process.stdout.write(JSON.stringify({ engine: selected.engine, ...result }, null, 2) + '\n');
    } else {
      process.stdout.write(`target-store [${selected.engine}]: ${result.status}${result.detail ? ` (${result.detail})` : ''}\n`);
    }
    return result.status === 'up' ? 0 : 1;
  } catch (err) {
    if (opts.json) process.stdout.write(JSON.stringify({ status: 'down', error: redactError(err) }) + '\n');
    else process.stderr.write(`target-store test failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await store?.close();
  }
}
