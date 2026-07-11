import { readdir } from 'node:fs/promises';
import { join, basename, resolve, sep } from 'node:path';
import { isIP } from 'node:net';
import { readBundle, assembleBundle, payloadFileName, verifyBundle, type Bundle, type BundleInvalidReason } from './bundle-fs';
import { parseIndex, type MarketplaceIndexEntry } from './index-json';

// ── SEC-09: registry URL validation (SSRF guard) ──────────────────────────────
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** True if `host` is an IPv4/IPv6 literal in a blocked (private/link-local/ULA) range.
 *  Loopback is intentionally NOT blocked here — it is allowed via the explicit
 *  localhost case in validateRegistryUrl (http-on-loopback dev). */
export function isBlockedIpLiteral(host: string): boolean {
  // Strip IPv6 brackets if present (URL.hostname keeps them for literals).
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const kind = isIP(h);
  if (kind === 4) {
    const parts = h.split('.').map((n) => Number.parseInt(n, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
    const [a, b] = parts;
    if (a === 10) return true;                          // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
    if (a === 192 && b === 168) return true;            // 192.168.0.0/16
    if (a === 169 && b === 254) return true;            // 169.254.0.0/16 (link-local + 169.254.169.254 metadata)
    return false;
  }
  if (kind === 6) {
    const lower = h.toLowerCase();
    // fc00::/7 — unique-local (fc.. or fd..).
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // fe80::/10 — link-local (fe8/fe9/fea/feb).
    if (/^fe[89ab]/.test(lower)) return true;
    return false;
  }
  return false;
}

/**
 * Validate a registry URL and return the parsed URL. Throws on a config/redirect
 * that could drive an SSRF or local-file read:
 *  - scheme must be http: or https:
 *  - http: is allowed ONLY for loopback (localhost/127.0.0.1/[::1]); anything else needs https:
 *  - IP literals in private/link-local/metadata/ULA ranges are rejected
 *
 * NOTE (residual risk): no DNS resolution is performed, so a HOSTNAME that
 * RESOLVES to an internal IP (DNS-rebinding) is not caught here. The admin-gated
 * config + IP-literal + scheme rules are the bounded fix; resolve-and-pin is a
 * possible future hardening.
 */
export function validateRegistryUrl(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`registry URL invalid: ${rawUrl}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`registry URL scheme not allowed: ${u.protocol} (use http or https)`);
  }
  const host = u.hostname.toLowerCase();
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const isLoopback = LOOPBACK_HOSTS.has(bare);
  if (u.protocol === 'http:' && !isLoopback) {
    throw new Error(`registry URL must use https (http allowed only for loopback): ${rawUrl}`);
  }
  if (!isLoopback && isBlockedIpLiteral(host)) {
    throw new Error(`registry URL host is a blocked internal/private address: ${host}`);
  }
  return u;
}

// ── SEC-10: per-response byte caps ────────────────────────────────────────────
const MAX_REDIRECTS = 5;
const INDEX_MAX_BYTES = 1024 * 1024;     // 1 MB
const MANIFEST_MAX_BYTES = 256 * 1024;   // 256 KB
const PUB_MAX_BYTES = 16 * 1024;         // 16 KB
const UI_MAX_BYTES = 8 * 1024 * 1024;    // 8 MB
const DEFAULT_PAYLOAD_MAX_BYTES = 64 * 1024 * 1024; // 64 MB
const MAX_INDEX_PACKAGES = 5000;

/** Read a response body, rejecting if it exceeds `maxBytes`. Checks Content-Length
 *  first (early reject), then validates the actual byte length (defense if the
 *  header lies or is absent). */
async function readCapped(res: Response, maxBytes: number, what: string): Promise<Uint8Array> {
  const lenHeader = res.headers?.get?.('content-length');
  if (lenHeader != null) {
    const declared = Number.parseInt(lenHeader, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`registry ${what} too large: ${declared} bytes exceeds cap ${maxBytes}`);
    }
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new Error(`registry ${what} too large: ${buf.byteLength} bytes exceeds cap ${maxBytes}`);
  }
  return buf;
}

/** Text variant of {@link readCapped}. */
async function readCappedText(res: Response, maxBytes: number, what: string): Promise<string> {
  const lenHeader = res.headers?.get?.('content-length');
  if (lenHeader != null) {
    const declared = Number.parseInt(lenHeader, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`registry ${what} too large: ${declared} bytes exceeds cap ${maxBytes}`);
    }
  }
  const text = await res.text();
  // UTF-8 byte length, not code-unit length, so a lying/absent Content-Length is still bounded.
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) {
    throw new Error(`registry ${what} too large: ${bytes} bytes exceeds cap ${maxBytes}`);
  }
  return text;
}

export interface RegistryListing {
  ref: string;            // safe single segment (local: dir name; http: path basename)
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  description?: string;
  readme?: string;
  license?: string;
  summary?: string;
  signatureFingerprint?: string;
  valid?: boolean;        // computed only for local (which reads bundles); undefined for http
  invalidReason?: BundleInvalidReason; // set only when valid === false (local); the specific failing check
  versions?: { version: string; ref: string }[];
}

/** Compare two semver strings. >0 if a>b, <0 if a<b, 0 equal. Numeric major.minor.patch; a release
 *  outranks a prerelease of the same core (1.0.0 > 1.0.0-rc.1). Inputs are schema-validated semver. */
export function compareSemver(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.split('-', 2);
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { nums, pre: pre ?? null };
  };
  const A = split(a), B = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (A.nums[i] ?? 0) - (B.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (A.pre === B.pre) return 0;
  if (A.pre === null) return 1;
  if (B.pre === null) return -1;
  return A.pre < B.pre ? -1 : 1;
}

/** Group listings by plugin id → one listing per id (highest-semver as the card), with all
 *  { version, ref } attached newest-first. Stable: ids sorted ascending. */
export function collapseByLatest(listings: RegistryListing[]): RegistryListing[] {
  const byId = new Map<string, RegistryListing[]>();
  for (const l of listings) {
    const arr = byId.get(l.id) ?? [];
    arr.push(l);
    byId.set(l.id, arr);
  }
  const out: RegistryListing[] = [];
  for (const id of [...byId.keys()].sort()) {
    const group = byId.get(id)!.slice().sort((x, y) => compareSemver(y.version, x.version));
    const latest = group[0];
    out.push({ ...latest, versions: group.map((g) => ({ version: g.version, ref: g.ref })) });
  }
  return out;
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
  private readonly dir: string;
  /**
   * @param dir  the registry directory to read bundles from.
   * @param root (SEC-09) when non-empty, `dir` must resolve to a path inside this
   *   root (containment). When empty (default), behavior is unchanged — the root is
   *   the opt-in containment mechanism for admin-added local registries.
   */
  constructor(dir: string, root = '') {
    if (root) {
      const resolvedRoot = resolve(root);
      const resolvedDir = resolve(dir);
      const contained = resolvedDir === resolvedRoot || resolvedDir.startsWith(resolvedRoot + sep);
      if (!contained) {
        throw new Error(`local registry dir not contained in root: ${resolvedDir} ∉ ${resolvedRoot}`);
      }
    }
    this.dir = dir;
  }
  get label(): string { return 'local'; }
  refresh(): void { /* no cache */ }

  async list(): Promise<RegistryListing[]> {
    const dirs = (await readdir(this.dir, { withFileTypes: true })).filter((d) => d.isDirectory());
    const out: RegistryListing[] = [];
    for (const d of dirs) {
      try {
        const b = await readBundle(join(this.dir, d.name));
        const v = verifyBundle(b);
        out.push({
          ref: d.name, id: b.manifest.id, version: b.manifest.version, type: b.manifest.type,
          publisher: b.manifest.publisher ?? null, description: b.manifest.description,
          readme: b.manifest.readme,
          license: b.manifest.license, valid: v.valid,
          ...(v.reason ? { invalidReason: v.reason } : {}),
        });
      } catch { /* not a readable bundle dir — skip */ }
    }
    return collapseByLatest(out);
  }

  async getBundle(ref: string): Promise<Bundle> {
    return readBundle(join(this.dir, ref));
  }
}

export class HttpRegistrySource implements RegistrySource {
  readonly kind = 'http' as const;
  private cache: Map<string, MarketplaceIndexEntry> | null = null;
  private readonly payloadMaxBytes: number;
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
    payloadMaxBytes: number = DEFAULT_PAYLOAD_MAX_BYTES,
  ) {
    // SEC-09: reject a bad/internal registry config early (admin-gated, but fail-fast).
    validateRegistryUrl(baseUrl);
    this.payloadMaxBytes = payloadMaxBytes;
  }

  get label(): string {
    try { return new URL(this.baseUrl).host; } catch { return this.baseUrl; }
  }
  refresh(): void { this.cache = null; }

  /**
   * fetch with timeout that follows redirects MANUALLY (SEC-09): every hop — the
   * initial URL and each redirect Location — is re-validated against
   * validateRegistryUrl, so a 30x to an internal/loopback host is rejected before
   * it is ever fetched. Capped at MAX_REDIRECTS hops.
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    let current = validateRegistryUrl(url);
    for (let hop = 0; ; hop++) {
      if (hop > MAX_REDIRECTS) throw new Error('registry fetch: too many redirects');
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(current.toString(), { signal: ac.signal, redirect: 'manual' });
      } finally {
        clearTimeout(timer);
      }
      const isRedirect = res.status >= 300 && res.status < 400;
      const location = isRedirect ? res.headers?.get?.('location') : null;
      if (!isRedirect || !location) return res;
      // Resolve (possibly relative) Location against the current hop, then re-validate.
      current = validateRegistryUrl(new URL(location, current).toString());
    }
  }

  private async loadIndex(): Promise<Map<string, MarketplaceIndexEntry>> {
    if (this.cache) return this.cache;
    const res = await this.fetchWithTimeout(`${this.baseUrl}/index.json`);
    if (!res.ok) throw new Error(`registry unreachable: index.json ${res.status}`);
    const index = parseIndex(JSON.parse(await readCappedText(res, INDEX_MAX_BYTES, 'index.json')));
    if (index.packages.length > MAX_INDEX_PACKAGES) {
      throw new Error(`registry index too large: ${index.packages.length} packages exceeds cap ${MAX_INDEX_PACKAGES}`);
    }
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
      summary: e.summary, readme: e.readme, signatureFingerprint: e.signatureFingerprint,
      versions: [{ version: e.latestVersion, ref }],
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
    const raw = JSON.parse(await readCappedText(manifestRes, MANIFEST_MAX_BYTES, 'manifest.json')) as Record<string, unknown>;
    const kind = String((raw.payload as { kind?: string } | null)?.kind ?? 'plugin');
    const payloadRes = await this.fetchWithTimeout(`${dir}/${payloadFileName(kind)}`);
    if (!payloadRes.ok) throw new Error(`registry unreachable: payload ${payloadRes.status}`);
    const payload = await readCapped(payloadRes, this.payloadMaxBytes, 'payload');
    const pubRes = await this.fetchWithTimeout(`${dir}/publisher.pub`);
    if (!pubRes.ok) throw new Error(`registry unreachable: publisher.pub ${pubRes.status}`);
    const pubHex = await readCappedText(pubRes, PUB_MAX_BYTES, 'publisher.pub');
    const uiEntry = (raw.payload as { ui?: { entry?: string } } | null)?.ui?.entry;
    let ui: Uint8Array | undefined;
    if (uiEntry !== undefined) {
      if (uiEntry !== basename(uiEntry) || uiEntry === '') {
        throw new Error(`invalid ui entry '${uiEntry}': must be a plain filename inside the bundle`);
      }
      const uiRes = await this.fetchWithTimeout(`${dir}/${uiEntry}`);
      if (!uiRes.ok) throw new Error(`registry unreachable: ui asset ${uiRes.status}`);
      ui = await readCapped(uiRes, UI_MAX_BYTES, 'ui asset');
    }
    return assembleBundle(raw, payload, pubHex, ui);
  }
}
