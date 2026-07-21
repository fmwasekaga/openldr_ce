# Terminology SNOMED CT + RxNorm Flat Terms (Slice 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable distribution upload + ingest for SNOMED CT and RxNorm, emitting flat `terminology_concepts` from the display maps their ontology adapters already build — in the same single parse.

**Architecture:** An optional `conceptSink` on the adapters' `buildIndex` tees `ConceptRecord`s during the existing tree parse. `ingestDistribution` dispatches SNOMED/RxNorm to a `buildOntologyWithConcepts` orchestrator (in the terminology context) that wires the sink to `loaderStore.upsertConcepts`, guards the detected adapter type against the requested systemType, and runs the `loadLoinc`-style registration tail. Enablement flips `SUPPORTED_SYSTEMS` + the Studio per-publisher `systemType`.

**Tech Stack:** TypeScript, Kysely, Fastify, React + Vite + shadcn/ui, Vitest.

**Scope note:** Slice 2 of the terminology-upload workstream (Spec: `docs/superpowers/specs/2026-07-21-terminology-snomed-rxnorm-terms-design.md`; builds on Slices 1/1.1, `origin/main` `db4a7618`). Slice 3 (CLI parity, legacy-route removal) is separate.

## Global Constraints

- Gate: `pnpm turbo run typecheck test --force` (never pipe turbo through `tail`; bootstrap/db/server flakes pass in isolation / `--concurrency=1`).
- Concept `system` MUST be `canonicalSystemUrl(systemType)` (snomed `http://snomed.info/sct`, rxnorm `http://www.nlm.nih.gov/research/umls/rxnorm`) — the same URL the route's resolve-or-create uses.
- The adapters already stream (readline) — do NOT introduce `readFileSync`.
- The concept sink is OPTIONAL; the ontology-only rebuild path (`ontology.build`/`rebuild`) must pass no sink and behave exactly as before.
- No Claude/Codex co-author trailer.

---

### Task 1: `ConceptSink` type + `buildIndex`/`buildOntologyDistribution` plumbing + type guard

**Files:**
- Modify: `packages/terminology/src/ontology/types.ts` (add `ConceptSink`, extend `OntologyAdapter.buildIndex`)
- Modify: `packages/terminology/src/ontology/build.ts` (`conceptSink` passthrough + `expectedType` guard)
- Test: `packages/terminology/src/ontology/build.test.ts` (extend — guard test)

**Interfaces:**
- Produces: `type ConceptSink = (rows: ConceptRecord[]) => Promise<void>`; `buildOntologyDistribution(systemId, sourcePath, store, onProgress, opts?: { conceptSink?: ConceptSink; expectedType?: OntologyType })`. Consumed by Tasks 2–4.

- [ ] **Step 1: Extend the types**

In `packages/terminology/src/ontology/types.ts`, add near the top (after the imports) and extend `OntologyAdapter`:

```ts
import type { ConceptRecord } from '@openldr/db';
// ...existing content...
export type ConceptSink = (rows: ConceptRecord[]) => Promise<void>;
```

Change `OntologyAdapter.buildIndex` (currently `buildIndex(dist, writer, onProgress): void | Promise<void>`) to:

```ts
  buildIndex(
    dist: DetectedDistribution,
    writer: IndexWriter,
    onProgress: (progress: Omit<OntologyBuildProgress, 'codingSystemId'>) => void,
    conceptSink?: ConceptSink,
  ): void | Promise<void>;
```

