# Distributed Sync — S3: Terminology Pull (central → lab)

**Date:** 2026-07-14
**Slice:** S3 (third buildable slice of the distributed-sync workstream) — "terminology flows down"
**Branch:** `feat/sync-s3-terminology` (to cut)
**Parent architecture:** `docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md` (north-star, `6fc9bb75`)
**Predecessors:** S1 push (`origin/main` `c5131a31`), S2 pull reference-config (`origin/main` `fd7fee91`) — `docs/superpowers/specs/2026-07-14-distributed-sync-s2-pull-design.md`

## Context & why terminology is different

S2 built the reference-config pull: a `reference_change_log` (per-instance `seq`, `entity_type`, `entity_id`, `op`, `content_hash`), a `recordReferenceChange` capture helper (content-hash deduped), a `managed_origin` marker (lab-local vs central), the `POST /api/sync/pull` delta endpoint (dedup-to-latest, live-body, published-only), the `createSyncPullRunner`/`createSyncPullWorker` (`'sync-pull'` cursor, quarantine), and `applyReferenceChange` (capture-free, delete-guarded). It scoped to the small, PK'd config domains (forms/dashboards/reports/settings) and explicitly deferred terminology because terminology is **large, user-provided, and awkwardly stored**.

The terminology inventory confirms the shape:
- `terminology_concepts` — PK `(system, code)`, `system` = the code-system URL string (no FK). **No `updated_at`, `version`, `content_hash`, or generation column.** A single system (LOINC) is ~109k rows (~4.4s to load); SNOMED is far larger. Written by `upsertConcepts` (batched 1000-row `ON CONFLICT (system,code) DO UPDATE`).
- `concept_map_elements` — **no PK**, keyed by `map_url`; `upsertMapElements` is **delete-then-reinsert per `map_url`** (wholesale unit replace). No timestamps.
- `terminology_systems` — PK `url`, `version` (human code-system version string, e.g. "LOINC 2.76"; loaders pass `null`, never auto-bumped), `kind`, `resource_id`. Registry header (url → FHIR resource).
- `coding_systems` — PK `id`, unique `url`, `system_version`, `seeded`. Display metadata, small.
- `publishers` — PK `id`, small enum-like set.
- `term_mappings` — PK `id`, `from_*`/`to_*`, `owner`, `is_active`, **`created_at`/`updated_at`** (the only terminology table with timestamps). The lab's curated local mappings (projected into `concept_map_elements` under `LOCAL_MAP_URL`).

Terminology is **global reference data** (not site-scoped) — every enrolled lab pulls the same set. LOINC/SNOMED/RxNorm are strictly user-provided at runtime (admin import routes `POST /api/terminology/import/loinc`, `.../terms/import`; CLI `terminology import`); labs can import locally too, which is the coexistence problem below.

## Scope (decided: "everything terminology", built in two layers)

**In (all center-owned terminology):**
- **Layer A — small PK'd metadata (reuse S2's per-row model directly):** `publishers`, `coding_systems`, `term_mappings`.
- **Layer B — large unversioned bulk (new chunked path):** `terminology_concepts` (per code-system) and `concept_map_elements` (per concept map). The `terminology_systems` registry row is the signal carrier + descriptor for a code system and is transferred with its concepts.

**Explicitly lab-local, never pulled:** `term_mappings` rows the lab curated itself (identified by `owner` / a lab-local origin) — these back the lab's own `LOCAL_MAP_URL` curation and must survive untouched. Only central-authored `term_mappings` sync.

**Out (deferred):** concept-level deltas (S3 re-transfers a whole system on any change); disabling the lab's local-import UI (S4); `reference_change_log` compaction (S7); value_sets/valueset_expansions and ontology_* derived indexes (rebuilt locally from concepts — not synced).

Users/roles stay lab-local. Pull remains auth-only, not site-scoped.

## Ownership model (decided: per-unit origin marker, central wins on shared URLs)

- Add `managed_origin` (nullable `text`) to `terminology_systems`, `coding_systems`, `publishers`, `term_mappings`. `null` = lab-local (never touched by pull); `'central'` = center-managed (reconciled by pull).
- **Concepts inherit ownership from their system:** a concept's owner = its system's `managed_origin` (concepts are selected `WHERE system=url`), so `terminology_concepts` needs **no** per-row marker. The lab's whole-system reconcile only ever deletes/replaces concepts of a `managed_origin='central'` system.
- **Concept-map elements inherit ownership from their map:** ownership tracked per `map_url` (via the map's registry/`managed_origin`); `concept_map_elements` needs no per-row marker. `LOCAL_MAP_URL` (the lab's curated map) is lab-local and never pulled.
- **Shared URL ⇒ central wins.** A system URL both central and a lab imported (e.g. both `http://loinc.org`) is the SAME system; the first central pull stamps it `managed_origin='central'` and thereafter central owns it (whole-system replace). This matches S2's accepted managed-overwrite-of-built-ins policy. A lab's own distinct URLs (e.g. `http://myorg.org/cs/x`) stay lab-local.

## Design

### Layer A — small metadata via the S2 per-row model

