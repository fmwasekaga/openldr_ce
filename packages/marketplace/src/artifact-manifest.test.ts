import { describe, it, expect } from 'vitest';
import { parseArtifactManifest, pluginManifestToArtifact } from './artifact-manifest';

const fp = 'a'.repeat(64);
const base = {
  schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
  publisher: { id: 'acme', name: 'Acme', keyFingerprint: fp },
  compatibility: { ceVersion: '>=0.1.0 <0.2.0' },
  capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Observation'] }],
  payload: { kind: 'plugin', wasmSha256: 'b'.repeat(64) },
};

describe('artifact manifest', () => {
  it('parses a valid plugin artifact manifest with defaults', () => {
    const m = parseArtifactManifest(base);
    expect(m.id).toBe('demo');
    expect(m.source).toBe('local-file');
    expect(m.dependencies).toEqual([]);
    expect(m.payload.kind).toBe('plugin');
  });
  it('rejects a bad version', () => {
    expect(() => parseArtifactManifest({ ...base, version: 'not-semver' })).toThrow();
  });
  it('rejects a bad publisher fingerprint', () => {
    expect(() => parseArtifactManifest({ ...base, publisher: { ...base.publisher, keyFingerprint: 'xyz' } })).toThrow();
  });
  it('parses form-template and report-template payloads', () => {
    expect(parseArtifactManifest({ ...base, type: 'form-template', payload: { kind: 'form-template', questionnaireSha256: 'c'.repeat(64) } }).type).toBe('form-template');
    expect(parseArtifactManifest({ ...base, type: 'report-template', payload: { kind: 'report-template', templateSha256: 'd'.repeat(64) } }).type).toBe('report-template');
  });
  it('adapts a legacy plugin manifest (no publisher/signature)', () => {
    const legacy = { id: 'whonet', version: '0.1.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64), description: 'x', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } };
    const a = pluginManifestToArtifact(legacy);
    expect(a.type).toBe('plugin');
    expect(a.publisher).toBeUndefined();
    expect(a.signature).toBeUndefined();
    expect(a.payload).toMatchObject({ kind: 'plugin', wasmSha256: 'e'.repeat(64), entrypoint: 'convert' });
    expect(() => parseArtifactManifest(a)).not.toThrow();
  });

  // ── Regression for f48b571 ────────────────────────────────────────────────
  // A flat legacy manifest may declare `capabilities`. Before the fix,
  // pluginManifestToArtifact() dropped the field, so installs persisted an empty
  // emit-fhir grant and fail-closed rejected every emitted resource (e.g. whonet
  // ingestion broke with "Patient … is not permitted by its emit-fhir grant").
  it('carries a declared capabilities array through legacy→artifact normalization (regression: f48b571)', () => {
    const legacy = {
      id: 'whonet-sqlite', version: '0.1.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64),
      description: 'x', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 },
      capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation'] }],
    };
    const a = pluginManifestToArtifact(legacy);
    expect(a.capabilities).toEqual([{ kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation'] }]);
    // The derived artifact must round-trip through the schema unchanged.
    expect(parseArtifactManifest(a).capabilities).toEqual(legacy.capabilities);
  });

  it('defaults capabilities to [] when a legacy manifest declares none (declare-or-denied)', () => {
    const legacy = { id: 'plain', version: '0.1.0', wasmSha256: 'e'.repeat(64) };
    // No field ⇒ schema default []. Note: a persisted [] is an ENFORCED empty grant
    // (fail-closed), NOT unrestricted — see packages/plugins runtime enforcement tests.
    expect(pluginManifestToArtifact(legacy).capabilities).toEqual([]);
  });

  it('defaults pluginKind to source and entrypoints to []', () => {
    const m = parseArtifactManifest(base);
    const p = m.payload as Extract<typeof m.payload, { kind: 'plugin' }>;
    expect(p.pluginKind).toBe('source');
    expect(p.entrypoints).toEqual([]);
  });
  it('parses a sink plugin payload carrying entrypoints', () => {
    const m = parseArtifactManifest({
      ...base,
      payload: { kind: 'plugin', pluginKind: 'sink', wasmSha256: 'b'.repeat(64), entrypoints: ['health_check', 'push_aggregate'] },
    });
    const p = m.payload as Extract<typeof m.payload, { kind: 'plugin' }>;
    expect(p.pluginKind).toBe('sink');
    expect(p.entrypoints).toEqual(['health_check', 'push_aggregate']);
  });
  it('carries kind + entrypoints through legacy->artifact normalization for a sink', () => {
    const legacy = {
      id: 'dhis2-sink', version: '0.1.0', kind: 'sink' as const, wasmSha256: 'e'.repeat(64),
      entrypoints: ['health_check', 'push_aggregate'],
      capabilities: [{ kind: 'net-egress', allowedHosts: [] as string[] }],
    };
    const a = pluginManifestToArtifact(legacy);
    const p = a.payload as Extract<typeof a.payload, { kind: 'plugin' }>;
    expect(p.pluginKind).toBe('sink');
    expect(p.entrypoints).toEqual(['health_check', 'push_aggregate']);
    expect(() => parseArtifactManifest(a)).not.toThrow();
  });

  it('carries readme through pluginManifestToArtifact and parse', () => {
    const art = pluginManifestToArtifact({
      id: 'p', version: '1.0.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64),
      description: 'x', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 },
      readme: '# Hello\n\nsetup steps',
    } as never);
    expect(art.readme).toBe('# Hello\n\nsetup steps');
    expect(parseArtifactManifest({ ...art }).readme).toBe('# Hello\n\nsetup steps');
  });
  it('defaults readme to empty string when absent', () => {
    const art = pluginManifestToArtifact({ id: 'p', version: '1.0.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64), wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } } as never);
    expect(art.readme).toBe('');
  });
});

const UI_SHA = 'a'.repeat(64);
const WASM_SHA = 'b'.repeat(64);

describe('manifest ui contribution', () => {
  it('parses a plugin payload carrying a ui block', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
      compatibility: { ceVersion: '*' },
      payload: {
        kind: 'plugin', wasmSha256: WASM_SHA,
        ui: { entry: 'ui.html', sha256: UI_SHA, nav: { label: 'Demo' } },
      },
    });
    if (m.payload.kind !== 'plugin') throw new Error('expected plugin payload');
    expect(m.payload.ui?.entry).toBe('ui.html');
    expect(m.payload.ui?.uiSdkVersion).toBe('1');      // default
    expect(m.payload.ui?.nav.icon).toBe('puzzle');     // default
    expect(m.payload.ui?.nav.section).toBe('apps');     // default
  });

  it('ui is optional (payload without it still parses)', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
      compatibility: { ceVersion: '*' }, payload: { kind: 'plugin', wasmSha256: WASM_SHA },
    });
    if (m.payload.kind !== 'plugin') throw new Error('expected plugin payload');
    expect(m.payload.ui).toBeUndefined();
  });

  it('carries a flat manifest ui block through pluginManifestToArtifact', () => {
    const a = pluginManifestToArtifact({
      id: 'demo', version: '1.0.0', wasmSha256: WASM_SHA,
      ui: { entry: 'ui.html', sha256: UI_SHA, nav: { label: 'Demo', icon: 'share-2', section: 'apps' } },
    });
    if (a.payload.kind !== 'plugin') throw new Error('expected plugin payload');
    expect(a.payload.ui?.nav.label).toBe('Demo');
    expect(a.payload.ui?.nav.icon).toBe('share-2');
    expect(a.payload.ui?.sha256).toBe(UI_SHA);
  });
});

describe('ui tiers', () => {
  const WASM = 'b'.repeat(64);
  it('allows a declarative-only ui block (no entry/sha256)', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'cfg', version: '1.0.0', compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: WASM, ui: { nav: { label: 'Cfg' }, declarative: { type: 'object', properties: { url: { type: 'string' } } } } },
    });
    if (m.payload.kind !== 'plugin') throw new Error('plugin');
    expect(m.payload.ui?.entry).toBeUndefined();
    expect(m.payload.ui?.declarative).toBeDefined();
  });
  it('still allows a webview ui block (entry+sha256)', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'web', version: '1.0.0', compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: WASM, ui: { entry: 'ui.html', sha256: 'a'.repeat(64), nav: { label: 'Web' } } },
    });
    if (m.payload.kind !== 'plugin') throw new Error('plugin');
    expect(m.payload.ui?.entry).toBe('ui.html');
  });
  it('rejects a ui block with entry but no sha256 (webview must carry both)', () => {
    expect(() => parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'bad', version: '1.0.0', compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: WASM, ui: { entry: 'ui.html', nav: { label: 'Bad' } } },
    })).toThrow();
  });
});
