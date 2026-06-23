# DHIS2 Sink Plugin — SP-1: Sink-Plugin ABI + Host Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `sink` plugin flavor to the WASM plugin system — a manifest `kind` + named `entrypoints`, a host-side `WasmSink` wrapper that invokes a named entrypoint with JSON in/out + per-call config + pinned egress hosts, and a `loadSink()` runtime resolver — proven by a trivial Rust test-sink that loads and `invoke()`s through the runtime.

**Architecture:** Sinks reuse the *entire* existing plugin pipeline (store, blob, SHA-256 verify, capability grant, Extism runner) and differ only in shape: a source exports one `convert(bytes)->NDJSON` entrypoint; a sink exports several named entrypoints, each `JSON bytes -> JSON bytes`. The manifest gains `kind:"source"|"sink"` (default `"source"`, so every existing manifest is unchanged) and `entrypoints:string[]`. A new `createWasmSink()` mirrors `createWasmConverter()` but serializes/deserializes JSON and gates egress fail-closed against the `net-egress` capability. The runner already accepts `entrypoint`/`config`/`allowedHosts`, so no runner change is needed.

**Tech Stack:** TypeScript (zod schemas, vitest), Rust → `wasm32-wasip1` (Extism PDK), `@extism/extism` host SDK, pnpm workspaces + turbo.

---

## Context for the implementer (read first)

This is **SP-1 of 6** in the DHIS2-sink-plugin workstream. Full design: `docs/superpowers/specs/2026-06-23-dhis2-sink-plugin-connectors-design.md`. SP-1 builds layers **L1 (ABI/SDK/manifest)** + **L2 (sink host runtime)**. It does **not** touch DHIS2 logic, connectors, crypto, or UI — those are SP-2…SP-5.

Key existing files you will mirror:
- `packages/plugins/src/manifest.ts` — flat plugin manifest zod schema.
- `packages/plugins/src/wasm-converter.ts` — the **source** wrapper. `createWasmSink` is its sibling.
- `packages/plugins/src/runtime.ts` — `createPluginRuntime`; has `load()` (returns a `Converter`). You add `loadSink()`.
- `packages/plugins/src/runner.ts` / `extism-runner.ts` — the runner interface + real Extism impl. **Already** supports `entrypoint`, `config`, `allowedHosts`. Do not change.
- `packages/marketplace/src/artifact-manifest.ts` — the signed artifact manifest. Its `pluginPayload` must carry the new fields so installs round-trip them.
- `packages/marketplace/src/grant.ts` / `capabilities.ts` — `readGrant()`, `allowedHosts()`, the `net-egress` capability.
- `wasm/tabular/` — the simplest pure-Rust reference plugin; `wasm/test-sink` mirrors its Cargo layout.
- `scripts/build-wasm-plugins.mjs` (function `buildPure`) — the build/stage pattern `scripts/build-test-sink.mjs` mirrors.

**Naming gotcha:** the artifact payload's discriminator is already `kind: z.literal('plugin')`. So inside the artifact payload the source/sink flavor is named **`pluginKind`** to avoid collision; in the flat `PluginManifest` it is named **`kind`** (no collision there, matches the spec). The adapter functions translate between the two.

**Testing posture:** the JS gate (`turbo test`) stays **hermetic** — every gate test uses a fake `PluginRunner`, never a real `.wasm` (matches `integration.test.ts`). The one real-Extism test (Task 6) is **skip-guarded** on the built wasm being present, so the gate is green without the Rust/wasm toolchain. The real ABI is validated when a dev runs `pnpm build:test-sink` first.

---

## File Structure

**Created:**
- `packages/plugins/src/wasm-sink.ts` — `WasmSink` interface + `createWasmSink()`. JSON-in/JSON-out invoke, entrypoint validation, fail-closed egress.
- `packages/plugins/src/wasm-sink.test.ts` — hermetic unit tests for `createWasmSink` (fake runner).
- `packages/plugins/src/wasm-sink.integration.test.ts` — skip-guarded real-Extism test against the built test-sink.
- `wasm/test-sink/Cargo.toml` + `wasm/test-sink/src/lib.rs` — trivial Rust sink (`health_check` + `push_aggregate` echo).
- `scripts/build-test-sink.mjs` — builds + stages `reference-plugins/test-sink/{plugin.wasm,manifest.json}`.

