import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { readBundle, assembleBundle, payloadFileName, verifyBundle, type Bundle } from './bundle-fs';
import { parseIndex, type MarketplaceIndexEntry } from './index-json';

export interface RegistryListing {
  ref: string;            // safe single segment (local: dir name; http: path basename)
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  description?: string;
  license?: string;
  summary?: string;
  signatureFingerprint?: string;
  valid?: boolean;        // computed only for local (which reads bundles); undefined for http
}

export interface RegistrySource {
  kind: 'local' | 'http';
  /** A human-friendly host/label for the UI source indicator. */
  label: string;
  /** Drop any cached index so the next list() re-reads. */
  refresh(): void;
  list(): Promise<RegistryListing[]>;
  getBundle(ref: string): Promise<Bundle>;
}

export class LocalRegistrySource implements RegistrySource {
  readonly kind = 'local' as const;
  constructor(private readonly dir: string) {}
  get label(): string { return 'local'; }
  refresh(): void { /* no cache */ }

  async list(): Promise<RegistryListing[]> {
    const dirs = (await readdir(this.dir, { withFileTypes: true })).filter((d) => d.isDirectory());
    const out: RegistryListing[] = [];
    for (const d of dirs) {
      try {
        const b = await readBundle(join(this.dir, d.name));
        out.push({
          ref: d.name, id: b.manifest.id, version: b.manifest.version, type: b.manifest.type,
          publisher: b.manifest.publisher ?? null, description: b.manifest.description,
          license: b.manifest.license, valid: verifyBundle(b).valid,
        });
      } catch { /* not a readable bundle dir — skip */ }
    }
    return out;
  }

  async getBundle(ref: string): Promise<Bundle> {
    return readBundle(join(this.dir, ref));
  }
}

export class HttpRegistrySource implements RegistrySource {
  readonly kind = 'http' as const;
  private cache: Map<string, MarketplaceIndexEntry> | null = null;
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch, private readonly timeoutMs = 15_000) {}

  get label(): string {
    try { return new URL(this.baseUrl).host; } catch { return this.baseUrl; }
  }
  refresh(): void { this.cache = null; }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadIndex(): Promise<Map<string, MarketplaceIndexEntry>> {
    if (this.cache) return this.cache;
    const res = await this.fetchWithTimeout(`${this.baseUrl}/index.json`);
    if (!res.ok) throw new Error(`registry unreachable: index.json ${res.status}`);
    const index = parseIndex(JSON.parse(await res.text()));
    const map = new Map<string, MarketplaceIndexEntry>();
    for (const e of index.packages) map.set(basename(e.path), e);
    this.cache = map;
    return map;
  }

  async list(): Promise<RegistryListing[]> {
    const map = await this.loadIndex();
    return [...map.entries()].map(([ref, e]) => ({
      ref, id: e.id, version: e.latestVersion, type: e.kind,
      publisher: e.publisher ? { id: e.publisher, name: e.publisher } : null,
      summary: e.summary, signatureFingerprint: e.signatureFingerprint,
    }));
  }

  async getBundle(ref: string): Promise<Bundle> {
    const map = await this.loadIndex();
    const entry = map.get(ref);
    if (!entry) throw new Error(`unknown bundle ref: ${ref}`);
    if (/^[a-z]+:\/\//i.test(entry.path) || entry.path.startsWith('/') || entry.path.split(/[\\/]/).includes('..')) {
      throw new Error(`unsafe index path: ${entry.path}`);
    }
    const dir = `${this.baseUrl}/${entry.path}`;
    const manifestRes = await this.fetchWithTimeout(`${dir}/manifest.json`);
    if (!manifestRes.ok) throw new Error(`registry unreachable: manifest ${manifestRes.status}`);
    const raw = JSON.parse(await manifestRes.text()) as Record<string, unknown>;
    const kind = String((raw.payload as { kind?: string } | null)?.kind ?? 'plugin');
    const payloadRes = await this.fetchWithTimeout(`${dir}/${payloadFileName(kind)}`);
    if (!payloadRes.ok) throw new Error(`registry unreachable: payload ${payloadRes.status}`);
    const payload = new Uint8Array(await payloadRes.arrayBuffer());
    const pubRes = await this.fetchWithTimeout(`${dir}/publisher.pub`);
    if (!pubRes.ok) throw new Error(`registry unreachable: publisher.pub ${pubRes.status}`);
    const pubHex = await pubRes.text();
    return assembleBundle(raw, payload, pubHex);
  }
}
