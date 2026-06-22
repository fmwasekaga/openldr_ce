import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBundle, verifyBundle } from '@openldr/marketplace';
import type { PluginRunner } from '@openldr/plugins';
import {
  runArtifactKeygen,
  runArtifactNew,
  runArtifactPack,
  runArtifactPublish,
  runArtifactTest,
  runArtifactBuild,
} from './artifact';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'artifact-'));
});

// ---------------------------------------------------------------------------
// Task 3: keygen + new
// ---------------------------------------------------------------------------

describe('artifact keygen', () => {
  it('writes a keypair and refuses to overwrite without --force', async () => {
    expect(await runArtifactKeygen({ out: dir, json: true, force: false })).toBe(0);
    const pub = await readFile(join(dir, 'publisher.pub'), 'utf8');
    expect(pub).toMatch(/^[0-9a-f]+$/);
    expect(await runArtifactKeygen({ out: dir, json: true, force: false })).toBe(1); // exists
    expect(await runArtifactKeygen({ out: dir, json: true, force: true })).toBe(0);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('artifact new', () => {
  it('scaffolds a plugin project', async () => {
    expect(await runArtifactNew('plugin', 'demo', { out: dir, json: true })).toBe(0);
    const files = await readdir(join(dir, 'demo'));
    expect(files.sort()).toContain('Cargo.toml');
    expect(files).toContain('manifest.json');
    await rm(dir, { recursive: true, force: true });
  });
  it('rejects an unknown type', async () => {
    expect(await runArtifactNew('widget' as never, 'demo', { out: dir, json: true })).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });
  it('scaffolds a form project', async () => {
    expect(await runArtifactNew('form', 'intake', { out: dir, json: true })).toBe(0);
    const files = await readdir(join(dir, 'intake'));
    expect(files).toContain('questionnaire.json');
    expect(files).toContain('manifest.json');
    await rm(dir, { recursive: true, force: true });
  });
  it('scaffolds a report project', async () => {
    expect(await runArtifactNew('report', 'amr', { out: dir, json: true })).toBe(0);
    const files = await readdir(join(dir, 'amr'));
    expect(files).toContain('report.json');
    expect(files).toContain('manifest.json');
    await rm(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Task 4: pack + publish
// ---------------------------------------------------------------------------

describe('artifact pack', () => {
  it('packs a signed bundle from a project dir', async () => {
    await runArtifactKeygen({ out: dir, json: true, force: false });
    await runArtifactNew('plugin', 'demo', { out: dir, json: true });
    const proj = join(dir, 'demo');
    await writeFile(join(proj, 'plugin.wasm'), new Uint8Array([1, 2, 3]));
    const out = join(proj, 'dist');
    expect(
      await runArtifactPack(proj, { key: join(dir, 'publisher.priv'), out, json: true }),
    ).toBe(0);
    expect(verifyBundle(await readBundle(out)).valid).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('artifact publish', () => {
  it('publish refuses an invalid bundle', async () => {
    const bogus = await mkdtemp(join(tmpdir(), 'bogus-'));
    await writeFile(join(bogus, 'manifest.json'), '{"schemaVersion":1}'); // not a valid artifact
    expect(await runArtifactPublish(bogus, { to: dir, json: true })).toBe(1);
    await rm(bogus, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  });

  it('publish copies a valid bundle to <to>/<id>/<version>/', async () => {
    await runArtifactKeygen({ out: dir, json: true, force: false });
    await runArtifactNew('plugin', 'demo', { out: dir, json: true });
    const proj = join(dir, 'demo');
    await writeFile(join(proj, 'plugin.wasm'), new Uint8Array([1, 2, 3]));
    const bundleDir = join(proj, 'dist');
    await runArtifactPack(proj, { key: join(dir, 'publisher.priv'), out: bundleDir, json: true });
    const registry = join(dir, 'registry');
    expect(await runArtifactPublish(bundleDir, { to: registry, json: true })).toBe(0);
    // Should have copied to <registry>/demo/<version>/
    const bundle = await readBundle(bundleDir);
    const { id, version } = bundle.manifest;
    const copied = await readBundle(join(registry, id, version));
    expect(verifyBundle(copied).valid).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Task 5: test (injectable runner) + build (form/report validate branch)
// ---------------------------------------------------------------------------

function fakeRunner(resources: object[]): PluginRunner {
  return {
    run: async () =>
      new TextEncoder().encode(resources.map((r) => JSON.stringify(r)).join('\n')),
  };
}

describe('artifact test', () => {
  it('passes when emitted types are within the grant', async () => {
    await runArtifactNew('plugin', 'demo', { out: dir, json: true });
    const proj = join(dir, 'demo');
    await writeFile(join(proj, 'plugin.wasm'), new Uint8Array([1]));
    const sample = join(proj, 'plugin.wasm');
    const code = await runArtifactTest(
      proj,
      { sample, json: true },
      fakeRunner([{ resourceType: 'Patient', id: 'p1' }]),
    );
    expect(code).toBe(0);
    await rm(dir, { recursive: true, force: true });
  });

  it('fails closed on an out-of-grant resourceType', async () => {
    await runArtifactNew('plugin', 'demo', { out: dir, json: true });
    const proj = join(dir, 'demo');
    await writeFile(join(proj, 'plugin.wasm'), new Uint8Array([1]));
    const sample = join(proj, 'plugin.wasm');
    const code = await runArtifactTest(
      proj,
      { sample, json: true },
      fakeRunner([
        {
          resourceType: 'Observation',
          id: 'o1',
          status: 'final',
          code: { text: 'x' },
        },
      ]),
    );
    expect(code).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('artifact build', () => {
  it('validates a valid form JSON payload', async () => {
    await runArtifactNew('form', 'intake', { out: dir, json: true });
    const proj = join(dir, 'intake');
    const code = await runArtifactBuild(proj, { json: true });
    expect(code).toBe(0);
    await rm(dir, { recursive: true, force: true });
  });

  it('fails on invalid form payload JSON', async () => {
    await runArtifactNew('form', 'intake', { out: dir, json: true });
    const proj = join(dir, 'intake');
    await writeFile(join(proj, 'questionnaire.json'), 'NOT VALID JSON{{{{');
    const code = await runArtifactBuild(proj, { json: true });
    expect(code).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });

  it('fails when cargo is not available for plugin build', async () => {
    await runArtifactNew('plugin', 'demo', { out: dir, json: true });
    const proj = join(dir, 'demo');
    // Override PATH so cargo is not found — this exercises the error branch
    const code = await runArtifactBuild(proj, { json: true, _env: { PATH: '' } });
    expect(code).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });
});
