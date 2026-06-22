import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations } from '@openldr/db';
import { createPluginStore } from './store';

async function db() {
  const k = newDb().adapters.createKysely() as Kysely<any>;
  for (const m of Object.values(internalMigrations)) await m.up(k);
  return k;
}
const man = (caps?: unknown) => ({ id: 'p', version: '1.0.0', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 }, ...(caps ? { schemaVersion: 1, capabilities: caps } : {}) });

describe('plugin store lifecycle', () => {
  it('install marks the new version active and deactivates others', async () => {
    const s = createPluginStore(await db());
    await s.install({ id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: man(), approvedBy: null });
    await s.install({ id: 'p', version: '2.0.0', sha256: 'b'.repeat(64), manifest: man(), approvedBy: null });
    const active = await s.get('p');
    expect(active?.version).toBe('2.0.0');
  });
  it('rollback activates a prior version', async () => {
    const s = createPluginStore(await db());
    await s.install({ id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: man(), approvedBy: null });
    await s.install({ id: 'p', version: '2.0.0', sha256: 'b'.repeat(64), manifest: man(), approvedBy: null });
    await s.rollback('p', '1.0.0');
    expect((await s.get('p'))?.version).toBe('1.0.0');
  });
  it('disable hides the plugin from get; enable restores it', async () => {
    const s = createPluginStore(await db());
    await s.install({ id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: man(), approvedBy: null });
    await s.setEnabled('p', false);
    expect(await s.get('p')).toBeUndefined();
    await s.setEnabled('p', true);
    expect((await s.get('p'))?.version).toBe('1.0.0');
  });
  it('rollback to an uninstalled version throws', async () => {
    const s = createPluginStore(await db());
    await s.install({ id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: man(), approvedBy: null });
    await expect(s.rollback('p', '9.9.9')).rejects.toThrow();
  });
  it('get(id, version) returns undefined for a disabled plugin even when a specific version is requested', async () => {
    const s = createPluginStore(await db());
    await s.install({ id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: man(), approvedBy: null });
    await s.setEnabled('p', false);
    expect(await s.get('p', '1.0.0')).toBeUndefined();
  });
});