Mechanical extension of S2, no new mechanism:
1. **`managed_origin`** column on `publishers`, `coding_systems`, `term_mappings` (migration).
2. **New `reference_change_log` entity types:** `'publisher' | 'coding_system' | 'term_mapping'` — add to `ReferenceEntityType` (`@openldr/db`) and `PullRecord.entityType` (`@openldr/sync`).
3. **Capture** on the write paths that author these (in `terminology-admin-store.ts`: `publishers.*`, `codingSystems.*`, `termMappings.*`) via the existing `ReferenceCapture` injected dependency + `canonicalHash` — exactly like S2's config stores. **`term_mappings` capture is gated to central-authored rows only** (a lab-local `owner` is not captured), mirroring S2's `CENTER_OWNED_SETTING_KEYS` allowlist idea.
4. **Serve** in the existing `POST /api/sync/pull` `fetchReferenceBody` — add branches returning the live `publishers`/`coding_systems`/`term_mappings` row for the id.
5. **Apply** in `applyReferenceChange` — add `publisher`/`coding_system`/`term_mapping` cases: upsert stamping `managed_origin='central'`, delete guarded by `managed_origin='central'`. Serialization mirrors each store's row mapping (jsonb `match_prefixes` etc. `JSON.stringify`'d).

Layer A carries no bulk; it proves the terminology entities through the already-battle-tested S2 path before Layer B adds the hard part.

### Layer B — bulk concepts + concept maps

