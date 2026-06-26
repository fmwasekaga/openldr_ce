import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCaptureManifest } from './manifest';

const REGISTRY_PATH = fileURLToPath(
  new URL('../../apps/web/src/docs/registry.ts', import.meta.url),
);
const FIXTURES = [
  'base',
  'amr',
  'workflow',
  'workflow-run',
  'form',
  'terminology',
  'users',
  'audit',
  'connector',
  'marketplace',
] as const;

async function registrySlugs(): Promise<Set<string>> {
  const source = await readFile(REGISTRY_PATH, 'utf8');
  return new Set([...source.matchAll(/slug:\s*'([^']+)'/g)].map((match) => match[1]));
}

describe('docs screenshot manifest', () => {
  it('defines the approved capture contract', async () => {
    const manifest = await loadCaptureManifest();
    const slugs = await registrySlugs();
    const names = manifest.shots.map((shot) => shot.name);

    assert.equal(manifest.shots.length, 22);
    assert.equal(new Set(names).size, 22);

    for (const shot of manifest.shots) {
      assert.match(shot.name, /^[^/\\]+\.png$/);
      assert.ok(shot.route.startsWith('/'), `${shot.name} route must start with /`);
      assert.ok(slugs.has(shot.guide), `${shot.name} guide ${shot.guide} must be registered`);
      assert.ok(FIXTURES.includes(shot.fixture as (typeof FIXTURES)[number]), `${shot.name} uses a known fixture`);
      assert.ok(shot.ready.value.trim().length > 0, `${shot.name} ready value must be set`);
      assert.equal(/dhis2/i.test(JSON.stringify(shot)), false, `${shot.name} must not mention DHIS2`);
    }

    assert.deepEqual(
      manifest.shots
        .filter((shot) => shot.guide === 'connectors')
        .map((shot) => shot.fixture),
      ['connector', 'connector'],
    );
  });
});
