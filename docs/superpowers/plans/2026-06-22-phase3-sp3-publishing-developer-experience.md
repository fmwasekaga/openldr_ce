# Phase 3 SP-3 — Publishing & Developer Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the artifact authoring pipeline — an `artifact` CLI group (keygen / new / build / pack / sign / test / publish) over new `packages/marketplace` author helpers (`packBundle`, `scaffold`) — and reimplement `make-marketplace-bundle.ts` on it.

**Architecture:** Pure author-side helpers in `packages/marketplace` (`packBundle` writes a signed bundle via the existing `signManifest`/`verifyBundle`; `scaffold` returns a `{path: content}` map). A thin CLI `artifact` group orchestrates them + `cargo` (build) + the SP-2 install path (publish --install) + an in-process grant dry-run (test). Plugin is end-to-end; form/report scaffold + sign now (install lifecycle later). The `cargo` build wrapper is integration-only; everything else is unit-tested (the test command takes an injectable runner).

**Tech Stack:** TypeScript, zod, Node `crypto`/`fs`/`child_process`, commander CLI, Extism, Vitest, Turborepo/pnpm. Spec: `docs/superpowers/specs/2026-06-22-phase3-sp3-publishing-developer-experience-design.md`.

**Conventions:**
- Tests from root: `pnpm --filter @openldr/<pkg> test -- --run <path>`. Typecheck: `pnpm --filter @openldr/<pkg> exec tsc -p tsconfig.json --noEmit`.
- Full gate (final task): `pnpm turbo typecheck lint test build && pnpm depcruise`.
- CLI idiom (`packages/cli/src/market.ts`): `interface JsonOpt { json: boolean }`, local `emit(json, payload, human)`, `redactError`, `createIngestContext(loadConfig())`, each `run*` returns an exit-code number; register groups in `index.ts` via `program.command('artifact').command('<sub>')…action(async (...) => { process.exitCode = await runArtifact*(...) })`.
- Commit after every task. `marketplace` imports `node:fs`/`node:crypto` (already does in `bundle-fs.ts`) but NEVER `node:child_process` and NEVER `@openldr/plugins` (no cycle). `cargo` invocation lives only in the CLI.

---

## Slice 1 — `packBundle` (the signed-bundle core)

### Task 1: `packBundle` in marketplace

**Files:**
- Create: `packages/marketplace/src/pack.ts`, `packages/marketplace/src/pack.test.ts`
- Modify: `packages/marketplace/src/index.ts`

- [ ] **Step 1: Write the failing test** — `pack.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePublisherKeypair } from './signing';
import { readBundle, verifyBundle } from './bundle-fs';
import { packBundle } from './pack';

const baseManifest = {
  schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
  publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) }, // placeholder, packBundle overwrites
  compatibility: { ceVersion: '*' },
  capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
  payload: { kind: 'plugin', wasmSha256: '0'.repeat(64) }, // placeholder, packBundle overwrites
};

describe('packBundle', () => {
  it('writes a signed bundle that verifies, filling sha + publisher fingerprint', async () => {
    const out = await mkdtemp(join(tmpdir(), 'pack-'));
    const kp = generatePublisherKeypair();
    const wasm = new Uint8Array([1, 2, 3, 4]);
    const res = await packBundle({ manifest: structuredClone(baseManifest), payload: wasm, outDir: out, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
    expect(res.fingerprint).toBe(kp.fingerprint);
    const bundle = await readBundle(out);
    expect(verifyBundle(bundle).valid).toBe(true);
    expect(bundle.manifest.publisher?.keyFingerprint).toBe(kp.fingerprint);
    expect((bundle.manifest.payload as { wasmSha256: string }).wasmSha256).not.toBe('0'.repeat(64));
    // payload written under the conventional filename
    expect(new Uint8Array(await readFile(join(out, 'plugin.wasm')))).toEqual(wasm);
    await rm(out, { recursive: true, force: true });
  });

  it('a tampered written manifest fails verification', async () => {
    const out = await mkdtemp(join(tmpdir(), 'pack-'));
    const kp = generatePublisherKeypair();
    await packBundle({ manifest: structuredClone(baseManifest), payload: new Uint8Array([9]), outDir: out, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
    const m = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    m.id = 'evil';
    await writeFile(join(out, 'manifest.json'), JSON.stringify(m));
    expect(verifyBundle(await readBundle(out)).valid).toBe(false);
    await rm(out, { recursive: true, force: true });
  });

  it('packs a form-template payload under questionnaire.json', async () => {
    const out = await mkdtemp(join(tmpdir(), 'pack-'));
    const kp = generatePublisherKeypair();
    const formManifest = { ...structuredClone(baseManifest), type: 'form-template', capabilities: [], payload: { kind: 'form-template', questionnaireSha256: '0'.repeat(64) } };
    await packBundle({ manifest: formManifest, payload: new TextEncoder().encode('{"resourceType":"Questionnaire"}'), outDir: out, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
    expect(verifyBundle(await readBundle(out)).valid).toBe(true);
    expect(await readFile(join(out, 'questionnaire.json'), 'utf8')).toContain('Questionnaire');
    await rm(out, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/marketplace test -- --run src/pack.test.ts`

