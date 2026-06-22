import { mkdir, writeFile, readFile, access, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, createPublicKey } from 'node:crypto';
import { execSync } from 'node:child_process';
import {
  generatePublisherKeypair,
  scaffold,
  type ArtifactType,
  packBundle,
  readBundle,
  verifyBundle,
  parseArtifactManifest,
  readGrant,
  allowedHosts,
} from '@openldr/marketplace';
import { createWasmConverter, createExtismRunner, type PluginRunner } from '@openldr/plugins';
import { createIngestContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { redactError } from './redact-error';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface JsonOpt { json: boolean }

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

const PAYLOAD_FILE: Record<string, string> = {
  plugin: 'plugin.wasm',
  'form-template': 'questionnaire.json',
  'report-template': 'report.json',
};

// ---------------------------------------------------------------------------
// Task 3 — keygen + new
// ---------------------------------------------------------------------------

export async function runArtifactKeygen(
  opts: JsonOpt & { out: string; force?: boolean },
): Promise<number> {
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
    emit(
      opts.json,
      { fingerprint: kp.fingerprint, out: opts.out },
      `publisher key written to ${opts.out}\n  fingerprint ${kp.fingerprint}`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`artifact keygen failed: ${redactError(err)}\n`);
    return 1;
  }
}