**B1. The change signal (import-operation-granular, per system/map).**
- Add a monotonic `generation bigint NOT NULL DEFAULT 0` column to `terminology_systems` (and a per-map equivalent — see B4).
- Add `markTerminologyChanged(systemUrl)` (and `markConceptMapChanged(mapUrl)`) helpers that, in one transaction: bump the unit's `generation`, and `recordReferenceChange(trx, 'terminology_system'|'concept_map', url, 'upsert', String(generation))`. Because `recordReferenceChange` dedups by `content_hash` (= the generation), a re-mark with an unchanged generation is a no-op — but since `mark*` always bumps, each real mark emits exactly one row.
- **Call `mark*` at operation COMPLETION, not per store-write batch** — the write paths flush 1000-row batches, so marking per-batch would emit N rows per import. Instrument the completion points: the loaders (`loaders/loinc.ts`, `loaders/whonet.ts`, `importTerminologyResource`), the admin import route (`terms/import`), and admin single-concept `terms.create/update/delete` (each marks its system once). `upsertMapElements` marks the affected `map_url`(s) once (it already batches a whole map).
- A `terminology_system` (or `concept_map`) signal record carries only the system/map descriptor + generation as its `body` — NOT the concepts (the endpoint's `fetchReferenceBody` returns the small `terminology_systems` row + generation, never 100k concepts).

**B2. Bulk transfer endpoints (chunked, keyset-paginated, resumable).**
- `POST /api/sync/terminology/concepts` `{ systemUrl, afterCode, limit? }` → `{ concepts: ConceptRow[], nextCode: string | null }`. Keyset page: `WHERE system=systemUrl AND code > afterCode ORDER BY code LIMIT (limit ?? 1000)`; `nextCode` = last code returned, or `null` when the page was short (done). Keyset (not offset) so it's stable + resumable across flaky links and concurrent central writes.
- `POST /api/sync/terminology/map-elements` `{ mapUrl, afterKey, limit? }` → `{ elements: MapElementRow[], nextKey | null }` — same keyset shape over `(source_system, source_code)` within a `map_url`.
- Both reuse the `/api/sync/` auth bypass + `sitePrincipal` (auth-only, global — not site-scoped). Gzip deferred to S7.

**B3. Lab-side bulk-sync + whole-system reconcile.**
- The pull worker's `applyRecord`, on a `terminology_system` (or `concept_map`) record, does NOT call the pure DB-only `applyReferenceChange`; it invokes a **bulk-sync routine** (in the worker/deps layer, which has network + DB): page every concept for `systemUrl` from `/api/sync/terminology/concepts`, then in one transaction **reconcile**: upsert each pulled concept (`ON CONFLICT (system,code) DO UPDATE`), then `DELETE FROM terminology_concepts WHERE system=systemUrl AND code NOT IN (<pulled codes>)` scoped to the system, and upsert the `terminology_systems` row stamping `managed_origin='central'` + the pulled `generation`. (For very large systems the delete-not-in set is handled by staging the pulled codes in a temp/known set — implementation detail for the plan.)
- Idempotent: re-running a bulk-sync at the same generation re-upserts identical rows and deletes nothing.
- **Cursor policy (chosen, unlike S2's uniform quarantine):** a bulk-sync is all-or-nothing per system — the `'sync-pull'` cursor advances past a `terminology_system`/`concept_map` signal record **only after that system/map has fully drained + reconciled in its transaction**. A mid-transfer failure (a page fetch or the reconcile txn throws) does NOT advance the cursor, so the whole system retries next cycle (a partial bulk transfer must never be treated as "done"). The pure-applier per-row records (S2's + Layer A's `publisher`/`coding_system`/`term_mapping`) keep S2's quarantine semantics. When a pull response mixes both kinds, the worker advances to the highest seq that is safe — i.e. it stops advancing at the first failed bulk record. (Plan detail: process a response's records in seq order and cap the cursor advance at the last fully-succeeded record.)
- Concept maps: same, but whole-map replace (delete-then-reinsert by `map_url`), matching central's own `upsertMapElements` model.
- Lab-local systems/maps (managed_origin NULL / distinct URLs) are never touched.

**B4. Concept-map ownership + generation.** Concept maps have no natural registry row today. Track per-map state (managed_origin + generation) in a small companion — either extend `terminology_systems` to also register `kind='ConceptMap'` rows (if `saveSystem` already does for imported ConceptMaps — confirm at plan time) or add a tiny `concept_map_state(map_url PK, generation, managed_origin)` table. The plan picks the lighter option after reading how imported ConceptMaps register today.

### Worker wiring

The existing `createSyncPullWorker` + `'sync-pull'` cursor already drain `reference_change_log`. S3 extends the worker's `applyRecord` dep so that `terminology_system`/`concept_map` records route to the bulk-sync routine (which needs `centralUrl` + token + the terminology store), while `publisher`/`coding_system`/`term_mapping`/(S2's form/dashboard/report/setting) records continue through `applyReferenceChange`. No new worker/cursor — one pull stream, two apply paths. Config-gated by the same `sync.enabled`; token provider shared.

## Testing

- **Unit:** `markTerminologyChanged`/`markConceptMapChanged` (bump + one deduped log row); the bulk endpoints (keyset paging, `nextCode`/`nextKey` termination, auth 401/403); the bulk-sync reconcile (upsert + delete-not-in scoped to system, managed_origin stamp, lab-local system untouched); Layer-A capture/serve/apply for publisher/coding_system/term_mapping (incl. lab-local `term_mapping` NOT captured); `applyReferenceChange` new cases.
- **Integration — `pnpm sync:terminology:accept`** (two internal PG DBs on :5433, mirroring `scripts/sync-pull-live-acceptance.ts`): central imports a code system with a few hundred concepts + a concept map + a coding_system/publisher/central term_mapping → each emits the right `reference_change_log` rows (one `terminology_system` signal, one per metadata row). A lab pre-holds (i) a lab-local system (distinct URL) with concepts and (ii) a lab-local `term_mapping`. Drain pull → assert:
  1. lab mirrors the central system's concepts (paged transfer completed), `terminology_systems.managed_origin='central'`; metadata rows mirrored + stamped;
  2. the lab-local system + its concepts + the lab-local `term_mapping` are **untouched**;
  3. central **adds** a concept + **removes** another + re-imports (generation bumps) → drain → lab reflects the add AND the removal (whole-system reconcile deletes the dropped concept);
  4. a shared-URL system the lab also imported locally → after pull it's `managed_origin='central'` and matches central (central won);
  5. re-drain with no central change → 0 work, cursor unchanged (generation unchanged → no new signal);
  6. concept map: central map mirrored; `LOCAL_MAP_URL` lab curation untouched.

## Deliberate shortcuts (S3)

- In-process bulk endpoints in the acceptance harness (auth/HTTP unit-proven in the endpoint tests), as S1/S2 did.
- Whole-system re-transfer on any change (no concept-level deltas) — the honest unit given no per-concept versioning; delta optimization deferred.
- Generation signal (not content-hash) — terminology imports are rare + admin-initiated (seed path is idempotent-guarded, no per-boot spurious signal), and a real change re-transfers wholesale anyway, so a content-hash's only saving (skip a no-op re-import) isn't worth maintaining an aggregate concept hash.
- No gzip / no LISTEN-wakeup (fixed interval) — S7.
- Enrollment automation + operator UI + config-surface reconciliation remain S4.

## Build order (implementation plan will detail)

**Layer A:** (A1) `managed_origin` on publishers/coding_systems/term_mappings + entity types; (A2) capture in `terminology-admin-store` write paths (term_mapping gated to central-authored); (A3) serve branches in `/api/sync/pull`; (A4) apply cases in `applyReferenceChange`.
**Layer B:** (B1) `generation` column(s) + `markTerminologyChanged`/`markConceptMapChanged` + instrument import-completion points; (B2) bulk endpoints (keyset paging); (B3) lab bulk-sync + whole-system/map reconcile + worker `applyRecord` routing; (B4) concept-map state.
**Close:** (C1) two-PG `pnpm sync:terminology:accept`; (C2) gate (incl. S1 `sync:accept` + S2 `sync:pull:accept` regressions) + whole-slice review + merge + (push on user go).

## Relates to

[[distributed-sync-central-workstream]] (parent), S2 pull (predecessor — reuses `reference_change_log`, `'sync-pull'` cursor, `createSyncPullRunner`/`createSyncPullWorker`, `sitePrincipal`, `applyReferenceChange`, `managed_origin` pattern, `canonicalHash`), the terminology subsystem (`terminology-store`/`terminology-admin-store` + loaders + admin/CLI import), the S2 config-surface reconciliation deferred to S4.
