import type { Logger } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { Converter } from '@openldr/ingest';
import {
  parseArtifactManifest,
  pluginManifestToArtifact,
  verifyArtifact,
  keyFingerprint,
  evaluateTrust,
  isCompatible,
  type ArtifactManifest,
  type TrustStore,
} from '@openldr/marketplace';
import { parseManifest, type PluginManifest } from './manifest';
import { sha256Hex } from './hash';
import type { PluginStore, PluginRow } from './store';
import type { PluginRunner } from './runner';
import { createWasmConverter } from './wasm-converter';

export interface MarketplaceInstallAudit {
  action: string;
  entityType: string;
  entityId: string;
  actorType: 'user' | 'system';
  actorId?: string | null;
  actorName: string;
  metadata?: Record<string, unknown>;
}

export interface PluginRuntimeDeps {
  blob: BlobStoragePort;
  store: PluginStore;
  runner: PluginRunner;
  logger: Logger;
  trustStore: TrustStore;
  ceVersion: string;
  verifyConfig: { devAllowUnsigned: boolean; autoPinFirstUse: boolean };
  recordInstall?: (e: MarketplaceInstallAudit) => Promise<void>;
}

export interface InstallOptions {
  publicKeyDer?: Uint8Array;
  actor?: { id?: string | null; name: string };
}

export interface PluginRuntime {
  install(wasm: Uint8Array, rawManifest: unknown, opts?: InstallOptions): Promise<PluginManifest>;
  list(): Promise<PluginRow[]>;
  test(id: string, version?: string): Promise<{ ok: boolean; error?: string }>;
  remove(id: string, version?: string): Promise<void>;
  load(id: string, version?: string): Promise<Converter | undefined>;
}

function wasmKey(id: string, version: string): string {
  return `plugins/${id}/${version}/plugin.wasm`;
}
function manifestKey(id: string, version: string): string {
  return `plugins/${id}/${version}/manifest.json`;
}

function isArtifactManifest(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && 'schemaVersion' in raw && 'payload' in raw;
}

function artifactToPluginManifest(a: ArtifactManifest): PluginManifest {
  const p = a.payload as Extract<ArtifactManifest['payload'], { kind: 'plugin' }>;
  return parseManifest({
    id: a.id,
    version: a.version,
    entrypoint: p.entrypoint,
    wasmSha256: p.wasmSha256,
    description: a.description,
    license: a.license,
    wasi: p.wasi,
    limits: p.limits,
  });
}

export function createPluginRuntime(deps: PluginRuntimeDeps): PluginRuntime {
  const cache = new Map<string, Converter>();

  async function loadWasm(row: PluginRow): Promise<Uint8Array> {
    const wasm = await deps.blob.get(wasmKey(row.id, row.version));
    const actual = sha256Hex(wasm);
    if (actual !== row.sha256) {
      throw new Error(`plugin ${row.id}@${row.version} sha256 mismatch (expected ${row.sha256}, got ${actual})`);
    }
    return wasm;
  }

  async function load(id: string, version?: string): Promise<Converter | undefined> {
    const row = await deps.store.get(id, version);
    if (!row) return undefined;
    const key = `${row.id}@${row.version}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const wasm = await loadWasm(row);
    const converter = createWasmConverter(row.manifest, wasm, deps.runner, deps.logger);
    cache.set(key, converter);
    return converter;
  }

  return {
    async install(wasm, rawManifest, opts = {}) {
      // Accept either a new artifact manifest or a legacy plugin manifest.
      // Preserve the raw object for signature verification (canonical bytes must match what was signed).
      const isArtifact = isArtifactManifest(rawManifest);
      const artifact: ArtifactManifest = isArtifact
        ? parseArtifactManifest(rawManifest)
        : pluginManifestToArtifact(rawManifest as never);

      if (artifact.payload.kind !== 'plugin') {
        throw new Error(`install: only plugin artifacts are wired in SP-1 (got ${artifact.payload.kind})`);
      }

      const payloadSha = sha256Hex(wasm);
      if (payloadSha !== artifact.payload.wasmSha256) {
        throw new Error(`manifest wasmSha256 (${artifact.payload.wasmSha256}) does not match the wasm (${payloadSha})`);
      }

      // Compatibility gate.
      if (!isCompatible(artifact.compatibility.ceVersion, deps.ceVersion)) {
        throw new Error(
          `artifact ${artifact.id}@${artifact.version} is not compatible with CE ${deps.ceVersion} (requires ${artifact.compatibility.ceVersion})`,
        );
      }

      // Signature + trust (only when a publisher is declared).
      let signatureVerified = false;
      if (artifact.publisher) {
        const pub = artifact.publisher;
        const hasKey = !!opts.publicKeyDer;
        // Verify against the raw manifest so canonical bytes match what was signed before zod defaults were applied.
        const rawForVerify = isArtifact ? (rawManifest as Record<string, unknown>) : (artifact as unknown as Record<string, unknown>);
        const verified =
          hasKey &&
          keyFingerprint(opts.publicKeyDer!) === pub.keyFingerprint &&
          verifyArtifact(rawForVerify, payloadSha, opts.publicKeyDer!);

        if (!verified) {
          if (!deps.verifyConfig.devAllowUnsigned) {
            throw new Error(`artifact ${artifact.id}@${artifact.version}: invalid or missing signature for publisher ${pub.id}`);
          }
        } else {
          signatureVerified = true;
          const fingerprint = keyFingerprint(opts.publicKeyDer!);
          const trust = evaluateTrust(pub.id, fingerprint, await deps.trustStore.get(pub.id));
          if (trust.decision === 'key-mismatch') {
            throw new Error(`artifact ${artifact.id}: publisher ${pub.id} key fingerprint does not match the pinned key`);
          }
          if (trust.decision === 'first-use' && deps.verifyConfig.autoPinFirstUse) {
            await deps.trustStore.pin({
              publisherId: pub.id,
              keyFingerprint: fingerprint,
              publisherName: pub.name,
              approvedBy: opts.actor?.id ?? null,
            });
          }
        }
      }

      // Persist (legacy plugin manifest shape is what the store/runner expect).
      const pluginManifest = artifactToPluginManifest(artifact);
      await deps.blob.put(wasmKey(artifact.id, artifact.version), wasm, 'application/wasm');
      await deps.blob.put(
        manifestKey(artifact.id, artifact.version),
        new TextEncoder().encode(JSON.stringify(pluginManifest)),
        'application/json',
      );
      await deps.store.upsert({ id: artifact.id, version: artifact.version, sha256: payloadSha, manifest: pluginManifest });
      cache.delete(`${artifact.id}@${artifact.version}`);
      deps.logger.info({ id: artifact.id, version: artifact.version }, 'plugin installed');

      if (deps.recordInstall) {
        await deps.recordInstall({
          action: 'marketplace.install',
          entityType: 'artifact',
          entityId: `${artifact.id}@${artifact.version}`,
          actorType: opts.actor ? 'user' : 'system',
          actorId: opts.actor?.id ?? null,
          actorName: opts.actor?.name ?? 'system',
          metadata: {
            type: artifact.type,
            publisherId: artifact.publisher?.id ?? null,
            capabilities: artifact.capabilities,
            signatureVerified,
          },
        });
      }

      return pluginManifest;
    },
    list: () => deps.store.list(),
    async test(id, version) {
      try {
        const c = await load(id, version);
        if (!c) return { ok: false, error: 'plugin not installed' };
        await c.convert(new Uint8Array(), { batchId: 'plugin-test' });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    remove: (id, version) => deps.store.remove(id, version),
    load,
  };
}
