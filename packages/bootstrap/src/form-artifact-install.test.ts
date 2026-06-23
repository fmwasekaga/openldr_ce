import { describe, it, expect, vi } from 'vitest';
import { generatePublisherKeypair, packBundle, readBundle } from '@openldr/marketplace';
import { toQuestionnaire } from '@openldr/forms';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFormArtifactInstaller } from './form-artifact-install';

const QUESTIONNAIRE = { resourceType: 'Questionnaire', status: 'active', title: 'Specimen Intake', item: [{ linkId: 'q1', text: 'Specimen ID', type: 'string' }] };

async function buildFormBundle(version: string) {
  const dir = await mkdtemp(join(tmpdir(), 'form-bundle-'));
  const kp = generatePublisherKeypair();
  const manifest = {
    schemaVersion: 1, type: 'form-template', id: 'specimen-intake', version,
    publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) },
    compatibility: { ceVersion: '*' }, capabilities: [],
    payload: { kind: 'form-template', questionnaireSha256: '0'.repeat(64) },
  };
  const outDir = join(dir, `specimen-intake-${version}`);
  await packBundle({ manifest, payload: new TextEncoder().encode(JSON.stringify(QUESTIONNAIRE)), outDir, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
  return { bundle: await readBundle(outDir), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// Fake forms store mirroring the real one: publish() stores toQuestionnaire(schema) as the version's questionnaire.
function fakeForms() {
  const forms = new Map<string, { id: string; schema: unknown; questionnaire: unknown; version: number }>();
  let n = 0;
  const store = {
    create: vi.fn(async (input: { schema: unknown }) => { const id = `form-${++n}`; forms.set(id, { id, schema: input.schema, questionnaire: null, version: 0 }); return { id }; }),
    update: vi.fn(async (id: string, input: { schema: unknown }) => { const f = forms.get(id)!; f.schema = input.schema; return { id }; }),
    publish: vi.fn(async (id: string) => { const f = forms.get(id)!; f.version += 1; f.questionnaire = toQuestionnaire(f.schema as never); return { id }; }),
    listVersions: vi.fn(async (id: string) => { const f = forms.get(id); return f && f.version ? [{ version: f.version }] : []; }),
    getVersion: vi.fn(async (id: string, _v: number) => { const f = forms.get(id)!; return { questionnaire: f.questionnaire, schema: f.schema }; }),
  };
  return { store, forms };
}

function fakeInstallStore() {
  const rows = new Map<string, any>();
  const store = {
    upsert: vi.fn(async (r: any) => { rows.set(r.artifactId, { ...rows.get(r.artifactId), ...r }); }),
    get: vi.fn(async (id: string) => rows.get(id) ?? null),
    list: vi.fn(async () => [...rows.values()]),
    remove: vi.fn(async (id: string) => { rows.delete(id); }),
  };
  return { store, rows };
}

describe('createFormArtifactInstaller', () => {
  it('install creates+publishes a form and records a non-drifted baseline', async () => {
    const { bundle, cleanup } = await buildFormBundle('1.0.0');
    const forms = fakeForms(); const installs = fakeInstallStore();
    const installer = createFormArtifactInstaller({ forms: forms.store as never, installStore: installs.store as never, audit: { record: vi.fn() } as never });
    const res = await installer.install(bundle, { actor: { id: 'admin', name: 'admin' }, approval: { approvedBy: 'admin', acknowledgedCapabilities: [] } });
    expect(forms.store.create).toHaveBeenCalledOnce();
    expect(forms.store.publish).toHaveBeenCalledOnce();
    const row = installs.rows.get('specimen-intake');
    expect(row.targetFormId).toBe(res.targetFormId);
    expect(row.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await installer.drift(row)).drifted).toBe(false);
    await cleanup();
  });

  it('re-install of a higher version updates the same form (no duplicate row)', async () => {
    const v1 = await buildFormBundle('1.0.0'); const v2 = await buildFormBundle('1.1.0');
    const forms = fakeForms(); const installs = fakeInstallStore();
    const installer = createFormArtifactInstaller({ forms: forms.store as never, installStore: installs.store as never, audit: { record: vi.fn() } as never });
    const a = await installer.install(v1.bundle, { actor: { id: 'x', name: 'x' }, approval: { approvedBy: 'x', acknowledgedCapabilities: [] } });
    const b = await installer.install(v2.bundle, { actor: { id: 'x', name: 'x' }, approval: { approvedBy: 'x', acknowledgedCapabilities: [] } });
    expect(b.targetFormId).toBe(a.targetFormId);
    expect(installs.rows.size).toBe(1);
    expect(forms.store.update).toHaveBeenCalled();
    await v1.cleanup(); await v2.cleanup();
  });

  it('refuses a tampered bundle (fail-closed)', async () => {
    const { bundle, cleanup } = await buildFormBundle('1.0.0');
    (bundle.manifest as any).id = 'evil'; // break signature coverage
    const forms = fakeForms(); const installs = fakeInstallStore();
    const installer = createFormArtifactInstaller({ forms: forms.store as never, installStore: installs.store as never, audit: { record: vi.fn() } as never });
    await expect(installer.install(bundle, { actor: { id: 'x', name: 'x' }, approval: { approvedBy: 'x', acknowledgedCapabilities: [] } })).rejects.toThrow();
    await cleanup();
  });
});
