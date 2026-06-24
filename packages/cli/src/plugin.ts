import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createIngestContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

interface JsonOpt {
  json: boolean;
}

/** Read the ui.html bytes adjacent to a plugin manifest, when the manifest declares
 *  payload.ui.entry (webview tier). Rejects non-plain-filename entries (path traversal). */
export function readAdjacentUi(manifest: { ui?: { entry?: string } }, manifestDir: string): Uint8Array | undefined {
  const entry = manifest.ui?.entry;
  if (!entry) return undefined;
  if (entry !== basename(entry) || entry === '') {
    throw new Error(`invalid ui entry '${entry}': must be a plain filename inside the plugin dir`);
  }
  return new Uint8Array(readFileSync(join(manifestDir, entry)));
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runPluginInstall(wasmPath: string, opts: JsonOpt & { manifest?: string }): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const wasm = new Uint8Array(readFileSync(wasmPath));
    const manifestPath = opts.manifest ?? join(dirname(wasmPath), 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const ui = readAdjacentUi(manifest, dirname(manifestPath));
    const installed = await ctx.plugins.install(wasm, manifest, { ui });
    emit(opts.json, { id: installed.id, version: installed.version }, `installed ${installed.id}@${installed.version}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runPluginList(opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const rows = await ctx.plugins.list();
    emit(
      opts.json,
      rows.map((r) => ({ id: r.id, version: r.version, status: r.status, sha256: r.sha256 })),
      rows.map((r) => `  ${r.id.padEnd(22)} ${r.version.padEnd(10)} ${r.status}`).join('\n') || '  (no plugins)',
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runPluginTest(id: string, opts: JsonOpt & { version?: string }): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const result = await ctx.plugins.test(id, opts.version);
    emit(opts.json, result, result.ok ? `plugin ${id}: ok` : `plugin ${id}: FAILED — ${result.error}`);
    return result.ok ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

export async function runPluginRun(input: string, opts: JsonOpt & { plugin: string; version?: string }): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const converter = await ctx.plugins.load(opts.plugin, opts.version);
    if (!converter) {
      emit(opts.json, { error: 'plugin not installed' }, `plugin ${opts.plugin} not installed`);
      return 1;
    }
    const data = new Uint8Array(readFileSync(input));
    const resources = await converter.convert(data, { source: 'cli', batchId: 'plugin-run' });
    emit(
      opts.json,
      resources,
      `produced ${resources.length} resource(s): [${resources.map((r) => r.resourceType).join(', ')}]`,
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runPluginRemove(id: string, opts: JsonOpt & { version?: string }): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    await ctx.plugins.remove(id, opts.version);
    emit(opts.json, { removed: id, version: opts.version ?? 'all' }, `removed ${id}${opts.version ? '@' + opts.version : ' (all versions)'}`);
    return 0;
  } finally {
    await ctx.close();
  }
}