**Modified:**
- `packages/plugins/src/manifest.ts` — add `kind` + `entrypoints` to the flat schema.
- `packages/plugins/src/manifest.test.ts` — defaults + sink-manifest cases.
- `packages/plugins/src/runtime.ts` — `artifactToPluginManifest` carries the new fields; add `loadSink()` + sink cache; invalidate both caches.
- `packages/plugins/src/runtime.test.ts` — `loadSink` cases.
- `packages/plugins/src/index.ts` — export `wasm-sink`.
- `packages/marketplace/src/artifact-manifest.ts` — `pluginPayload` gains `pluginKind` + `entrypoints`; `LegacyPluginManifest` + `pluginManifestToArtifact` map them through.
- `packages/marketplace/src/artifact-manifest.test.ts` — sink payload + legacy-sink normalization cases (file is already modified in the working tree; append to it).
- `wasm/openldr-plugin-sdk/src/lib.rs` — a documented `to_json_string` sink helper + test.
- `wasm/Cargo.toml` — add `test-sink` to workspace members.
- `package.json` (root) — add `build:test-sink` script.

---

## Task 1: Flat manifest — add `kind` + `entrypoints`

**Files:**
- Modify: `packages/plugins/src/manifest.ts`
- Test: `packages/plugins/src/manifest.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugins/src/manifest.test.ts` (inside the existing `describe('parseManifest', ...)`, before the closing `});`):

```ts
  it('defaults kind to source and entrypoints to []', () => {
    const m = parseManifest(valid);
    expect(m.kind).toBe('source');
    expect(m.entrypoints).toEqual([]);
  });
  it('parses a sink manifest with named entrypoints', () => {
    const m = parseManifest({ ...valid, kind: 'sink', entrypoints: ['health_check', 'push_aggregate'] });
    expect(m.kind).toBe('sink');
    expect(m.entrypoints).toEqual(['health_check', 'push_aggregate']);
  });
  it('rejects an unknown kind', () => {
    expect(() => parseManifest({ ...valid, kind: 'proxy' })).toThrow();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/plugins test manifest`
Expected: FAIL — `m.kind` is `undefined` (`expected undefined to be 'source'`).

- [ ] **Step 3: Add the fields to the schema**

In `packages/plugins/src/manifest.ts`, insert the two fields into `pluginManifestSchema` (after `version`, before `entrypoint`):