export async function runArtifactNew(
  type: string,
  name: string,
  opts: JsonOpt & { out?: string; publisherId?: string; sdkPath?: string; sdkGit?: string },
): Promise<number> {
  try {
    if (!['plugin', 'form', 'report'].includes(type)) {
      process.stderr.write(`unknown artifact type: ${type}\n`);
      return 1;
    }
    const files = scaffold(type as ArtifactType, name, {
      publisherId: opts.publisherId,
      sdkPath: opts.sdkPath,
      sdkGit: opts.sdkGit,
    });
    const base = join(opts.out ?? '.', name);
    for (const [rel, content] of Object.entries(files)) {
      const full = join(base, rel);
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, content);
    }
    emit(
      opts.json,
      { created: base, files: Object.keys(files) },
      `scaffolded ${type} '${name}' at ${base}`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`artifact new failed: ${redactError(err)}\n`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Task 4 — pack + sign + publish
// ---------------------------------------------------------------------------

/** Read the private key hex from a file and derive or read the public key. */
async function readKeyPair(
  privPath: string,
): Promise<{ privateKeyDer: Uint8Array; publicKeyDer: Uint8Array }> {
  const privHex = (await readFile(privPath, 'utf8')).trim();
  const privateKeyDer = Buffer.from(privHex, 'hex');

  // Prefer the sibling publisher.pub; fall back to deriving from the private key.
  const pubPath = join(privPath, '..', 'publisher.pub');
  if (await exists(pubPath)) {
    const pubHex = (await readFile(pubPath, 'utf8')).trim();
    return { privateKeyDer, publicKeyDer: Buffer.from(pubHex, 'hex') };
  }

  // createPublicKey accepts a pkcs8 DER private key at runtime; cast via unknown to satisfy TS types.
  const publicKeyDer = createPublicKey(
    { key: Buffer.from(privateKeyDer), format: 'der', type: 'pkcs8' } as unknown as Parameters<typeof createPublicKey>[0],
  ).export({ type: 'spki', format: 'der' }) as Buffer;
  return { privateKeyDer, publicKeyDer };
}

export async function runArtifactPack(
  dir: string,
  opts: JsonOpt & { key: string; out?: string },
): Promise<number> {
  try {
    const manifestRaw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const payloadKind = String((manifestRaw.payload as Record<string, unknown>)?.kind ?? '');
    const payloadFile = PAYLOAD_FILE[payloadKind];
    if (!payloadFile) throw new Error(`unsupported payload kind: ${payloadKind}`);
    const payload = new Uint8Array(await readFile(join(dir, payloadFile)));
    const { privateKeyDer, publicKeyDer } = await readKeyPair(opts.key);
    const outDir = opts.out ?? join(dir, 'dist');
    const result = await packBundle({
      manifest: manifestRaw,
      payload,
      outDir,
      privateKeyDer,
      publicKeyDer,
    });
    emit(
      opts.json,
      { bundleDir: result.bundleDir, fingerprint: result.fingerprint, id: result.manifest.id, version: result.manifest.version },
      `packed ${result.manifest.id}@${result.manifest.version}  fingerprint=${result.fingerprint}  -> ${result.bundleDir}`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`artifact pack failed: ${redactError(err)}\n`);
    return 1;
  }
}

/** sign = pack in-place (out = dir) */
export async function runArtifactSign(
  dir: string,
  opts: JsonOpt & { key: string },
): Promise<number> {
  return runArtifactPack(dir, { ...opts, out: dir });
}

export async function runArtifactPublish(
  bundleDir: string,
  opts: JsonOpt & {
    to: string;
    install?: boolean;
    approve?: boolean;
    approvedBy?: string;
  },
): Promise<number> {
  let bundle;
  try {
    bundle = await readBundle(bundleDir);
  } catch (err) {
    process.stderr.write(`artifact publish failed: cannot read bundle: ${redactError(err)}\n`);
    return 1;
  }

  const result = verifyBundle(bundle);
  if (!result.valid) {
    process.stderr.write(`artifact publish failed: bundle signature is invalid\n`);
    return 1;
  }

  try {
    const { id, version } = bundle.manifest;
    const dest = join(opts.to, id, version);
    await cp(bundleDir, dest, { recursive: true });

    if (opts.install) {
      const ctx = await createIngestContext(loadConfig());
      try {
        const approval = opts.approve
          ? {
              approvedBy: opts.approvedBy ?? 'cli',
              acknowledgedCapabilities: bundle.manifest.capabilities,
            }
          : undefined;
        const installed = await ctx.plugins.install(bundle.wasm, bundle.raw, {
          publicKeyDer: bundle.publicKeyDer,
          actor: { name: 'cli' },
          approval,
        });
        emit(
          opts.json,
          { published: dest, installed: `${installed.id}@${installed.version}` },
          `published to ${dest}  installed ${installed.id}@${installed.version}`,
        );
      } finally {
        await ctx.close();
      }
    } else {
      emit(opts.json, { published: dest }, `published to ${dest}`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`artifact publish failed: ${redactError(err)}\n`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Task 5 — test (in-process grant dry-run) + build
// ---------------------------------------------------------------------------

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
} as unknown as import('@openldr/core').Logger;

export async function runArtifactTest(
  dir: string,
  opts: JsonOpt & { sample: string },
  runner: PluginRunner = createExtismRunner(),
): Promise<number> {
  try {
    const manifestRaw = JSON.parse(
      await readFile(join(dir, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    const manifest = parseArtifactManifest(manifestRaw);

    if (manifest.payload.kind !== 'plugin') {
      process.stderr.write(`artifact test: only plugin artifacts are testable\n`);
      return 1;
    }

    const wasm = new Uint8Array(await readFile(join(dir, 'plugin.wasm')));
    const sample = new Uint8Array(await readFile(opts.sample));
    const grant = readGrant(manifestRaw);

    // Build the PluginManifest (packages/plugins shape) from the artifact manifest payload.
    const { entrypoint, wasi, limits } = manifest.payload;
    const { createHash: _createHash } = await import('node:crypto');
    const wasmSha256 = _createHash('sha256').update(wasm).digest('hex');
    const pluginManifest = {
      id: manifest.id,
      version: manifest.version,
      entrypoint: entrypoint ?? 'convert',
      wasi: wasi ?? false,
      wasmSha256,
      description: manifest.description ?? '',
      license: manifest.license ?? 'UNLICENSED',
      limits: limits ?? { memoryMb: 256, timeoutMs: 30_000 },
    };

    const capabilities = grant.legacy ? undefined : grant.capabilities;
    const egress = grant.legacy ? [] : allowedHosts(grant.capabilities);
    const converter = createWasmConverter(pluginManifest, wasm, runner, silentLogger, capabilities);

    const resources = await converter.convert(sample, { batchId: 'artifact-test' });
    const emittedTypes = [...new Set(resources.map((r) => (r as { resourceType?: string }).resourceType ?? 'unknown'))];
    emit(
      opts.json,
      { passed: true, emittedTypes, allowedEgressHosts: egress },
      `artifact test PASSED  emitted=[${emittedTypes.join(', ')}]  egress=[${egress.join(', ')}]`,
    );
    return 0;
  } catch (err) {
    const msg = redactError(err);
    emit(opts.json, { passed: false, error: msg }, `artifact test FAILED: ${msg}`);
    return 1;
  }
}

export async function runArtifactBuild(
  dir: string,
  opts: JsonOpt & { _env?: NodeJS.ProcessEnv },
): Promise<number> {
  try {
    const manifestRaw = JSON.parse(
      await readFile(join(dir, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    const manifest = parseArtifactManifest(manifestRaw);

    if (manifest.payload.kind === 'plugin') {
      // Read crate name from Cargo.toml (name = "...") to find the wasm output.
      const cargoToml = await readFile(join(dir, 'Cargo.toml'), 'utf8');
      const nameMatch = cargoToml.match(/^name\s*=\s*"([^"]+)"/m);
      if (!nameMatch) throw new Error('cannot find crate name in Cargo.toml');
      const crateName = nameMatch[1].replace(/-/g, '_');
      const env = opts._env ?? process.env;
      execSync('cargo build --release --target wasm32-wasip1', {
        cwd: dir,
        stdio: 'inherit',
        env,
      });
      const wasmSrc = join(dir, 'target', 'wasm32-wasip1', 'release', `${crateName}.wasm`);
      const wasmDest = join(dir, 'plugin.wasm');
      const wasmBytes = await readFile(wasmSrc);
      await writeFile(wasmDest, wasmBytes);
      const sha = createHash('sha256').update(wasmBytes).digest('hex');
      emit(opts.json, { staged: wasmDest, sha256: sha }, `built and staged ${wasmDest}  sha256=${sha}`);
    } else {
      // Form or report: validate that the payload JSON parses.
      const payloadFile = PAYLOAD_FILE[manifest.payload.kind];
      const payloadBytes = await readFile(join(dir, payloadFile), 'utf8');
      JSON.parse(payloadBytes); // throws on invalid JSON
      const sha = createHash('sha256').update(payloadBytes).digest('hex');
      emit(
        opts.json,
        { validated: payloadFile, sha256: sha },
        `validated ${payloadFile}  sha256=${sha}`,
      );
    }
    return 0;
  } catch (err) {
    process.stderr.write(`artifact build failed: ${redactError(err)}\n`);
    return 1;
  }
}
