# Terminology upload — SNOMED CT + RxNorm flat terms (Slice 2) — design

- **Date:** 2026-07-21
- **Status:** approved (brainstorm) → ready for implementation plan
- **Depends on:** Slice 1 + Slice 1.1 (merged + pushed, `origin/main` `db4a7618`).
- **Scope:** Enable distribution upload + ingest for **SNOMED CT and RxNorm**, extracting **flat searchable/mappable terms** in the *same single parse* that already builds their ontology tree. Flip enablement to all three systems.

## 1. Motivation

Slice 1/1.1 delivered the upload→ingest pipeline for LOINC. SNOMED and RxNorm already have ontology **trees** (their adapters parse `sct2_Description_Snapshot` / `RXNCONSO.RRF`), but **no flat terms** in `terminology_concepts` — so you can't search or build mappings against them. The publishers were seeded for mapping; as mapping matures they'll be used more. Slice 2 emits the flat terms, reusing the parse the ontology adapters already do (no second read of the multi-hundred-MB files).

**Key finding (revises spec §7a of the Slice-1 design):** both adapters **already stream** (`node:readline`), not `readFileSync`. The "harden large-file reads" item is already satisfied — no streaming work.

## 2. Goals / Non-goals

**Goals**
- SNOMED CT + RxNorm distribution upload + ingest produce **both** the ontology tree **and** flat `terminology_concepts`.
- Flat terms are emitted by **teeing** the display maps the adapters already build — **one parse**, no re-streaming the source file.
- Flip `SUPPORTED_SYSTEMS` to `{loinc, snomed, rxnorm}`; Studio shows "Import distribution…" on all three publishers with the correct per-publisher `systemType`.
- Concepts key off `canonicalSystemUrl(systemType)` (loinc `http://loinc.org`, snomed `http://snomed.info/sct`, rxnorm `http://www.nlm.nih.gov/research/umls/rxnorm`) — the same URL the route's resolve-or-create uses, so concepts + coding system + ontology all align.

**Non-goals**
- SNOMED **preferred synonyms** (Slice 2 uses the FSN, already parsed; preferred-term parsing is a later enhancement).
- RxNorm **non-semantic** concepts (synonym-only RXCUIs) — only semantic-TTY drug concepts become flat terms.
- RxNorm relationship/mapping extraction into `concept_map_elements` (out of scope).
- CLI parity + legacy-route removal (Slice 3).

## 3. Current state (what we build on)

- **Adapters** (`packages/terminology/src/ontology/adapters/{snomed,rxnorm}.ts`): stream via `createInterface`; `buildIndex(dist, writer, onProgress)`.
  - SNOMED builds `names: Map<conceptId, FSN>` from active FSN descriptions (typeId `900000000000003001`) and a `concepts: Set` of IS-A endpoints. Nodes get `display = names.get(code)`, `extra = { fsn }`.
  - RxNorm builds `concepts: Map<rxcui, { display, displayPrio, tty }>` from RXNORM ENG atoms (best display by priority), tracking `tty` for `SEMANTIC_TTYS`. Nodes get `display`, `extra = { tty, rxcui }`.
- **Adapter interface** (`packages/terminology/src/ontology/types.ts`): `OntologyAdapter.buildIndex(dist, writer: IndexWriter, onProgress): void | Promise<void>`. `IndexWriter` writes nodes/edges.
- **Build entry** (`packages/terminology/src/ontology/build.ts`): `buildOntologyDistribution(systemId, sourcePath, store, onProgress)` → `detectAdapter` → `adapter.buildIndex(dist, writer, onProgress)`.
- **Ontology API** (`packages/bootstrap/src/terminology-context.ts` `createOntologyApi`): `build(systemId, sourcePath, onProgress)` / `rebuild(...)` call `buildOntologyDistribution`.
- **LoaderStore** (`packages/terminology/src/loaders/generic.ts`): `{ upsertConcepts(ConceptRecord[]), upsertMapElements, saveResource, saveSystem(url, version, kind, resourceId), markSystemChanged(url) }`. `loadLoinc` streams `Loinc.csv` → `upsertConcepts` (1000-row batches) → `saveResource` (a `CodeSystem`, content `'not-present'`) → `saveSystem(LOINC_SYSTEM, …)` → `markSystemChanged(LOINC_SYSTEM)`.
- **`ConceptRecord`** (`packages/db/src/terminology-store.ts`): `{ system: string; code: string; display: string | null; status: string | null; properties: Record<string, unknown> | null }`.
- **Ingest core** (`packages/terminology/src/ingest/ingest-distribution.ts`): LOINC-only — throws for non-loinc; `deps.loadConcepts` + `deps.buildOntology`.
- **Route** (`apps/server/src/terminology-admin-routes.ts`): `SUPPORTED_SYSTEMS = new Set(['loinc'])`; resolve-or-create per publisher.
- **`canonicalSystemUrl`** (`packages/terminology/src/system-urls.ts`): already has all three URLs.
- **Studio** (`apps/studio/src/pages/Terminology.tsx`): "Import distribution…" gated on `isLoincPublisher`, hardcodes `systemType="loinc"`.