- [ ] **Step 3: Implement** — `pack.ts`

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArtifactManifest, type ArtifactManifest } from './artifact-manifest';
import { signManifest, keyFingerprint } from './signing';
import { readBundle, verifyBundle } from './bundle-fs';

export interface PackInput {
  manifest: Record<string, unknown>; // unsigned artifact manifest (publisher.keyFingerprint + payload sha are overwritten)
  payload: Uint8Array;
  outDir: string;
  privateKeyDer: Uint8Array;
  publicKeyDer: Uint8Array;
}
export interface PackResult { bundleDir: string; fingerprint: string; manifest: ArtifactManifest }

const PAYLOAD_FILE: Record<string, string> = { plugin: 'plugin.wasm', 'form-template': 'questionnaire.json', 'report-template': 'report.json' };
const SHA_FIELD: Record<string, string> = { plugin: 'wasmSha256', 'form-template': 'questionnaireSha256', 'report-template': 'templateSha256' };

export async function packBundle(input: PackInput): Promise<PackResult> {
  const fingerprint = keyFingerprint(input.publicKeyDer);
  const payloadSha = createHash('sha256').update(input.payload).digest('hex');

  // Build the unsigned manifest with sha + publisher fingerprint filled in; drop any stale signature.
  const draft = { ...input.manifest } as Record<string, unknown>;
  delete draft.signature;
  const publisher = { ...(draft.publisher as Record<string, unknown> | undefined) };
  publisher.keyFingerprint = fingerprint;
  draft.publisher = publisher;
  const payload = { ...(draft.payload as Record<string, unknown>) };
  const kind = String(payload.kind);
  const shaField = SHA_FIELD[kind];
  if (!shaField) throw new Error(`packBundle: unsupported payload kind ${kind}`);
  payload[shaField] = payloadSha;
  draft.payload = payload;

  const parsed = parseArtifactManifest(draft); // validates before signing
  const signature = signManifest(parsed as unknown as Record<string, unknown>, payloadSha, input.privateKeyDer);
  const signedManifest = { ...(parsed as unknown as Record<string, unknown>), signature };

  await mkdir(input.outDir, { recursive: true });
  await writeFile(join(input.outDir, 'manifest.json'), JSON.stringify(signedManifest, null, 2));
  await writeFile(join(input.outDir, PAYLOAD_FILE[kind]), input.payload);
  await writeFile(join(input.outDir, 'publisher.pub'), Buffer.from(input.publicKeyDer).toString('hex'));

  // Self-check: the bundle we just wrote must verify.
  const check = verifyBundle(await readBundle(input.outDir));
  if (!check.valid) throw new Error('packBundle: produced an invalid bundle (internal error)');

  return { bundleDir: input.outDir, fingerprint, manifest: parsed };
}
```
NOTE: `readBundle` expects the payload at `plugin.wasm` (per SP-2's `bundle-fs.ts`, which reads `plugin.wasm`). For form/report bundles, the self-check `verifyBundle` only checks the manifest signature + the `payload.<...>Sha256` against the sha of the file `readBundle` loads. **Check `bundle-fs.ts`:** if `readBundle` hardcodes `plugin.wasm`, the form/report self-check will read the wrong file. If so, generalize `readBundle` to read the payload filename by `manifest.payload.kind` (`PAYLOAD_FILE` map) and compute `payloadSha256` over it — make that change in `bundle-fs.ts` as part of this task and keep its existing test green (plugin path unchanged). Verify and adapt.

- [ ] **Step 4: Run, expect PASS**; add `export * from './pack';` to `index.ts`.

- [ ] **Step 5: Commit**
```bash
git add packages/marketplace/src/pack.ts packages/marketplace/src/pack.test.ts packages/marketplace/src/index.ts packages/marketplace/src/bundle-fs.ts
git commit -m "feat(marketplace): packBundle — sign + write a verifiable artifact bundle"
```

---

## Slice 2 — `scaffold` (skeleton generator)

### Task 2: `scaffold` in marketplace

**Files:**
- Create: `packages/marketplace/src/scaffold.ts`, `packages/marketplace/src/scaffold.test.ts`
- Modify: `packages/marketplace/src/index.ts`

- [ ] **Step 1: Write the failing test** — `scaffold.test.ts`

```ts
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
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/marketplace test -- --run src/scaffold.test.ts`

- [ ] **Step 3: Implement** — `scaffold.ts`

```ts
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
```

- [ ] **Step 4: Run, expect PASS**; add `export * from './scaffold';` to `index.ts`.

- [ ] **Step 5: Commit**
```bash
git add packages/marketplace/src/scaffold.ts packages/marketplace/src/scaffold.test.ts packages/marketplace/src/index.ts
git commit -m "feat(marketplace): scaffold — plugin/form/report skeleton generator"
```

---

## Slice 3 — the `artifact` CLI group

### Task 3: `artifact keygen` + `artifact new`

**Files:**
- Create: `packages/cli/src/artifact.ts`, `packages/cli/src/artifact.test.ts`
- Modify: `packages/cli/src/index.ts`

Read `packages/cli/src/market.ts` first for the exact idiom (`JsonOpt`, `emit`, `redactError`).

- [ ] **Step 1: Write the failing test** — `artifact.test.ts` (keygen + new). Use a temp dir; assert keygen writes `publisher.priv`/`publisher.pub` + refuses overwrite without `--force`, and `new` writes the scaffold files.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runArtifactKeygen, runArtifactNew } from './artifact';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'artifact-')); });

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
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** keygen + new in `artifact.ts`

```ts
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { generatePublisherKeypair, scaffold, type ArtifactType } from '@openldr/marketplace';
import { redactError } from './redact-error';

