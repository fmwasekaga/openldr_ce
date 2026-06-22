export type ArtifactType = 'plugin' | 'form' | 'report';
export interface ScaffoldOpts { publisherId?: string; sdkPath?: string; sdkGit?: string; ceVersion?: string }

const PLACEHOLDER_SHA = '0'.repeat(64);

function manifest(type: string, id: string, opts: ScaffoldOpts, payload: Record<string, unknown>, capabilities: unknown[]): string {
  return JSON.stringify({
    schemaVersion: 1, type, id, version: '0.1.0', description: `${id} ${type} artifact`, license: 'UNLICENSED',
    publisher: { id: opts.publisherId ?? 'my-publisher', name: '', keyFingerprint: PLACEHOLDER_SHA },
    compatibility: { ceVersion: opts.ceVersion ?? '*' }, capabilities, payload,
  }, null, 2);
}

export function scaffold(type: ArtifactType, name: string, opts: ScaffoldOpts = {}): Record<string, string> {
  if (type === 'plugin') {
    const sdkDep = opts.sdkGit
      ? `openldr-plugin-sdk = { git = "${opts.sdkGit}" }`
      : `openldr-plugin-sdk = { path = "${opts.sdkPath ?? '../openldr-plugin-sdk'}" }`;
    return {
      'Cargo.toml': `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\nlicense = "UNLICENSED"\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\n${sdkDep}\nextism-pdk = "1"\nserde_json = "1"\n`,
      'src/lib.rs': `use extism_pdk::*;\nuse openldr_plugin_sdk::fhir;\n\n// Emit newline-delimited FHIR JSON. Declare every resourceType you emit in\n// manifest.json's emit-fhir capability, or the host will reject the batch.\n#[plugin_fn]\npub fn convert(_input: Vec<u8>) -> FnResult<String> {\n    let patient = fhir::patient("p1", Some("Doe"), Some("Jane"), Some("female"), Some("1990-01-01"));\n    Ok(serde_json::to_string(&patient)?)\n}\n`,
      'manifest.json': manifest('plugin', name, opts, { kind: 'plugin', wasmSha256: PLACEHOLDER_SHA, entrypoint: 'convert', wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } }, [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }, { kind: 'net-egress', allowedHosts: [] }]),
      'README.md': `# ${name}\n\nOpenLDR plugin artifact.\n\n\`\`\`\nopenldr artifact build .\nopenldr artifact pack . --key publisher.priv\nopenldr artifact test . --sample <file>\nopenldr artifact publish ./dist --to <registry> --install\n\`\`\`\n`,
    };
  }
  if (type === 'form') {
    return {
      'questionnaire.json': JSON.stringify({ resourceType: 'Questionnaire', status: 'draft', name, item: [] }, null, 2),
      'manifest.json': manifest('form-template', name, opts, { kind: 'form-template', questionnaireSha256: PLACEHOLDER_SHA }, []),
    };
  }
  return {
    'report.json': JSON.stringify({ id: name, title: name, columns: [], query: { kind: 'builder', from: '', select: [] } }, null, 2),
    'manifest.json': manifest('report-template', name, opts, { kind: 'report-template', templateSha256: PLACEHOLDER_SHA }, []),
  };
}
