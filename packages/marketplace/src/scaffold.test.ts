import { describe, it, expect } from 'vitest';
import { scaffold } from './scaffold';
import { parseArtifactManifest } from './artifact-manifest';

describe('scaffold', () => {
  it('plugin: emits a Cargo project + manifest + lib.rs that references the SDK', () => {
    const files = scaffold('plugin', 'demo', { publisherId: 'acme' });
    expect(Object.keys(files).sort()).toEqual(['Cargo.toml', 'README.md', 'manifest.json', 'src/lib.rs']);
    expect(files['Cargo.toml']).toContain('openldr-plugin-sdk');
    expect(files['Cargo.toml']).toContain('crate-type = ["cdylib"]');
    expect(files['src/lib.rs']).toContain('convert');
    const m = JSON.parse(files['manifest.json']);
    expect(m.id).toBe('demo');
    expect(m.type).toBe('plugin');
    expect(() => parseArtifactManifest(m)).not.toThrow(); // placeholder sha is valid hex
  });
  it('honors --sdk-git over the default path reference', () => {
    const files = scaffold('plugin', 'demo', { sdkGit: 'https://example.org/sdk.git' });
    expect(files['Cargo.toml']).toContain('git = "https://example.org/sdk.git"');
  });
  it('form: emits a Questionnaire skeleton + form-template manifest', () => {
    const files = scaffold('form', 'intake');
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'questionnaire.json']);
    expect(JSON.parse(files['questionnaire.json']).resourceType).toBe('Questionnaire');
    expect(JSON.parse(files['manifest.json']).type).toBe('form-template');
  });
  it('report: emits a report skeleton + report-template manifest', () => {
    const files = scaffold('report', 'amr');
    expect(JSON.parse(files['manifest.json']).type).toBe('report-template');
    expect(files['report.json']).toBeTruthy();
  });
});