```ts
export const pluginManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  // Plugin flavor. 'source' = the classic convert(bytes)->NDJSON ingest plugin (the
  // default, so every existing manifest stays a source unchanged). 'sink' = exports
  // the named `entrypoints` below (JSON bytes -> JSON bytes), invoked via the sink runtime.
  kind: z.enum(['source', 'sink']).default('source'),
  entrypoint: z.string().min(1).default('convert'),
  // Named entrypoints a sink exports (e.g. health_check, pull_metadata, push_aggregate,
  // push_tracker). Empty for sources. The sink runtime refuses to invoke a name not listed.
  entrypoints: z.array(z.string().min(1)).default([]),
  wasmSha256: z.string().regex(/^[0-9a-f]{64}$/, 'wasmSha256 must be a 64-char hex digest'),
  description: z.string().default(''),
  license: z.string().default('UNLICENSED'),
  wasi: z.boolean().default(false),
  limits: z
    .object({ memoryMb: z.number().int().positive().default(256), timeoutMs: z.number().int().positive().default(30_000) })
    .default({ memoryMb: 256, timeoutMs: 30_000 }),
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C packages/plugins test manifest`
Expected: PASS (all `parseManifest` tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/src/manifest.ts packages/plugins/src/manifest.test.ts
git commit -m "$(cat <<'EOF'
feat(plugins): add kind + entrypoints to the plugin manifest schema

Sink plugins declare kind:"sink" and the named entrypoints they export.
Default kind:"source" keeps every existing manifest unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Artifact payload — carry `pluginKind` + `entrypoints` through install

The install path force-normalizes every manifest into an `ArtifactManifest`. If the payload drops `pluginKind`/`entrypoints`, an installed sink loses its flavor and `loadSink()` can't find its entrypoints. This task makes the artifact schema carry them and the adapters translate `kind` ↔ `pluginKind`.

**Files:**
- Modify: `packages/marketplace/src/artifact-manifest.ts`
- Modify: `packages/plugins/src/runtime.ts` (function `artifactToPluginManifest`, lines ~78-90)
- Test: `packages/marketplace/src/artifact-manifest.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/marketplace/src/artifact-manifest.test.ts` (inside `describe('artifact manifest', ...)`, before its closing `});`):

```ts
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
  it('carries kind + entrypoints through legacy→artifact normalization for a sink', () => {
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/marketplace test artifact-manifest`
Expected: FAIL — `p.pluginKind` is `undefined`.

- [ ] **Step 3: Extend `pluginPayload` and the legacy adapter**

In `packages/marketplace/src/artifact-manifest.ts`, replace `pluginPayload` and update `LegacyPluginManifest` + `pluginManifestToArtifact`:

```ts
const pluginPayload = z.object({
  kind: z.literal('plugin'),
  // Source/sink flavor. Named `pluginKind` because this object's own discriminator is
  // already `kind: 'plugin'`. Maps to the flat manifest's `kind`. Default 'source' keeps
  // every existing (signed) plugin artifact byte-identical and verifying.
  pluginKind: z.enum(['source', 'sink']).default('source'),
  wasmSha256: z.string().regex(HEX64),
  entrypoint: z.string().min(1).default('convert'),
  // Named entrypoints a sink exports; empty for sources.
  entrypoints: z.array(z.string().min(1)).default([]),
  wasi: z.boolean().default(false),
  limits: z.object({ memoryMb: z.number().int().positive().default(256), timeoutMs: z.number().int().positive().default(30_000) })
    .default({ memoryMb: 256, timeoutMs: 30_000 }),
});
```

Update the `LegacyPluginManifest` interface — add `kind` and `entrypoints`:

```ts
export interface LegacyPluginManifest {
  id: string; version: string; kind?: 'source' | 'sink'; entrypoint?: string; entrypoints?: string[];
  wasmSha256: string; description?: string; license?: string; wasi?: boolean;
  limits?: { memoryMb: number; timeoutMs: number };
  capabilities?: unknown;
}
```

Update `pluginManifestToArtifact`'s `payload` to map the new fields:

```ts
    payload: {
      kind: 'plugin',
      pluginKind: m.kind ?? 'source',
      wasmSha256: m.wasmSha256,
      entrypoint: m.entrypoint ?? 'convert',
      entrypoints: m.entrypoints ?? [],
      wasi: m.wasi ?? false,
      limits: m.limits ?? { memoryMb: 256, timeoutMs: 30_000 },
    },
```

- [ ] **Step 4: Map the fields back in the plugins runtime adapter**

In `packages/plugins/src/runtime.ts`, update `artifactToPluginManifest` (~line 78) so the flat manifest derived from an artifact keeps the flavor + entrypoints:

```ts
function artifactToPluginManifest(a: ArtifactManifest): PluginManifest {
  const p = a.payload as Extract<ArtifactManifest['payload'], { kind: 'plugin' }>;
  return parseManifest({
    id: a.id,
    version: a.version,
    kind: p.pluginKind,
    entrypoint: p.entrypoint,
    entrypoints: p.entrypoints,
    wasmSha256: p.wasmSha256,
    description: a.description,
    license: a.license,
    wasi: p.wasi,
    limits: p.limits,
  });
}
```

- [ ] **Step 5: Run the marketplace + plugins suites to verify green**

Run: `pnpm -C packages/marketplace test artifact-manifest && pnpm -C packages/plugins test`
Expected: PASS. The pre-existing `adapts a legacy plugin manifest` and `f48b571` regression tests still pass (they use `toMatchObject`/check `capabilities`, unaffected by the added optional fields).

- [ ] **Step 6: Commit**

```bash
git add packages/marketplace/src/artifact-manifest.ts packages/marketplace/src/artifact-manifest.test.ts packages/plugins/src/runtime.ts
git commit -m "$(cat <<'EOF'
feat(marketplace): carry pluginKind + entrypoints through the artifact payload

Installs normalize every manifest into an ArtifactManifest; the payload now
preserves a sink's flavor and named entrypoints so loadSink() can resolve them.
Defaults keep existing signed source-plugin artifacts byte-identical.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `createWasmSink` — the host-side sink wrapper

**Files:**
- Create: `packages/plugins/src/wasm-sink.ts`
- Test: `packages/plugins/src/wasm-sink.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/plugins/src/wasm-sink.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import type { PluginRunner } from './runner';

const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
const sinkManifest = parseManifest({
  id: 'dhis2-sink', version: '0.1.0', kind: 'sink',
  entrypoints: ['health_check', 'push_aggregate'], wasmSha256: 'a'.repeat(64),
});
const enc = (s: string) => new TextEncoder().encode(s);

function runnerReturning(text: string): PluginRunner {
  return { run: vi.fn(async () => enc(text)) };
}

describe('createWasmSink', () => {
  it('serializes input to JSON, invokes the named entrypoint, parses JSON output', async () => {
    const runner = runnerReturning('{"ok":true,"version":"2.40"}');
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger);
    const out = await sink.invoke('health_check', { ping: 1 });
    expect(out).toEqual({ ok: true, version: '2.40' });
    const call = (runner.run as any).mock.calls[0];
    expect(call[2].entrypoint).toBe('health_check');
    expect(new TextDecoder().decode(call[1])).toBe('{"ping":1}');
  });

  it('returns {} for empty/blank output', async () => {
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runnerReturning('  \n'), logger);
    expect(await sink.invoke('health_check', {})).toEqual({});
  });

  it('rejects an unknown entrypoint without calling the runner', async () => {
    const runner = runnerReturning('{}');
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger);
    await expect(sink.invoke('drop_table', {})).rejects.toThrow(/unknown entrypoint/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('throws a clear error on invalid JSON output', async () => {
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runnerReturning('not json'), logger);
    await expect(sink.invoke('health_check', {})).rejects.toThrow(/invalid JSON/);
  });

  it('passes config and pinned allowedHosts through to the runner', async () => {
    const grant = [{ kind: 'net-egress', allowedHosts: [] }] as any;
    const runner = runnerReturning('{}');
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger, grant);
    await sink.invoke('push_aggregate', { rows: [] }, { config: { baseUrl: 'https://x' }, allowedHosts: ['x:443'] });
    const opts = (runner.run as any).mock.calls[0][2];
    expect(opts.config).toEqual({ baseUrl: 'https://x' });
    expect(opts.allowedHosts).toEqual(['x:443']);
  });

  it('fail-closes when a host is pinned but the plugin lacks net-egress', async () => {
    const grant = [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] as any; // no net-egress
    const runner = runnerReturning('{}');
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger, grant);
    await expect(sink.invoke('push_aggregate', {}, { allowedHosts: ['x:443'] })).rejects.toThrow(/net-egress/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('allows dry-run (no pinned host) even without net-egress', async () => {
    const grant = [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] as any;
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runnerReturning('{"payload":{"dataValues":[]}}'), logger, grant);
    expect(await sink.invoke('push_aggregate', { rows: [] })).toEqual({ payload: { dataValues: [] } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/plugins test wasm-sink`
Expected: FAIL — cannot import `./wasm-sink` (module does not exist).

- [ ] **Step 3: Implement `createWasmSink`**

Create `packages/plugins/src/wasm-sink.ts`:

```ts
import type { Logger } from '@openldr/core';
import type { Capability } from '@openldr/marketplace';
import type { PluginManifest } from './manifest';
import type { PluginRunner, RunnerHostFns } from './runner';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface SinkInvokeOptions {
  /** Extism config map — the per-call connection/secrets (e.g. baseUrl, username, password). */
  config?: Record<string, string>;
  /** Concrete egress host(s) the connector pins for this call, e.g. ['dhis2.example.org:443'].
   *  Omit/empty for a dry-run (no network). */
  allowedHosts?: string[];
}

/** A loaded sink plugin: invoke one of its named entrypoints with a JSON request,
 *  get back the parsed JSON response. Mirrors `Converter` for sinks. */
export interface WasmSink {
  id: string;
  version: string;
  entrypoints: string[];
  invoke(entrypoint: string, input: unknown, opts?: SinkInvokeOptions): Promise<unknown>;
}

export function createWasmSink(
  manifest: PluginManifest,
  wasm: Uint8Array,
  runner: PluginRunner,
  logger: Logger,
  grant?: Capability[],
): WasmSink {
  const host: RunnerHostFns = {
    log(level, msg) {
      const fn = (logger as unknown as Record<string, (o: unknown, m?: string) => void>)[level] ?? logger.info;
      fn.call(logger, { plugin: manifest.id }, msg);
    },
    progress(done, total) {
      logger.debug({ plugin: manifest.id, done, total }, 'sink progress');
    },
  };
  // `grant === undefined` = a genuinely pre-capability (grandfathered) row → unrestricted.
  // Any installed sink carries a grant array, so egress is gated on the net-egress capability.
  const enforced = grant !== undefined;
  const hasNetEgress = enforced && grant.some((c) => c.kind === 'net-egress');

  return {
    id: manifest.id,
    version: manifest.version,
    entrypoints: manifest.entrypoints,
    async invoke(entrypoint: string, input: unknown, opts: SinkInvokeOptions = {}): Promise<unknown> {
      if (!manifest.entrypoints.includes(entrypoint)) {
        throw new Error(
          `sink ${manifest.id}: unknown entrypoint '${entrypoint}' (declared: ${manifest.entrypoints.join(', ') || 'none'})`,
        );
      }
      // Fail-closed egress: a host may only be pinned if the plugin declared net-egress intent.
      if (opts.allowedHosts && opts.allowedHosts.length > 0 && enforced && !hasNetEgress) {
        throw new Error(
          `sink ${manifest.id}: egress to ${opts.allowedHosts.join(', ')} requested but the plugin has no net-egress capability`,
        );
      }
      const out = await runner.run(wasm, encoder.encode(JSON.stringify(input ?? {})), {
        entrypoint,
        wasi: manifest.wasi,
        memoryMb: manifest.limits.memoryMb,
        timeoutMs: manifest.limits.timeoutMs,
        config: opts.config,
        host,
        allowedHosts: opts.allowedHosts,
      });
      const text = decoder.decode(out).trim();
      if (!text) return {};
      try {
        return JSON.parse(text) as unknown;
      } catch (err) {
        throw new Error(
          `sink ${manifest.id} entrypoint '${entrypoint}' returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C packages/plugins test wasm-sink`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/src/wasm-sink.ts packages/plugins/src/wasm-sink.test.ts
git commit -m "$(cat <<'EOF'
feat(plugins): add createWasmSink host wrapper for sink plugins

Invokes a named entrypoint with JSON in/out, passes per-call config + pinned
egress hosts to the runner, validates the entrypoint, and fail-closes egress
when the plugin lacks the net-egress capability.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `loadSink()` on the plugin runtime

**Files:**
- Modify: `packages/plugins/src/runtime.ts`
- Test: `packages/plugins/src/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block at the end of `packages/plugins/src/runtime.test.ts` (after the last `});`). It reuses the file's existing `fakeStore`, `fakeBlob`, `okRunner`, `defaultNewDeps`, `fullManifest`, `wasm`, `sha`, `enc`, `logger` helpers:

```ts
describe('loadSink', () => {
  const sinkWasm = new TextEncoder().encode('\0asm sink bytes');
  const sinkSha = sha256Hex(sinkWasm);
  const sinkRow: PluginRow = {
    id: 'dhis2-sink', version: '0.1.0', sha256: sinkSha,
    manifest: {
      id: 'dhis2-sink', version: '0.1.0', kind: 'sink', entrypoint: 'convert',
      entrypoints: ['health_check', 'push_aggregate'], wasmSha256: sinkSha,
      description: '', license: 'x', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 },
      capabilities: [{ kind: 'net-egress', allowedHosts: [] }],
    },
    status: 'installed', enabled: true, active: true, approvedBy: null,
  };

  it('loads a sink and invoke() round-trips JSON through the runner', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/dhis2-sink/0.1.0/plugin.wasm', sinkWasm]]);
    const store = fakeStore([sinkRow]);
    const runner: PluginRunner = { run: vi.fn(async () => enc('{"ok":true}')) };
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner, logger, ...defaultNewDeps() });
    const sink = await rt.loadSink('dhis2-sink');
    expect(sink?.id).toBe('dhis2-sink');
    expect(sink?.entrypoints).toEqual(['health_check', 'push_aggregate']);
    expect(await sink!.invoke('health_check', {})).toEqual({ ok: true });
  });

  it('returns undefined for an unknown sink', async () => {
    const rt = createPluginRuntime({ blob: fakeBlob(new Map()), store: fakeStore(), runner: okRunner, logger, ...defaultNewDeps() });
    expect(await rt.loadSink('nope')).toBeUndefined();
  });

  it('throws when loadSink targets a source plugin', async () => {
    const store = fakeStore([{ id: 'demo', version: '0.1.0', sha256: sha, manifest: fullManifest(), status: 'installed', enabled: true, active: true, approvedBy: null }]);
    const rt = createPluginRuntime({ blob: fakeBlob(new Map()), store, runner: okRunner, logger, ...defaultNewDeps() });
    await expect(rt.loadSink('demo')).rejects.toThrow(/not a sink/);
  });

  it('caches the loaded sink (one blob fetch across two loads)', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/dhis2-sink/0.1.0/plugin.wasm', sinkWasm]]);
    const blob = fakeBlob(blobMap);
    const store = fakeStore([sinkRow]);
    const rt = createPluginRuntime({ blob, store, runner: okRunner, logger, ...defaultNewDeps() });
    await rt.loadSink('dhis2-sink');
    await rt.loadSink('dhis2-sink');
    expect((blob.get as any).mock.calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/plugins test runtime`
Expected: FAIL — `rt.loadSink` is not a function.

- [ ] **Step 3: Wire `loadSink` into the runtime**

In `packages/plugins/src/runtime.ts`:

(a) Add the import (next to `import { createWasmConverter } from './wasm-converter';`):

```ts
import { createWasmSink, type WasmSink } from './wasm-sink';
```

(b) Add `loadSink` to the `PluginRuntime` interface (after the `load` method, ~line 62):

```ts
  loadSink(id: string, version?: string): Promise<WasmSink | undefined>;
```

(c) Inside `createPluginRuntime`, add a sink cache next to the existing `cache` (~line 104) and clear both in `invalidateCache`:

```ts
  const cache = new Map<string, Converter>();
  const sinkCache = new Map<string, WasmSink>();

  function invalidateCache(id: string) {
    for (const k of [...cache.keys()]) {
      if (k.startsWith(`${id}@`)) cache.delete(k);
    }
    for (const k of [...sinkCache.keys()]) {
      if (k.startsWith(`${id}@`)) sinkCache.delete(k);
    }
  }
```

(d) Add the `loadSink` function just after the existing `load` function (after its closing brace, ~line 132):

```ts
  async function loadSink(id: string, version?: string): Promise<WasmSink | undefined> {
    const row = await deps.store.get(id, version);
    if (!row) return undefined;
    const key = `${row.id}@${row.version}`;
    const cached = sinkCache.get(key);
    if (cached) return cached;
    const manifest = pluginManifestFromRow(row);
    if (manifest.kind !== 'sink') {
      throw new Error(`plugin ${row.id}@${row.version} is not a sink (kind=${manifest.kind})`);
    }
    const wasm = await loadWasm(row);
    const grant = readGrant(row.manifest);
    const sink = createWasmSink(manifest, wasm, deps.runner, deps.logger, grant.legacy ? undefined : grant.capabilities);
    sinkCache.set(key, sink);
    return sink;
  }
```

(e) Add `loadSink` to the returned object (the `return { ... }` near the end currently ends with `load,`):

```ts
    load,
    loadSink,
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C packages/plugins test runtime`
Expected: PASS (existing runtime tests + the 4 new `loadSink` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/src/runtime.ts packages/plugins/src/runtime.test.ts
git commit -m "$(cat <<'EOF'
feat(plugins): add loadSink() to resolve a sink plugin from the registry

Same store lookup + SHA-256 verify + capability grant + per-id cache as load();
returns a WasmSink. Refuses to load a source plugin as a sink.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Export `wasm-sink` + SDK sink helper + workspace member

**Files:**
- Modify: `packages/plugins/src/index.ts`
- Modify: `wasm/openldr-plugin-sdk/src/lib.rs`
- Modify: `wasm/Cargo.toml`

- [ ] **Step 1: Export the sink module**

In `packages/plugins/src/index.ts`, add after `export * from './wasm-converter';`:

```ts
export * from './wasm-sink';
```

- [ ] **Step 2: Add a sink helper + test to the Rust SDK**

In `wasm/openldr-plugin-sdk/src/lib.rs`, add after the `to_ndjson` function (before `#[cfg(test)] mod tests`):

```rust
/// Helper for authoring **sink** plugins. A sink exports named entrypoints (e.g.
/// `health_check`, `pull_metadata`, `push_aggregate`, `push_tracker`), each taking the
/// host's JSON request bytes and returning a single JSON response object. Use this to
/// serialize the response value compactly — the host parses the returned string as JSON.
pub fn to_json_string(value: &Value) -> String {
    value.to_string()
}
```

Add a test inside the existing `mod tests` block (before its closing `}`):

```rust
    #[test]
    fn to_json_string_is_compact() {
        let out = to_json_string(&json!({ "ok": true }));
        assert_eq!(out, "{\"ok\":true}");
    }
```

- [ ] **Step 3: Register the test-sink crate in the workspace**

In `wasm/Cargo.toml`, add `test-sink` to `members`:

```toml
members = ["openldr-plugin-sdk", "whonet-sqlite", "hl7v2", "tabular", "test-sink"]
```

(The crate itself is created in Task 6 Step 1; adding the member now means `cargo` will look for it — do Task 6 Step 1 immediately after, or run cargo only after the crate exists.)

- [ ] **Step 4: Verify the SDK Rust test passes**

Run: `cargo test -p openldr-plugin-sdk --manifest-path wasm/Cargo.toml`
Expected: PASS including `to_json_string_is_compact`.
(Note: this needs the Rust toolchain. If unavailable in this environment, skip and verify in Task 6.)

- [ ] **Step 5: Verify the JS package still builds/types**

Run: `pnpm -C packages/plugins typecheck && pnpm -C packages/plugins test`
Expected: PASS — `WasmSink`/`createWasmSink`/`SinkInvokeOptions` now exported from the barrel.

- [ ] **Step 6: Commit**

```bash
git add packages/plugins/src/index.ts wasm/openldr-plugin-sdk/src/lib.rs wasm/Cargo.toml
git commit -m "$(cat <<'EOF'
feat(plugins,sdk): export wasm-sink + add sink JSON helper to the Rust SDK

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Trivial `test-sink` crate + build script + real-Extism integration test

This is the SP-1 deliverable: a trivial sink that loads and `invoke()`s (dry-run) through the runtime via the **real** Extism runner.

**Files:**
- Create: `wasm/test-sink/Cargo.toml`
- Create: `wasm/test-sink/src/lib.rs`
- Create: `scripts/build-test-sink.mjs`
- Modify: `package.json` (root) — add `build:test-sink` script
- Test: `packages/plugins/src/wasm-sink.integration.test.ts`

- [ ] **Step 1: Create the test-sink crate**

Create `wasm/test-sink/Cargo.toml`:

```toml
[package]
name = "test-sink"
edition.workspace = true
version.workspace = true
license.workspace = true
description = "Trivial sink plugin exercising the sink ABI (health_check + push_aggregate echo)"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
openldr-plugin-sdk = { path = "../openldr-plugin-sdk" }
serde_json = "1"

[target.'cfg(target_arch = "wasm32")'.dependencies]
extism-pdk = "1"
```

Create `wasm/test-sink/src/lib.rs`:

```rust
//! Trivial sink plugin: proves the sink ABI (named entrypoints, JSON in/out, dry-run echo).
//! Not a reference plugin — used only to validate the host sink runtime.

#[cfg(target_arch = "wasm32")]
mod plugin {
    use extism_pdk::*;
    use serde_json::{json, Value};

    /// Cheap liveness probe. Input ignored; returns { ok, version }.
    #[plugin_fn]
    pub fn health_check(_input: Vec<u8>) -> FnResult<String> {
        Ok(json!({ "ok": true, "version": "test-sink" }).to_string())
    }

    /// Dry-run echo: empty dataValues payload + the parsed input echoed back. No egress.
    #[plugin_fn]
    pub fn push_aggregate(input: Vec<u8>) -> FnResult<String> {
        let parsed: Value = if input.is_empty() {
            json!({})
        } else {
            serde_json::from_slice(&input)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid input JSON: {e}")), 1))?
        };
        Ok(json!({ "payload": { "dataValues": [] }, "skipped": [], "echo": parsed }).to_string())
    }
}

// The host (non-wasm) build needs at least one item so `cargo check`/`clippy` succeed.
#[cfg(not(target_arch = "wasm32"))]
pub fn _host_placeholder() {}
```

- [ ] **Step 2: Create the build script**

Create `scripts/build-test-sink.mjs`:

```js
// Builds the trivial test-sink plugin to wasm and stages plugin.wasm + manifest.json under
// reference-plugins/test-sink/. Pure Rust (no C deps) so it needs only the wasm32-wasip1
// target — no clang/WASI sysroot, unlike the whonet-sqlite build.
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const wasmDir = join(root, 'wasm');

execSync('cargo build -p test-sink --release --target wasm32-wasip1', { cwd: wasmDir, stdio: 'inherit', env: process.env });

const built = join(wasmDir, 'target', 'wasm32-wasip1', 'release', 'test_sink.wasm');
const dir = join(root, 'reference-plugins', 'test-sink');
mkdirSync(dir, { recursive: true });
const staged = join(dir, 'plugin.wasm');
copyFileSync(built, staged);

const sha = createHash('sha256').update(readFileSync(staged)).digest('hex');
const workspaceToml = readFileSync(join(wasmDir, 'Cargo.toml'), 'utf8');
const ver = (workspaceToml.match(/version\s*=\s*"([^"]+)"/) || [])[1] || '0.1.0';

const manifest = {
  id: 'test-sink',
  version: ver,
  kind: 'sink',
  entrypoints: ['health_check', 'push_aggregate'],
  wasmSha256: sha,
  description: 'Trivial sink ABI test plugin',
  license: 'Apache-2.0',
  // wasm32-wasip1's std imports wasi_snapshot_preview1 even for in-memory plugins.
  wasi: true,
  limits: { memoryMb: 256, timeoutMs: 30000 },
  // Declares net-egress intent (empty allowedHosts = host pins the concrete host at runtime).
  capabilities: [{ kind: 'net-egress', allowedHosts: [] }],
};
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`staged ${staged} (sha256 ${sha}) + manifest.json\n`);
```

- [ ] **Step 3: Add the root build script**

In root `package.json`, add to `scripts` (after `"build:plugins"`):

```json
    "build:test-sink": "node scripts/build-test-sink.mjs",
```

- [ ] **Step 4: Write the skip-guarded integration test**

Create `packages/plugins/src/wasm-sink.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/test-sink/plugin.wasm is a gitignored build artifact (run
// `pnpm build:test-sink` first). When absent the whole suite is skipped so the
// hermetic gate stays green without the Rust/wasm toolchain.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'test-sink', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

describe.skipIf(!present)('test-sink through the real Extism runner', () => {
  it('health_check returns ok and push_aggregate echoes a dry-run payload', async () => {
    const wasm = new Uint8Array(readFileSync(wasmPath));
    const manifest = parseManifest({
      id: 'test-sink', version: '0.1.0', kind: 'sink',
      entrypoints: ['health_check', 'push_aggregate'], wasmSha256: sha256Hex(wasm), wasi: true,
    });
    const sink = createWasmSink(manifest, wasm, createExtismRunner(), logger);

    const health = await sink.invoke('health_check', {});
    expect(health).toMatchObject({ ok: true });

    const push = await sink.invoke('push_aggregate', { rows: [{ a: 1 }] });
    expect(push).toMatchObject({ payload: { dataValues: [] }, echo: { rows: [{ a: 1 }] } });
  });
});
```

- [ ] **Step 5: Build the test-sink and run the integration test**

Run:
```bash
pnpm build:test-sink
pnpm -C packages/plugins test wasm-sink.integration
```
Expected: the build stages `reference-plugins/test-sink/plugin.wasm` + `manifest.json`; the integration test runs (not skipped) and PASSES — proving a real sink wasm loads and `invoke()`s `health_check` + `push_aggregate` through the real Extism runner.

If the wasm toolchain is unavailable: the test is skipped (`present === false`) and that is acceptable for the gate; note it explicitly when reporting and flag the live build as a follow-up.

- [ ] **Step 6: Commit**

```bash
git add wasm/test-sink scripts/build-test-sink.mjs package.json packages/plugins/src/wasm-sink.integration.test.ts
git commit -m "$(cat <<'EOF'
test(plugins): trivial test-sink + real-Extism integration proof of the sink ABI

Adds wasm/test-sink (health_check + push_aggregate echo), a build:test-sink
script that stages it, and a skip-guarded integration test that loads the built
wasm and invoke()s it through the real Extism runner.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full turbo gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS across the workspace. Note from memory: `@openldr/web#test` can flake under turbo concurrency — if it reds, re-run it in isolation (`pnpm -C apps/web test`) and trust the isolated result. Never pipe turbo through `tail` (it masks the exit code).

- [ ] **Step 2: Run dependency-cruiser**

Run: `pnpm depcruise`
Expected: clean (no new violations). `@openldr/plugins` already depends on `@openldr/marketplace`, so `wasm-sink.ts`'s `Capability` import introduces no new cross-package edge.

- [ ] **Step 3: Final commit (only if anything was adjusted to get green)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(plugins): SP-1 sink ABI + runtime — gate green

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage (against the SP-1 scope in the design doc — L1 SDK/manifest + L2):**
- Manifest gains `kind` (default `source`) → Task 1. ✓
- Manifest gains `entrypoints` → Task 1. ✓
- Artifact payload carries the flavor + entrypoints through install (so existing plugins unchanged; signed artifacts byte-identical) → Task 2. ✓
- `wasm-sink.ts` `createWasmSink(manifest, wasm, runner, logger, capabilities)` → `invoke(entrypoint, input, {config, allowedHosts})`; serializes input, calls the existing Extism runner, parses JSON; fail-closes when a host is requested but the plugin lacks `net-egress` → Task 3. ✓
- `runtime.ts` `loadSink(id, version?) → WasmSink` (store lookup + SHA-256 verify + cache, connector-agnostic — config/host per call) → Task 4. ✓
- SDK sink helper ("sink entrypoints in SDK") → Task 5. ✓
- Deliverable: "a trivial test sink loads and `invoke()`s (dry-run) through the runtime" → Task 6 (`wasm/test-sink` + real-Extism integration test). ✓
- Net-egress → `allowedHosts` mapping is honored: the runner already maps `opts.allowedHosts` to Extism `allowed_hosts`; `WasmSink` passes the pinned host through and gates on the capability (Task 3). ✓

Out of SP-1 scope (correctly deferred): connector store/crypto (SP-3), DHIS2 Rust mapping/egress (SP-2), host rewiring/port signature change (SP-4), UI/API (SP-5), live Docker DHIS2 e2e (SP-6). The `push_aggregate` request/response *shape* in the spec (rows/mapping/orgUnitMap/period; payload/skipped/result) is realized by the real DHIS2 plugin in SP-2 — SP-1's test-sink only needs an arbitrary JSON echo to prove the ABI, so no shape contract is pinned here.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows complete code. ✓

**Type consistency:** `kind`/`entrypoints` (flat manifest) ↔ `pluginKind`/`entrypoints` (artifact payload) translated in both `pluginManifestToArtifact` (Task 2 Step 3) and `artifactToPluginManifest` (Task 2 Step 4). `WasmSink`/`createWasmSink`/`SinkInvokeOptions` defined in Task 3, imported in Task 4, exported in Task 5, used in Task 6 — names consistent. `grant?: Capability[]` param matches the call site `grant.legacy ? undefined : grant.capabilities` (Task 4 Step 3d), same idiom as the existing converter `load()`. ✓

---

## Notes for execution

- Work on an isolated branch/worktree (per the workstream's merge discipline — SPs land on a feature branch then merge to local `main`, not pushed). Suggested branch: `feat/dhis2-sink-sp1`.
- The spec file (`docs/superpowers/specs/2026-06-23-dhis2-sink-plugin-connectors-design.md`) and the marketplace `artifact-manifest.test.ts` are already uncommitted in the working tree — commit the spec separately or fold it into the first SP-1 commit; do not lose it.
- After SP-1 is green and merged, update the `dhis2-sink-plugin-workstream` memory: SP-1 done, ABI/runtime landed, then proceed to SP-2 (`wasm/dhis2-sink`) and SP-3 (connector store + crypto) — which can run in parallel.