(Adapters that don't emit concepts take fewer params — still assignable. `@openldr/terminology` already depends on `@openldr/db` for `ConceptRecord`, used in the loaders.)

- [ ] **Step 2: Write the failing guard test**

In `packages/terminology/src/ontology/build.test.ts`, add (it already imports `buildOntologyDistribution` + uses adapter `__fixtures__`; reuse the SNOMED fixture path `join(__dirname, 'adapters', '__fixtures__', 'snomed')` — confirm the exact relative path from the existing tests in that file and match it):

```ts
it('rejects when the detected adapter type does not match the expected systemType', async () => {
  const store = memStore(); // the file's existing in-memory OntologyIndexStore fake — reuse it
  const snomedFixture = /* the snomed __fixtures__ dir path as used elsewhere in this file */;
  await expect(
    buildOntologyDistribution('cs1', snomedFixture, store, () => {}, { expectedType: 'rxnorm' }),
  ).rejects.toThrow(/expected .*rxnorm|does not match/i);
});
```

If `build.test.ts` has no reusable store fake / fixture reference, mirror whatever the existing `buildOntologyDistribution` test in that file uses (there is one — it tests the happy path).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/terminology && npx vitest run src/ontology/build.test.ts -t "does not match"`
Expected: FAIL — no guard yet (build proceeds).

- [ ] **Step 4: Implement the passthrough + guard**

In `packages/terminology/src/ontology/build.ts`, import the types and change `buildOntologyDistribution`:

```ts
import { detectAdapter } from './adapters/index';
import { INDEX_SCHEMA_VERSION, type ConceptSink, type IndexWriter, type OntologyBuildProgress, type OntologyType, type PanelMember } from './types';

export async function buildOntologyDistribution(
  systemId: string,
  sourcePath: string,
  store: OntologyIndexStore,
  onProgress: (progress: OntologyBuildProgress) => void,
  opts?: { conceptSink?: ConceptSink; expectedType?: OntologyType },
): Promise<void> {
  const detected = detectAdapter(sourcePath);
  if (!detected) {
    const err = new Error('No LOINC / SNOMED CT / RxNorm distribution found in that folder.');
    await store.failBuild(systemId, 'unknown', sourcePath, err.message);
    throw err;
  }
  const { adapter, dist } = detected;
  if (opts?.expectedType && adapter.type !== opts.expectedType) {
    const err = new Error(`distribution is a ${adapter.type} distribution but ${opts.expectedType} was expected`);
    await store.failBuild(systemId, adapter.type, sourcePath, err.message);
    throw err;
  }
  await store.beginBuild(systemId, adapter.type, sourcePath);
  try {
    await store.clearIndex(systemId);
    const writer = new BufferedWriter();
    await adapter.buildIndex(dist, writer, (progress) => onProgress({ ...progress, codingSystemId: systemId }), opts?.conceptSink);
    // ...unchanged flushChunked + finishBuild...
  } catch (err) {
    await store.failBuild(systemId, adapter.type, sourcePath, (err as Error).message);
    throw err;
  }
}
```

(`OntologyType` is already exported from `types.ts`. Keep the `flushChunked`/`finishBuild` body exactly as-is.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/terminology && npx vitest run src/ontology/build.test.ts`
Expected: PASS (guard test + existing tests). Also `npx tsc --noEmit` in `packages/terminology` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/terminology/src/ontology/types.ts packages/terminology/src/ontology/build.ts packages/terminology/src/ontology/build.test.ts
git commit -m "feat(terminology): optional conceptSink on buildIndex + expectedType guard"
```

---

### Task 2: SNOMED concept tee

**Files:**
- Modify: `packages/terminology/src/ontology/adapters/snomed.ts`
- Test: `packages/terminology/src/ontology/adapters/snomed.test.ts` (extend)

**Interfaces:**
- Consumes: `ConceptSink` (Task 1), `canonicalSystemUrl` (`../../system-urls`), `ConceptRecord` (`@openldr/db`).

- [ ] **Step 1: Write the failing tests**

In `packages/terminology/src/ontology/adapters/snomed.test.ts`, add a capturing sink + tests (the file already has the `collector()` + `FIXTURE`):

```ts
import { canonicalSystemUrl } from '../../system-urls';
import { parseSemanticTag } from './snomed';

it('tees flat concepts (FSN + semanticTag) when a conceptSink is provided', async () => {
  const distribution = snomedAdapter.detect(FIXTURE)!;
  const collected = collector();
  const concepts: any[] = [];
  await snomedAdapter.buildIndex(distribution, collected.writer, () => {}, async (rows) => { concepts.push(...rows); });
  const blood = concepts.find((c) => c.code === '119297000');
  expect(blood).toMatchObject({ system: canonicalSystemUrl('snomed'), display: 'Blood specimen (specimen)', status: 'active' });
  expect(blood.properties).toMatchObject({ semanticTag: 'specimen', fsn: 'Blood specimen (specimen)' });
  // every active FSN'd concept is emitted (fuller than the tree node set)
  expect(concepts.length).toBeGreaterThanOrEqual(collected.nodes.length);
});

it('emits no concepts when no conceptSink is provided (rebuild path unchanged)', async () => {
  const distribution = snomedAdapter.detect(FIXTURE)!;
  const collected = collector();
  let called = false;
  await snomedAdapter.buildIndex(distribution, collected.writer, () => {}); // no 4th arg
  expect(called).toBe(false);
  expect(collected.nodes.length).toBeGreaterThan(0); // tree still built
});

it('parseSemanticTag extracts the trailing parenthetical, else null', () => {
  expect(parseSemanticTag('Blood specimen (specimen)')).toBe('specimen');
  expect(parseSemanticTag('Diabetes mellitus (disorder)')).toBe('disorder');
  expect(parseSemanticTag('No tag here')).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/terminology && npx vitest run src/ontology/adapters/snomed.test.ts`
Expected: FAIL — `parseSemanticTag` not exported; sink not emitting.

- [ ] **Step 3: Implement**

In `packages/terminology/src/ontology/adapters/snomed.ts`:

Add imports + the helper:

```ts
import type { ConceptRecord } from '@openldr/db';
import { canonicalSystemUrl } from '../../system-urls';
import { ROOT_CODE, type ConceptSink, type DetectedDistribution, type FileStat, type IndexWriter, type OntologyAdapter } from '../types';

/** Trailing `(...)` semantic tag of an FSN, e.g. "Foo (disorder)" -> "disorder"; else null. */
export function parseSemanticTag(fsn: string): string | null {
  const m = /\(([^)]+)\)\s*$/.exec(fsn);
  return m ? m[1]! : null;
}
```

Change `buildIndex(dist, writer, onProgress)` to accept the sink and, when provided, tee the `names` map after the descriptions pass — batched (1000):

```ts
  async buildIndex(dist, writer: IndexWriter, onProgress, conceptSink?: ConceptSink): Promise<void> {
    // ...pass 1 builds `names` (unchanged)...

    if (conceptSink) {
      const url = canonicalSystemUrl('snomed')!;
      let batch: ConceptRecord[] = [];
      for (const [code, fsn] of names) {
        batch.push({ system: url, code, display: fsn, status: 'active', properties: { semanticTag: parseSemanticTag(fsn), fsn } });
        if (batch.length >= 1000) { await conceptSink(batch); batch = []; }
      }
      if (batch.length) await conceptSink(batch);
    }

    // ...pass 2 (relationships) + finalize (writer.insertNode/insertEdge) unchanged...
  },
```

(Place the tee right after the descriptions `await streamLines(...)` that fills `names`, before pass 2. Everything else in the method is untouched.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/terminology && npx vitest run src/ontology/adapters/snomed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/terminology/src/ontology/adapters/snomed.ts packages/terminology/src/ontology/adapters/snomed.test.ts
git commit -m "feat(terminology): SNOMED flat-term tee (FSN + semanticTag)"
```

---

### Task 3: RxNorm concept tee

**Files:**
- Modify: `packages/terminology/src/ontology/adapters/rxnorm.ts`
- Test: `packages/terminology/src/ontology/adapters/rxnorm.test.ts` (extend)

**Interfaces:**
- Consumes: `ConceptSink` (Task 1), `canonicalSystemUrl`, `ConceptRecord`.

- [ ] **Step 1: Write the failing tests**

In `packages/terminology/src/ontology/adapters/rxnorm.test.ts` (mirror its existing fixture/collector pattern — confirm the fixture path + collector helper it uses):

```ts
import { canonicalSystemUrl } from '../../system-urls';

it('tees flat concepts for semantic-TTY drugs only when a conceptSink is provided', async () => {
  const distribution = rxnormAdapter.detect(FIXTURE)!;
  const collected = collector(); // the file's existing IndexWriter collector
  const concepts: any[] = [];
  await rxnormAdapter.buildIndex(distribution, collected.writer, () => {}, async (rows) => { concepts.push(...rows); });
  expect(concepts.length).toBeGreaterThan(0);
  for (const c of concepts) {
    expect(c.system).toBe(canonicalSystemUrl('rxnorm'));
    expect(c.status).toBe('active');
    expect(c.properties.tty).toBeTruthy();               // only semantic TTYs
    expect(typeof c.display).toBe('string');
  }
  // ATC classification codes are NOT flat concepts (they are the spine, not drugs)
  expect(concepts.some((c) => /^[A-Z]\d/.test(c.code) && c.code.length <= 7)).toBe(false);
});

it('emits no concepts when no conceptSink is provided', async () => {
  const distribution = rxnormAdapter.detect(FIXTURE)!;
  const collected = collector();
  await rxnormAdapter.buildIndex(distribution, collected.writer, () => {});
  expect(collected.nodes.length).toBeGreaterThan(0);
});
```

(Adjust the ATC-exclusion assertion to the actual fixture — the point is that only `concepts` map entries with a non-null semantic `tty` are emitted, keyed by RXCUI, not ATC codes.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/terminology && npx vitest run src/ontology/adapters/rxnorm.test.ts`
Expected: FAIL — sink not emitting.

- [ ] **Step 3: Implement**

In `packages/terminology/src/ontology/adapters/rxnorm.ts`, add imports and tee the `concepts` map (semantic TTYs only) after pass 1 (RXNCONSO), before pass 2:

```ts
import type { ConceptRecord } from '@openldr/db';
import { canonicalSystemUrl } from '../../system-urls';
import { ROOT_CODE, type ConceptSink, type DetectedDistribution, type FileStat, type IndexWriter, type OntologyAdapter } from '../types';
```

```ts
  async buildIndex(dist, writer: IndexWriter, onProgress, conceptSink?: ConceptSink): Promise<void> {
    // ...pass 1 fills `concepts` (unchanged)...

    if (conceptSink) {
      const url = canonicalSystemUrl('rxnorm')!;
      let batch: ConceptRecord[] = [];
      for (const [rxcui, concept] of concepts) {
        if (!concept.tty) continue; // semantic-TTY drug concepts only
        batch.push({ system: url, code: rxcui, display: concept.display, status: 'active', properties: { tty: concept.tty } });
        if (batch.length >= 1000) { await conceptSink(batch); batch = []; }
      }
      if (batch.length) await conceptSink(batch);
    }

    // ...pass 2 (relationships) + node/edge finalize unchanged...
  },
```

(Place the tee right after the `await streamPipe(dist.files['conso']!, ...)` that fills `concepts`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/terminology && npx vitest run src/ontology/adapters/rxnorm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/terminology/src/ontology/adapters/rxnorm.ts packages/terminology/src/ontology/adapters/rxnorm.test.ts
git commit -m "feat(terminology): RxNorm flat-term tee (semantic-TTY drugs + tty)"
```

---

### Task 4: `ingestDistribution` dispatch + `ingestOntologyWithConcepts` orchestrator + bootstrap wiring

**Files:**
- Modify: `packages/terminology/src/ingest/ingest-distribution.ts` (dispatch + `buildOntologyWithConcepts` dep)
- Modify: `packages/terminology/src/ingest/ingest-distribution.test.ts` (dispatch tests)
- Modify: `packages/bootstrap/src/terminology-context.ts` (hold `ontologyStore`; add `ingestOntologyWithConcepts`)
- Modify: `packages/bootstrap/src/index.ts` (`runIngest` wires `buildOntologyWithConcepts`)

**Interfaces:**
- Produces: `IngestDeps.buildOntologyWithConcepts(systemType, codingSystemId, distDir, onProgress): Promise<{ conceptsLoaded: number }>`; `ctx.terminology.ingestOntologyWithConcepts(systemType, systemId, dir, onProgress): Promise<{ conceptsLoaded: number }>`.

- [ ] **Step 1: Update the ingest dispatch tests (RED)**

In `packages/terminology/src/ingest/ingest-distribution.test.ts`, add `buildOntologyWithConcepts` to the fake `deps`, and replace the "rejects a non-loinc" test:

```ts
it('dispatches snomed/rxnorm to buildOntologyWithConcepts (one teed parse)', async () => {
  const deps = {
    loadConcepts: vi.fn(),
    buildOntology: vi.fn(),
    buildOntologyWithConcepts: vi.fn(async () => ({ conceptsLoaded: 321 })),
  };
  const res = await ingestDistribution({ systemType: 'snomed', codingSystemId: 'cs1', distDir: '/d', acceptLicense: true, deps: deps as never, onProgress: () => {} });
  expect(res.conceptsLoaded).toBe(321);
  expect(deps.buildOntologyWithConcepts).toHaveBeenCalledWith('snomed', 'cs1', '/d', expect.any(Function));
  expect(deps.loadConcepts).not.toHaveBeenCalled();
});

it('loinc still runs loadConcepts + buildOntology (no tee)', async () => {
  const deps = { loadConcepts: vi.fn(async () => ({ conceptsLoaded: 42 })), buildOntology: vi.fn(), buildOntologyWithConcepts: vi.fn() };
  const res = await ingestDistribution({ systemType: 'loinc', codingSystemId: 'cs1', distDir: '/d', acceptLicense: true, deps: deps as never, onProgress: () => {} });
  expect(res.conceptsLoaded).toBe(42);
  expect(deps.buildOntology).toHaveBeenCalled();
  expect(deps.buildOntologyWithConcepts).not.toHaveBeenCalled();
});

it('rejects a genuinely unknown system type', async () => {
  const deps = { loadConcepts: vi.fn(), buildOntology: vi.fn(), buildOntologyWithConcepts: vi.fn() };
  await expect(ingestDistribution({ systemType: 'nope', codingSystemId: 'x', distDir: '/d', acceptLicense: true, deps: deps as never, onProgress: () => {} })).rejects.toThrow(/unsupported/i);
});
```

Keep the existing "requires license acceptance" test.

- [ ] **Step 2: Run to verify RED**

Run: `cd packages/terminology && npx vitest run src/ingest/ingest-distribution.test.ts`
Expected: FAIL (snomed currently throws / no dispatch).

- [ ] **Step 3: Implement the dispatch**

Replace `packages/terminology/src/ingest/ingest-distribution.ts` with:

```ts
export interface IngestProgress { phase: string; processed: number; total: number | null }

export interface IngestDeps {
  loadConcepts(systemType: string, distDir: string, opts: { acceptLicense: boolean }): Promise<{ conceptsLoaded: number }>;
  buildOntology(systemType: string, codingSystemId: string, distDir: string, onProgress: (p: IngestProgress) => void): Promise<void>;
  buildOntologyWithConcepts(systemType: string, codingSystemId: string, distDir: string, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>;
}

export interface IngestResult { conceptsLoaded: number }

const SUPPORTED = new Set(['loinc', 'snomed', 'rxnorm']);

/** Orchestrate a single distribution ingest into flat concepts + the ontology tree, over one extracted
 *  dir. LOINC reads its concepts from a separate file (loadConcepts) then builds the tree; SNOMED/RxNorm
 *  read concepts and tree from the SAME file, so they are teed in one parse (buildOntologyWithConcepts). */
export async function ingestDistribution(input: {
  systemType: string;
  codingSystemId: string;
  distDir: string;
  acceptLicense: boolean;
  deps: IngestDeps;
  onProgress: (p: IngestProgress) => void;
}): Promise<IngestResult> {
  if (!SUPPORTED.has(input.systemType)) {
    throw new Error(`unsupported system type: ${input.systemType}`);
  }
  if (!input.acceptLicense) {
    throw new Error('the distribution license must be accepted before import');
  }
  if (input.systemType === 'loinc') {
    input.onProgress({ phase: 'concepts', processed: 0, total: null });
    const { conceptsLoaded } = await input.deps.loadConcepts(input.systemType, input.distDir, { acceptLicense: input.acceptLicense });
    input.onProgress({ phase: 'concepts', processed: conceptsLoaded, total: conceptsLoaded });
    await input.deps.buildOntology(input.systemType, input.codingSystemId, input.distDir, input.onProgress);
    return { conceptsLoaded };
  }
  // snomed / rxnorm: concepts + tree from one parse.
  const { conceptsLoaded } = await input.deps.buildOntologyWithConcepts(input.systemType, input.codingSystemId, input.distDir, input.onProgress);
  return { conceptsLoaded };
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `cd packages/terminology && npx vitest run src/ingest/ingest-distribution.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `ingestOntologyWithConcepts` to the terminology context**

In `packages/bootstrap/src/terminology-context.ts`:
- Add `canonicalSystemUrl` + `type OntologyType` to the existing `@openldr/terminology` import; `deriveSystemCode` is already imported from `@openldr/db`.
- Hold the ontology store: change `const ontology = createOntologyApi(createOntologyStore(db));` to:

```ts
const ontologyStore = createOntologyStore(db);
const ontology = createOntologyApi(ontologyStore);
```

- Add to the `TerminologyContext` interface:

```ts
  ingestOntologyWithConcepts(systemType: string, systemId: string, dir: string, onProgress: (p: { phase: string; processed: number; total: number | null }) => void): Promise<{ conceptsLoaded: number }>;
```

- In the returned object (near `loaders`), add:

```ts
    async ingestOntologyWithConcepts(systemType, systemId, dir, onProgress) {
      const url = canonicalSystemUrl(systemType);
      if (!url) throw new Error(`unsupported system type: ${systemType}`);
      let conceptsLoaded = 0;
      const conceptSink = async (rows: Parameters<LoaderStore['upsertConcepts']>[0]) => {
        await loaderStore.upsertConcepts(rows);
        conceptsLoaded += rows.length;
      };
      await buildOntologyDistribution(
        systemId, dir, ontologyStore,
        (p) => onProgress({ phase: p.phase, processed: p.processed, total: p.total }),
        { conceptSink, expectedType: systemType as OntologyType },
      );
      // Registration tail — same as loadLoinc: make the terms queryable + fire the sync signal.
      const ref = await loaderStore.saveResource({ resourceType: 'CodeSystem', url, name: deriveSystemCode(url), status: 'active', content: 'not-present' });
      await loaderStore.saveSystem(url, null, 'CodeSystem', ref.id);
      await loaderStore.markSystemChanged(url);
      return { conceptsLoaded };
    },
```

Ensure `buildOntologyDistribution` is imported from `@openldr/terminology` (it already is).

- [ ] **Step 6: Wire it into `runIngest`**

In `packages/bootstrap/src/index.ts` `runIngest` deps (currently `loadConcepts` + `buildOntology`, ~lines 628–633), add:

```ts
            buildOntologyWithConcepts: async (systemType, codingSystemId, dir, onP) =>
              terminology.ingestOntologyWithConcepts(systemType, codingSystemId, dir, onP),
```

- [ ] **Step 7: Typecheck**

Run: `pnpm turbo run typecheck --filter=@openldr/terminology --filter=@openldr/bootstrap --force`
Expected: PASS. (The context orchestrator's behavioural coverage is the adapter tees in Tasks 2–3 + the gate's optional integration test; the dispatch is unit-tested in Step 4.)

- [ ] **Step 8: Commit**

```bash
git add packages/terminology/src/ingest/ingest-distribution.ts packages/terminology/src/ingest/ingest-distribution.test.ts packages/bootstrap/src/terminology-context.ts packages/bootstrap/src/index.ts
git commit -m "feat(terminology): ingest dispatch + ingestOntologyWithConcepts (snomed/rxnorm teed ingest)"
```

---

### Task 5: Enablement — route `SUPPORTED_SYSTEMS` + Studio per-publisher `systemType`

**Files:**
- Modify: `apps/server/src/terminology-admin-routes.ts` (flip `SUPPORTED_SYSTEMS`)
- Modify: `apps/server/src/terminology-admin-routes.test.ts` (snomed accepted)
- Modify: `apps/studio/src/pages/Terminology.tsx` (publisher→systemType; show item on 3 publishers; thread systemType)
- Modify: `apps/studio/src/pages/Terminology.test.tsx` (snomed/rxnorm publisher upload)

- [ ] **Step 1: Flip the route support set + test (RED→GREEN)**

In `apps/server/src/terminology-admin-routes.ts` line ~383:

```ts
  const SUPPORTED_SYSTEMS = new Set(['loinc', 'snomed', 'rxnorm']);
```

In `apps/server/src/terminology-admin-routes.test.ts`, change the "rejects a non-loinc systemType (400)" test — `snomed` is now accepted — and add coverage that snomed enqueues. The fake `admin.codingSystems.upsertByUrl`/`getByUrl` already exist (Slice 1.1); the `canonicalSystemUrl('snomed')` is real:

```ts
it('accepts a snomed upload (resolve-or-create + enqueue)', async () => {
  const { ctx, ctxState } = fakeCtx();
  ctxState.codingSystem = null;
  const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-snomed-ct/distribution?systemType=snomed&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
  expect(res.statusCode).toBe(201);
  expect(ctxState.upserts[0]).toMatchObject({ url: 'http://snomed.info/sct' });
  expect(ctxState.enqueued[0].systemType).toBe('snomed');
});

it('still rejects a genuinely unknown systemType (400)', async () => {
  const { ctx } = fakeCtx();
  const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-x/distribution?systemType=nope&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
  expect(res.statusCode).toBe(400);
});
```

Run: `cd apps/server && npx vitest run src/terminology-admin-routes.test.ts` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 2: Studio — publisher→systemType helper + thread it**

In `apps/studio/src/pages/Terminology.tsx`:

Add the helper (near `isLoincPublisher`, ~line 79):

```tsx
function publisherSystemType(publisher: Publisher | null | undefined): 'loinc' | 'snomed' | 'rxnorm' | null {
  if (!publisher) return null;
  if (publisher.id === 'pub-loinc') return 'loinc';
  if (publisher.id === 'pub-snomed-ct') return 'snomed';
  if (publisher.id === 'pub-rxnorm') return 'rxnorm';
  return null;
}
```

- Add state alongside `distImportPublisherId`: `const [distImportSystemType, setDistImportSystemType] = useState<'loinc' | 'snomed' | 'rxnorm'>('loinc');`
- `openDistImport` → take the systemType too:

```tsx
  const openDistImport = (publisherId: string | null, systemType: 'loinc' | 'snomed' | 'rxnorm' | null): void => {
    if (!publisherId || !systemType) return;
    setDistImportPublisherId(publisherId);
    setDistImportSystemType(systemType);
    setDistImportOpen(true);
  };
```

- The publisher menu (~line 552): gate on `publisherSystemType`, pass it through:

```tsx
                      {publisherSystemType(activeSection.publisher) && !selectedSystem && (() => {
                        const st = publisherSystemType(activeSection.publisher)!;
                        return (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openDistImport(activeSection.publisher.id, st)}>
                              Import distribution...
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void handlePurgeDistribution(activeSection.publisher.id, st)}>
                              Delete stored distribution
                            </DropdownMenuItem>
                          </>
                        );
                      })()}
```

- `handlePurgeDistribution(publisherId, systemType)` and `startPollingImportJob(publisherId, systemType)` take the systemType and pass it to `purgeTerminologyDistribution`/`getTerminologyIngestJob` (replace the hardcoded `'loinc'` at the current ~397 and ~367).
- `handleDistributionQueued` → `if (distImportPublisherId) startPollingImportJob(distImportPublisherId, distImportSystemType);`
- The dialog mount (~line 964) → `systemType={distImportSystemType}` (instead of hardcoded `"loinc"`).
- `importPollRef`/`importJobs` stay keyed by publisher id; `activeImportJob` keyed by `activeSection.publisher.id` (unchanged).

- [ ] **Step 3: Studio test**

In `apps/studio/src/pages/Terminology.test.tsx`, add a test that the SNOMED CT publisher (`pub-snomed-ct`) shows an enabled "Import distribution…" and uploads with `systemType='snomed'`. Seed a `pub-snomed-ct` publisher in the test fixtures (mirror the existing `pub-loinc` seed), select it, open the ⋯ menu, and assert `uploadTerminologyDistribution` is called with `('pub-snomed-ct', 'snomed', file, true, …)`.

- [ ] **Step 4: Run studio tests + typecheck**

Run: `cd apps/studio && npx vitest run src/pages/Terminology.test.tsx && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/terminology-admin-routes.ts apps/server/src/terminology-admin-routes.test.ts apps/studio/src/pages/Terminology.tsx apps/studio/src/pages/Terminology.test.tsx
git commit -m "feat(terminology): enable SNOMED CT + RxNorm distribution upload (route + studio)"
```

---

### Task 6: Full-gate verification

- [ ] **Step 1: Run the whole gate**

Run: `pnpm turbo run typecheck test --force`
Expected: PASS. If `@openldr/bootstrap`/`db`/`server`/`terminology` show a parallel flake, re-run that package with `npx vitest run` (or the set with `--concurrency=1`) to confirm green in isolation (per [[repo-conventions]]).

- [ ] **Step 2: Commit any drift**

```bash
git add -A && git commit -m "chore: terminology snomed/rxnorm terms — gate green" || echo "nothing to commit"
```

## Self-Review notes (addressed)

- **Spec coverage:** §4a conceptSink+guard → Task 1; §4b SNOMED tee → Task 2; §4c RxNorm tee → Task 3; §4d registration tail + §4e dispatch/wiring → Task 4; §4f enablement → Task 5.
- **One-parse invariant:** SNOMED/RxNorm tee inside the adapter's existing single stream (Tasks 2/3); the ingest calls `buildOntologyWithConcepts` once (Task 4). LOINC keeps its separate `loadConcepts` (different file).
- **Rebuild path unchanged:** `conceptSink` is optional; `ontology.build`/`rebuild` pass none (Task 1's guard test + Tasks 2/3's "no sink" tests confirm).
- **Type consistency:** `ConceptSink`/`ConceptRecord` (Task 1) flow into the adapters (2/3) and the context orchestrator (4); `buildOntologyWithConcepts` (Task 4 dep) is wired to `ctx.terminology.ingestOntologyWithConcepts`; concept `system` is `canonicalSystemUrl(systemType)` everywhere.
- **Guard:** the adapter-type-vs-systemType check (Task 1) is exercised by the ingest orchestrator (Task 4) with `expectedType`.