## 4. Design

### 4a. Concept sink on the adapter (tee)
Extend the adapter contract with an **optional** concept sink:

```ts
// types.ts
export type ConceptSink = (rows: ConceptRecord[]) => Promise<void>;   // batched; import ConceptRecord from @openldr/db
export interface OntologyAdapter {
  type: OntologyType;
  detect(folderPath: string): DetectedDistribution | null;
  buildIndex(dist: DetectedDistribution, writer: IndexWriter, onProgress: (p: Omit<OntologyBuildProgress,'codingSystemId'>) => void, conceptSink?: ConceptSink): void | Promise<void>;
}
```

- `buildIndex` implementations that don't emit concepts (LOINC) simply take fewer params — still assignable to the interface; **LOINC adapter unchanged**.
- The concept sink is **optional**: the ontology-only rebuild path (`ontology.build`/`rebuild` from `ontology-routes.ts`) calls with **no sink** → behaviour unchanged.
- `buildOntologyDistribution(systemId, sourcePath, store, onProgress, conceptSink?)` passes the sink through to `adapter.buildIndex`.

### 4b. SNOMED tee
In `snomedAdapter.buildIndex`, when `conceptSink` is provided, emit a `ConceptRecord` for **every entry in `names`** (all active FSN'd concepts — the fuller set), batched (1000 rows):

```ts
{ system: canonicalSystemUrl('snomed'), code: conceptId, display: fsn, status: 'active',
  properties: { semanticTag: parseSemanticTag(fsn), fsn } }
```

`parseSemanticTag(fsn)` = the trailing `(...)` group (e.g. `"… (disorder)"` → `"disorder"`), else null. The adapter imports `canonicalSystemUrl` from `../../system-urls` (single source of truth; matches the route's coding-system URL). Emission happens after the descriptions pass (or during the finalize loop) so all names are known.

### 4c. RxNorm tee
In `rxnormAdapter.buildIndex`, when `conceptSink` is provided, emit a `ConceptRecord` for **every rxcui in `concepts` whose `tty` is a semantic TTY** (i.e. `tty !== null`), batched:

```ts
{ system: canonicalSystemUrl('rxnorm'), code: rxcui, display: concept.display, status: 'active',
  properties: { tty: concept.tty } }
```

ATC atoms are not concepts (they're the classification spine) — excluded. Only RXNORM semantic drug concepts become flat terms.

### 4d. System registration tail (parity with `loadLoinc`)
Teeing concepts alone is not enough — `loadLoinc` also registers the CodeSystem so the terms are queryable/syncable. So for SNOMED/RxNorm, after the teed build, run the **same tail** `loadLoinc` runs: `saveResource` (a minimal `CodeSystem` resource, content `'not-present'`, url = `canonicalSystemUrl(systemType)`) → `saveSystem(url, null, 'CodeSystem', ref.id)` → `markSystemChanged(url)`. (The route's `upsertByUrl` only did the `coding_systems` admin projection; `saveSystem` does the `terminology_systems` registration + the sync signal.)

This lives in a small orchestrator that has both stores — see §4e.

### 4e. Ingest wiring
`ingestDistribution` dispatches by `systemType` (drop the non-loinc throw; keep the license check):

- **loinc:** unchanged — `deps.loadConcepts('loinc', dir, {acceptLicense})` then `deps.buildOntology('loinc', codingSystemId, dir, onProgress)` (no sink).
- **snomed / rxnorm:** `deps.buildOntologyWithConcepts(systemType, codingSystemId, dir, onProgress)` — a single teed build that returns `{ conceptsLoaded }`.

`deps.buildOntologyWithConcepts` (injected; real impl wired in bootstrap) does, against the real stores:
1. a batching `ConceptSink` over `loaderStore.upsertConcepts` that **counts** rows;
2. `buildOntologyDistribution(codingSystemId, dir, ontologyStore, onProgress, sink)`;
3. the §4d registration tail;
4. returns `{ conceptsLoaded: count }`.

Expose it on the terminology context (e.g. `ctx.terminology.ingestOntologyWithConcepts(systemType, systemId, dir, onProgress)`), since that's where both `ontologyStore` and `loaderStore` live. Bootstrap's `runIngest` (Slice 1 Task 6) wires `buildOntologyWithConcepts` to it.

**Guard — adapter type must match the job's systemType.** `buildOntologyDistribution` uses `detectAdapter(sourcePath)` (tries each adapter's `detect`). If an operator uploads a SNOMED zip to the RxNorm publisher, `detectAdapter` would pick `snomed` while the job says `rxnorm` → the ontology would key to the wrong coding system. Add a check: the detected `adapter.type` must equal the requested `systemType`, else throw a clear error (`failBuild` + reject) so the job fails cleanly rather than mis-ingesting.

### 4f. Enablement
- **Route:** `SUPPORTED_SYSTEMS = new Set(['loinc', 'snomed', 'rxnorm'])`. `canonicalSystemUrl` already returns all three; the `|| !canonicalSystemUrl(systemType)` guard stays.
- **Studio (`Terminology.tsx`):** show "Import distribution…" on the LOINC, SNOMED CT, and RxNorm publishers, passing the correct `systemType` per publisher. Add a small helper: publisher → systemType, e.g. by seeded id (`pub-loinc`→`loinc`, `pub-snomed-ct`→`snomed`, `pub-rxnorm`→`rxnorm`) or by matching the publisher's identity. The dialog + polling + purge take the resolved `systemType` (no longer hardcoded `'loinc'`). The generic license checkbox already covers SNOMED (affiliate) / RxNorm (UMLS) licenses.

## 5. Testing

- **SNOMED tee:** feed the adapter a tiny fixture (a few Description rows incl. FSN + a couple synonyms, a few Relationship IS-A rows) with a capturing `conceptSink`; assert it emits a `ConceptRecord` per active FSN'd concept with `system = http://snomed.info/sct`, `display = FSN`, `properties.semanticTag` parsed (e.g. `disorder`), and that a synonym-only/inactive row is excluded. Assert **no** concepts emitted when `conceptSink` is omitted (rebuild path unchanged).
- **`parseSemanticTag`:** `"Diabetes mellitus (disorder)"` → `"disorder"`; no-parens → null.
- **RxNorm tee:** fixture RXNCONSO rows (a semantic IN/SCD + a non-semantic/synonym atom + an ATC atom); assert a `ConceptRecord` only for the semantic-TTY rxcuis with `system = rxnorm url`, `display`, `properties.tty`; ATC + non-semantic excluded; none when sink omitted.
- **Adapter-type guard:** a distribution whose detected adapter type ≠ requested systemType → the build throws / job fails (not a silent mis-ingest).
- **`ingestDistribution` dispatch:** loinc still runs loadConcepts+buildOntology; snomed/rxnorm run buildOntologyWithConcepts and return its `conceptsLoaded` (injected fakes — no DB).
- **Route:** `POST …/publishers/pub-snomed-ct/distribution?systemType=snomed` is now accepted (not 400); a genuinely unknown systemType still 400s.
- **Studio:** "Import distribution…" appears + enabled on the SNOMED CT and RxNorm publishers and uploads with the right `systemType`.
- **(Optional, heavier) integration:** run `ingestOntologyWithConcepts` over the real `corlix/fixtures` SNOMED/RxNorm slices against a migrated DB; assert both the ontology node count and a non-zero `terminology_concepts` count for the system url. Gate: `pnpm turbo run typecheck test --force` (bootstrap/db/server parallel flakes pass in isolation, per [[repo-conventions]]).

## 6. Out of scope (later)
- **Slice 3:** CLI parity (`openldr terminology import/purge`), orphaned-`running`-job crash recovery, remove the legacy `POST /api/terminology/import/loinc`.
- SNOMED preferred synonyms; RxNorm concept_map_elements; other SNOMED description types.

## 7. Open questions / risks
- **Memory:** the tee holds the full display map in memory (SNOMED `names` ≈ all active concepts, ~350k+ strings) — already the adapter's existing footprint (it builds `names` regardless); teeing adds no new large structure. The batched sink bounds the DB write side.
- **`conceptsLoaded` count for the job:** comes from the sink's counter; surfaced in the completion notification metadata (same as LOINC).
- **Publisher→systemType mapping in Studio:** keyed by seeded publisher id is simplest; a custom publisher renamed "SNOMED" wouldn't map — acceptable (only the three seeded external publishers are supported).