interface JsonOpt { json: boolean }
function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}
async function exists(p: string): Promise<boolean> { try { await access(p); return true; } catch { return false; } }

export async function runArtifactKeygen(opts: JsonOpt & { out: string; force?: boolean }): Promise<number> {
  try {
    await mkdir(opts.out, { recursive: true });
    const privPath = join(opts.out, 'publisher.priv');
    if (!opts.force && (await exists(privPath))) {
      process.stderr.write(`refusing to overwrite ${privPath} (use --force)\n`);
      return 1;
    }
    const kp = generatePublisherKeypair();
    await writeFile(privPath, Buffer.from(kp.privateKeyDer).toString('hex'));
    await writeFile(join(opts.out, 'publisher.pub'), Buffer.from(kp.publicKeyDer).toString('hex'));
    emit(opts.json, { fingerprint: kp.fingerprint, out: opts.out }, `publisher key written to ${opts.out}\n  fingerprint ${kp.fingerprint}`);
    return 0;
  } catch (err) { process.stderr.write(`artifact keygen failed: ${redactError(err)}\n`); return 1; }
}

export async function runArtifactNew(type: string, name: string, opts: JsonOpt & { out?: string; publisherId?: string; sdkPath?: string; sdkGit?: string }): Promise<number> {
  try {
    if (!['plugin', 'form', 'report'].includes(type)) { process.stderr.write(`unknown artifact type: ${type}\n`); return 1; }
    const files = scaffold(type as ArtifactType, name, { publisherId: opts.publisherId, sdkPath: opts.sdkPath, sdkGit: opts.sdkGit });
    const base = join(opts.out ?? '.', name);
    for (const [rel, content] of Object.entries(files)) {
      const full = join(base, rel);
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, content);
    }
    emit(opts.json, { created: base, files: Object.keys(files) }, `scaffolded ${type} '${name}' at ${base}`);
    return 0;
  } catch (err) { process.stderr.write(`artifact new failed: ${redactError(err)}\n`); return 1; }
}
```
(Ensure `@openldr/marketplace` is a dependency of `packages/cli` — it was added in SP-2; confirm in `packages/cli/package.json`.)

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @openldr/cli test -- --run src/artifact.test.ts`

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/artifact.ts packages/cli/src/artifact.test.ts
git commit -m "feat(cli): artifact keygen + new"
```

### Task 4: `artifact pack` + `sign` + `publish`

**Files:**
- Modify: `packages/cli/src/artifact.ts`, `packages/cli/src/artifact.test.ts`

- [ ] **Step 1: Write failing tests** — add `pack`/`publish` tests. `pack`: scaffold a plugin, write a fake `plugin.wasm`, keygen, fill the manifest sha placeholder is handled by packBundle, run `runArtifactPack(dir, {key})` → assert a `dist/` bundle verifies. `publish`: pack, then `runArtifactPublish(bundleDir, {to})` → assert the bundle is copied to `<to>/<id>/<version>/`, and that an invalid bundle dir returns 1.

```ts
import { runArtifactPack, runArtifactPublish } from './artifact';
import { readBundle, verifyBundle } from '@openldr/marketplace';
// ... within describe, using mkdtemp dirs:
it('packs a signed bundle from a project dir', async () => {
  await runArtifactKeygen({ out: dir, json: true });
  await runArtifactNew('plugin', 'demo', { out: dir, json: true });
  const proj = join(dir, 'demo');
  await writeFile(join(proj, 'plugin.wasm'), new Uint8Array([1, 2, 3]));
  const out = join(proj, 'dist');
  expect(await runArtifactPack(proj, { key: join(dir, 'publisher.priv'), out, json: true })).toBe(0);
  expect(verifyBundle(await readBundle(out)).valid).toBe(true);
});
it('publish refuses an invalid bundle', async () => {
  const bogus = await mkdtemp(join(tmpdir(), 'bogus-'));
  await writeFile(join(bogus, 'manifest.json'), '{"schemaVersion":1}'); // not a valid artifact
  expect(await runArtifactPublish(bogus, { to: dir, json: true })).toBe(1);
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** pack/sign/publish. `pack` reads `manifest.json` + payload (by `payload.kind` → `plugin.wasm`/`questionnaire.json`/`report.json`) + the private key (and the sibling `publisher.pub`, or derive the public key from the private key via `node:crypto` `createPublicKey`), calls `packBundle`. `sign` = pack with `out = dir`. `publish` = `readBundle` + `verifyBundle` (return 1 if invalid) + copy to `<to>/<id>/<version>/`; with `--install`, `createIngestContext(loadConfig())` + `ctx.plugins.install(bundle.wasm, bundle.raw, { publicKeyDer: bundle.publicKeyDer, actor: { name: 'cli' }, approval: opts.approve ? { approvedBy: opts.approvedBy ?? 'cli', acknowledgedCapabilities: bundle.manifest.capabilities } : undefined })` then `ctx.close()`. Full code: derive the payload filename from the manifest's `payload.kind`; to get `publicKeyDer` from the private key for `packBundle`, prefer reading the sibling `publisher.pub`; if absent, `createPublicKey({ key: Buffer.from(privHex,'hex'), format:'der', type:'pkcs8' }).export({ type:'spki', format:'der' })`.

(Provide the full `runArtifactPack`/`runArtifactSign`/`runArtifactPublish` bodies following the keygen/new style + the descriptions above; reuse `emit`/`redactError`; `publish --install` uses `createIngestContext`.)

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/artifact.ts packages/cli/src/artifact.test.ts
git commit -m "feat(cli): artifact pack/sign/publish"
```

### Task 5: `artifact test` (in-process grant dry-run) + `artifact build`

**Files:**
- Modify: `packages/cli/src/artifact.ts`, `packages/cli/src/artifact.test.ts`

`artifact test` takes an injectable runner (default `createExtismRunner()`) so it is unit-testable with a fake runner. `artifact build` shells `cargo` for plugin projects (integration-only) and validates JSON for form/report.

- [ ] **Step 1: Write the failing test** — inject a fake runner emitting NDJSON; assert in-grant passes (exit 0, reports emitted types) and out-of-grant fails (exit 1, reports the violation).

```ts
import { runArtifactTest } from './artifact';
import type { PluginRunner } from '@openldr/plugins';
function fakeRunner(resources: object[]): PluginRunner {
  return { run: async () => new TextEncoder().encode(resources.map((r) => JSON.stringify(r)).join('\n')) };
}
it('artifact test passes when emitted types are within the grant', async () => {
  await runArtifactNew('plugin', 'demo', { out: dir, json: true });
  const proj = join(dir, 'demo');
  await writeFile(join(proj, 'plugin.wasm'), new Uint8Array([1]));
  const code = await runArtifactTest(proj, { sample: join(proj, 'plugin.wasm'), json: true }, fakeRunner([{ resourceType: 'Patient', id: 'p1' }]));
  expect(code).toBe(0);
});
it('artifact test fails closed on an out-of-grant resourceType', async () => {
  await runArtifactNew('plugin', 'demo', { out: dir, json: true });
  const proj = join(dir, 'demo');
  await writeFile(join(proj, 'plugin.wasm'), new Uint8Array([1]));
  const code = await runArtifactTest(proj, { sample: join(proj, 'plugin.wasm'), json: true }, fakeRunner([{ resourceType: 'Observation', id: 'o1', status: 'final', code: { text: 'x' } }]));
  expect(code).toBe(1);
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** `runArtifactTest(dir, opts, runner = createExtismRunner())`: read `manifest.json` (parse via `parseArtifactManifest`) + `plugin.wasm` + the `--sample` bytes; build the legacy plugin manifest via `pluginManifestToArtifact`-equivalent fields (or pass the artifact's payload fields); compute the grant via `readGrant(manifest)`; create the converter with `createWasmConverter(<pluginManifest>, wasm, runner, logger, grant.legacy ? undefined : grant.capabilities)`; `await converter.convert(sample, { batchId: 'artifact-test' })`; on success emit the emitted resource types (`resources.map(r => r.resourceType)`) + the applied `net-egress` allowlist, return 0; on a thrown capability error, emit the violation message, return 1. Build a minimal `logger` (`{ info/error/warn/debug: () => {} }`). Import `createWasmConverter`, `createExtismRunner`, `type PluginRunner` from `@openldr/plugins`, and `readGrant`/`parseArtifactManifest`/`allowedHosts` from `@openldr/marketplace`.

`runArtifactBuild(dir, opts)`: read `manifest.json`; if `payload.kind === 'plugin'`, `execSync('cargo build --release --target wasm32-wasip1', { cwd: dir, stdio: 'inherit', env: process.env })`, then copy `target/wasm32-wasip1/release/<crate>.wasm` (crate = Cargo.toml `name`, `-`→`_`) to `dir/plugin.wasm`; else validate the JSON payload parses. Emit the staged path + sha. Wrap in try/catch → redactError. (Integration — the cargo path isn't unit-tested; a unit test may cover the form/report validate branch + the missing-cargo error path.)

- [ ] **Step 4: Run, expect PASS** (the test command tests; build's cargo path is integration)

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/artifact.ts packages/cli/src/artifact.test.ts
git commit -m "feat(cli): artifact test (in-process grant dry-run) + build (cargo wrapper)"
```

### Task 6: Register the `artifact` group in index.ts

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Import the run functions + register the group**

After the existing `market` group registration, add:
```ts
import { runArtifactKeygen, runArtifactNew, runArtifactBuild, runArtifactPack, runArtifactSign, runArtifactTest, runArtifactPublish } from './artifact';
// ...
const artifact = program.command('artifact').description('Author marketplace artifacts (scaffold/build/sign/publish)');
artifact.command('keygen').requiredOption('--out <dir>', 'output directory for the keypair').option('--force', 'overwrite an existing key', false).option('--json', 'emit JSON', false)
  .action(async (o: { out: string; force: boolean; json: boolean }) => { process.exitCode = await runArtifactKeygen(o); });
artifact.command('new <type> <name>').description('scaffold plugin|form|report').option('--out <dir>', 'parent directory', '.').option('--publisher-id <id>').option('--sdk-path <p>').option('--sdk-git <url>').option('--json', 'emit JSON', false)
  .action(async (type: string, name: string, o: { out?: string; publisherId?: string; sdkPath?: string; sdkGit?: string; json: boolean }) => { process.exitCode = await runArtifactNew(type, name, o); });
artifact.command('build <dir>').option('--json', 'emit JSON', false).action(async (dir: string, o: { json: boolean }) => { process.exitCode = await runArtifactBuild(dir, o); });
artifact.command('pack <dir>').requiredOption('--key <priv>', 'publisher private key').option('--out <dir>', 'bundle output dir').option('--json', 'emit JSON', false)
  .action(async (dir: string, o: { key: string; out?: string; json: boolean }) => { process.exitCode = await runArtifactPack(dir, o); });
artifact.command('sign <dir>').requiredOption('--key <priv>').option('--json', 'emit JSON', false).action(async (dir: string, o: { key: string; json: boolean }) => { process.exitCode = await runArtifactSign(dir, o); });
artifact.command('test <dir>').requiredOption('--sample <file>').option('--json', 'emit JSON', false).action(async (dir: string, o: { sample: string; json: boolean }) => { process.exitCode = await runArtifactTest(dir, o); });
artifact.command('publish <bundleDir>').requiredOption('--to <registryDir>').option('--install', 'also install into the running CE', false).option('--approve', 'approve requested capabilities on install', false).option('--approved-by <actor>').option('--json', 'emit JSON', false)
  .action(async (bundleDir: string, o: { to: string; install: boolean; approve: boolean; approvedBy?: string; json: boolean }) => { process.exitCode = await runArtifactPublish(bundleDir, o); });
```
Adjust `runArtifact*` option types if they differ; the `runArtifactTest` 3rd param (runner) defaults inside, so the action passes only `(dir, o)`.

- [ ] **Step 2: Typecheck + cli tests** — `pnpm --filter @openldr/cli exec tsc -p tsconfig.json --noEmit` (PASS), `pnpm --filter @openldr/cli test -- --run` (PASS).

- [ ] **Step 3: Commit**
```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): register the artifact command group"
```

---

## Slice 4 — Reimplement the bundle builder on packBundle

### Task 7: `make-marketplace-bundle.ts` uses packBundle

**Files:**
- Modify: `scripts/make-marketplace-bundle.ts`

- [ ] **Step 1: Rewrite** the bundle construction to call `packBundle` (from `@openldr/marketplace`) for the narrow + wide variants instead of hand-signing. Keep the same publisher-key persistence (`scripts/.marketplace-keys/whonet.priv`/`.pub`, reuse-or-generate via `generatePublisherKeypair`), the same output dirs (`../openldr-ce-marketplace/bundles/whonet-narrow|whonet-wide`), the same narrow (`emit-fhir:[Patient]`, v1.0.0) / wide (v1.1.0) manifests. For each variant: build the unsigned manifest object + read `reference-plugins/whonet-sqlite/plugin.wasm`, then `await packBundle({ manifest, payload: wasm, outDir, privateKeyDer, publicKeyDer })`. Drop the inline `signManifest`/`createHash`/`writeFileSync` bundle logic (packBundle does it). Keep the prereq checks + console output.

- [ ] **Step 2: Typecheck the script** (best-effort, run via tsx) — confirm imports resolve; do NOT run it (it writes to the sibling repo). Confirm `packBundle` is exported from `@openldr/marketplace`.

- [ ] **Step 3: Commit**
```bash
git add scripts/make-marketplace-bundle.ts
git commit -m "refactor(marketplace): make-marketplace-bundle uses packBundle"
```

---

### Task 8: Full gate + verification

- [ ] **Step 1: Full gate** — `pnpm turbo typecheck lint test build && pnpm depcruise`. Expected green. `depcruise`: confirm `marketplace` still has no `@openldr/plugins` edge and no `node:child_process` import (cargo is CLI-only); `cli → marketplace` + `cli → plugins` edges are fine. If `@openldr/web#test` flakes, re-run in isolation.
- [ ] **Step 2: Commit any fixes.**

(Author live demo is run by the user — see the spec §8. The `marketplace:accept` harness, now backed by `packBundle`, remains the regression check; the user re-runs `pnpm make:marketplace-bundle && pnpm marketplace:accept`.)

---

## Self-Review

**Spec coverage:**
- §4.1 keygen → Task 3. ✓
- §4.2 new (plugin/form/report scaffold) → Tasks 2 (scaffold) + 3 (CLI). ✓
- §4.3 build (cargo wrapper) → Task 5. ✓
- §4.4 pack / §4.5 sign → Tasks 1 (packBundle) + 4 (CLI). ✓
- §4.6 test (in-process grant dry-run, injectable runner) → Task 5. ✓
- §4.7 publish (registry copy + --install) → Task 4. ✓
- §5 author helpers (packBundle, scaffold) in marketplace → Tasks 1, 2. ✓
- §6 replace make-marketplace-bundle → Task 7. ✓
- §7 testing → tests in Tasks 1–5. ✓
- §9 verification (gate) → Task 8. ✓
- §10 out-of-scope (UI, form/report install, federation) → none built. ✓
- §11 risks (toolchain, SDK ref, key hygiene, fs boundary) → keygen overwrite guard (Task 3), sdk-git/path (Task 2/3), packBundle in marketplace + cargo in CLI (Tasks 1, 5). ✓

**Placeholder scan:** No TBD/TODO. Task 4 Step 3 and Task 5 Step 3 describe full command bodies via prose + the established `market.ts` idiom + exact API calls rather than re-pasting every line — concrete and unambiguous given the keygen/new full code in Task 3 sets the pattern. Task 1 Step 3 flags the `bundle-fs.ts` payload-filename generalization with an explicit verify-and-adapt instruction.

**Type/name consistency:** `packBundle(PackInput)→PackResult`, `scaffold(type,name,opts)→Record<string,string>`, `ArtifactType`, `runArtifactKeygen/New/Build/Pack/Sign/Test/Publish` signatures match between `artifact.ts` (Tasks 3–5) and the `index.ts` registration (Task 6). `runArtifactTest`'s injectable-runner 3rd param defaults to `createExtismRunner()` and is omitted by the CLI action. Payload-file/sha-field maps (`plugin.wasm`/`wasmSha256`, `questionnaire.json`/`questionnaireSha256`, `report.json`/`templateSha256`) are consistent across `packBundle` (Task 1) and `scaffold` (Task 2).
