# Terminology upload — fresh-install coding-system auto-provision (Slice 1.1) — design

- **Date:** 2026-07-21
- **Status:** approved (brainstorm) → ready for implementation plan
- **Depends on:** Slice 1 (`docs/superpowers/specs/2026-07-20-terminology-distribution-upload-ingest-design.md`), merged local `main` `6f6c91b6`.
- **Scope:** Remove the fresh-install chicken-and-egg so an operator can upload a LOINC distribution from the LOINC **publisher** with no pre-existing coding system. Reshape the distribution routes to be **publisher-scoped**, and resolve-or-create the coding system server-side from a loader-backed **canonical system URL**. Generic plumbing for all three systems; enablement stays LOINC-only.

## 1. Motivation

Slice 1's upload route is keyed on a coding-system id (`POST /api/terminology/systems/:id/distribution`). But a fresh install seeds only the LOINC **publisher** (`pub-loinc`), not a coding system — the coding system was historically created *implicitly* during `loadLoinc` (`saveSystem` → `codingSystems.upsertByUrl`). So the Studio "Import distribution…" item is **disabled until a coding system exists**, forcing the operator to manually create one (Code system → New) before the very first import. That is the exact rough edge the upload feature set out to remove, and it bites hardest on the fresh production installs the feature targets.

**Goal:** open the LOINC publisher → "Import distribution…" → upload; the coding system is auto-created behind the scenes, keyed identically to what the loader creates (one row, no duplicates).

## 2. Goals / Non-goals

**Goals**
- Upload works from the LOINC **publisher** with no pre-existing coding system.
- The route resolve-or-creates the coding system by the **loader's canonical system URL**, using the *same* `url`/`systemCode`/`publisherId` values `loadLoinc`'s `saveSystem` uses (so the pre-created row and the loader's upsert are the same row).
- Distribution routes become **publisher-scoped** (`/publishers/:publisherId/distribution`).
- Studio "Import distribution…" moves to the publisher level, **always enabled** for a supported publisher (drop the disabled-until-coding-system logic).
- Plumbing is **system-agnostic** (systemType-parameterized); enablement stays gated by `SUPPORTED_SYSTEMS = {loinc}`.

**Non-goals**
- SNOMED/RxNorm term extraction or enablement (Slice 2) — the plumbing is generic but the gate stays LOINC-only.
- Legacy `POST /api/terminology/import/loinc` removal (Slice 3).
- Seeding coding systems on fresh install (rejected in brainstorm — resolve-or-create is self-healing).
- Back-compat for the Slice-1 `/systems/:id/distribution` routes: Slice 1 is **unpushed**, so the routes are replaced outright, not deprecated.

## 3. Current state (what we build on)

- **Seeds:** `packages/db/src/seed-publishers.ts` — `SEED_PUBLISHERS` seeds publishers only (`pub-loinc` matchPrefixes `['http://loinc.org']`, `pub-snomed-ct` `['http://snomed.info/']`, `pub-rxnorm` `['http://www.nlm.nih.gov/research/umls/rxnorm']`). `deriveSystemCode(url)` and `resolveSeedPublisherId(url)` live here.
- **Loader parity:** `terminology-context.ts`'s `loaderStore.saveSystem` calls `admin.codingSystems.upsertByUrl({ url, systemCode: deriveSystemCode(url), systemName: deriveSystemCode(url), systemVersion, publisherId: resolveSeedPublisherId(url) })`. `loadLoinc` keys concepts + `saveSystem` on `LOINC_SYSTEM = 'http://loinc.org'` (`packages/terminology/src/loaders/loinc.ts`). **The route must mirror these exact values.**
- **Store (`packages/db/src/terminology-admin-store.ts`):** `codingSystems.list(publisherId?) → CodingSystem[]` (items carry `id` + `url`) and `codingSystems.upsertByUrl(...)` exist. **`codingSystems.getByUrl` does NOT exist** (only `valueSets.getByUrl` does, line 156/614). The admin `Publisher` type does **not** expose `matchPrefixes` — do not rely on it.
- **⚠ matchPrefix ≠ canonical URL:** LOINC's matchPrefix equals its canonical URL, but SNOMED's matchPrefix (`http://snomed.info/`) ≠ its canonical coding-system URL (`http://snomed.info/sct`). The canonical URL must come from the **loader**, not the publisher.
- **Slice-1 routes (to be replaced):** `apps/server/src/terminology-admin-routes.ts` — `POST/GET/DELETE /api/terminology/systems/:id/distribution`, `SUPPORTED_SYSTEMS = new Set(['loinc'])`, `UPLOAD`/`MANAGE` guards.
- **Studio:** `apps/studio/src/pages/Terminology.tsx` gates "Import distribution…" on `isLoincPublisher` + a LOINC coding system existing; `apps/studio/src/api.ts` `uploadTerminologyDistribution(codingSystemId, systemType, …)` / `getTerminologyIngestJob(codingSystemId, systemType)` / `purgeTerminologyDistribution(codingSystemId, systemType)`.

## 4. Design

### 4a. `canonicalSystemUrl(systemType)` — single source of truth
New helper exported from `@openldr/terminology` (co-located with the loaders/adapters that already hold these constants):

```ts
// packages/terminology/src/system-urls.ts
export type SupportedSystemType = 'loinc' | 'snomed' | 'rxnorm';
const CANONICAL_SYSTEM_URL: Record<SupportedSystemType, string> = {
  loinc: LOINC_SYSTEM,                                  // reuse the loader constant = 'http://loinc.org'
  snomed: 'http://snomed.info/sct',
  rxnorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
};
export function canonicalSystemUrl(systemType: string): string | null {
  return (CANONICAL_SYSTEM_URL as Record<string, string>)[systemType] ?? null;
}
```

- `loinc` MUST reuse the existing `LOINC_SYSTEM` constant (not a re-typed literal) so the route and `loadLoinc` provably agree.
- `snomed`/`rxnorm` entries exist (generic plumbing) but are unused until Slice 2 (gate is LOINC-only). Slice 2's loaders should switch to referencing these too.

### 4b. `codingSystems.getByUrl(url)` — store method
Add to `TerminologyAdminStore.codingSystems` (mirrors `valueSets.getByUrl`):

```ts
getByUrl(url: string): Promise<CodingSystem | null>;
```

Implementation: single-row `selectFrom('coding_systems').where('url','=',url)` mapped to `CodingSystem`. (Alternative if a store change is undesirable: `list().find(s => s.url === url)` — but a dedicated method is cleaner and reused by the route.)

### 4c. Publisher-scoped routes + resolve-or-create (`terminology-admin-routes.ts`)
Replace the three `/systems/:id/distribution` routes with publisher-scoped equivalents:

- `POST /api/terminology/publishers/:publisherId/distribution?systemType=loinc&acceptLicense=true&version=…` (`UPLOAD` guard):
  1. `if (!SUPPORTED_SYSTEMS.has(systemType))` → 400.
  2. `if (acceptLicense !== 'true')` → 400 (nothing stored).
  3. `const url = canonicalSystemUrl(systemType)`; if null → 400.
  4. **Resolve-or-create the coding system**, mirroring the loader exactly:
     ```ts
     let cs = await admin.codingSystems.getByUrl(url);
     if (!cs) {
       await admin.codingSystems.upsertByUrl({
         url, systemCode: deriveSystemCode(url), systemName: deriveSystemCode(url),
         systemVersion: version ?? null, publisherId: resolveSeedPublisherId(url),
       });
       cs = await admin.codingSystems.getByUrl(url); // read back the id
     }
     const codingSystemId = cs!.id;
     ```
     (`deriveSystemCode` / `resolveSeedPublisherId` imported from `@openldr/db`, same as `terminology-context.ts`.) The `:publisherId` path param is the UI's navigational context and the audit subject; the coding system's `publisherId` comes from `resolveSeedPublisherId(url)` so it matches the loader's linkage. Optionally audit a mismatch, but do not hard-fail on it.
  5. `hasActive(systemType)` → 409.
  6. Stream `req.body` → `blob.putStream(key, …)` (key `terminology-dist/${systemType}/${codingSystemId}-${Date.now()}.zip`), `enqueue({ systemType, codingSystemId, blobKey, version, createdBy })`.
  7. Audit `terminology.distribution.uploaded` (metadata: `publisherId`, `codingSystemId`, `systemType`, `version`, `jobId`). Return 201 `{ jobId }`.
- `GET /api/terminology/publishers/:publisherId/distribution/job?systemType=…` (`MANAGE`): unchanged job lookup (`latestForSystem(systemType)` → status fields, 404 if none). Comment it systemType-scoped.
- `DELETE /api/terminology/publishers/:publisherId/distribution?systemType=…` (`MANAGE`): `latestForSystem(systemType)` → `blob.delete(job.blobKey)`; audit `terminology.distribution.purged` with `entityId: job?.codingSystemId ?? <resolved>`, metadata `{ systemType, jobId }`. 204.

`SUPPORTED_SYSTEMS` stays `new Set(['loinc'])`. No change to the worker / `ingestDistribution` (still LOINC-only).

### 4d. Studio (`Terminology.tsx`, `api.ts`)
- **api.ts:** change the three client fns to publisher-scoped, taking a `publisherId`:
  - `uploadTerminologyDistribution(publisherId, systemType, file, acceptLicense, version, onProgress?)` → `POST …/publishers/${publisherId}/distribution?…`.
  - `getTerminologyIngestJob(publisherId, systemType)`, `purgeTerminologyDistribution(publisherId, systemType)` → same path shape.
- **Terminology.tsx:** "Import distribution…" moves to the publisher level for a supported publisher (`isLoincPublisher`), **always enabled** — remove the `loincSystemInSection`/disabled-until-coding-system gate. The dialog/upload/status/purge pass the **publisher id** (+ `systemType: 'loinc'`). Status badge + polling key off the publisher. "Delete stored distribution" stays a publisher-level item.
- Enablement stays LOINC-only (only the LOINC publisher shows the item); SNOMED/RxNorm publishers show nothing until Slice 2.

## 5. Testing

- **`canonicalSystemUrl`:** `loinc` → `LOINC_SYSTEM` (`'http://loinc.org'`); unknown → null. Assert the loinc value is the *same reference/string* the loader uses (import `LOINC_SYSTEM`).
- **`codingSystems.getByUrl`:** returns the row for a known url, null for an absent one (against a migrated test DB).
- **Route (`terminology-admin-routes.test.ts`, publisher-scoped):**
  - upload when **no** coding system exists → `upsertByUrl` called with `{ url:'http://loinc.org', systemCode:'LOINC', publisherId:'pub-loinc' }`, job enqueued with the resolved `codingSystemId`, 201 `{ jobId }`. (Fake `admin.codingSystems.getByUrl`/`upsertByUrl` + `latestForSystem`.)
  - upload when the coding system **already** exists → `upsertByUrl` NOT called, existing id reused.
  - 400 unsupported systemType; 400 missing license (nothing stored); 409 active; 403 `lab_technician`.
  - purge audit records the job's `codingSystemId`.
- **Studio:** "Import distribution…" is **enabled** on the LOINC publisher with **no** coding system present; uploading posts to `…/publishers/pub-loinc/distribution` with `systemType=loinc` (mock `@/api`). Parity unaffected (no new i18n keys).
- Gate: `pnpm turbo run typecheck test --force` (per [[repo-conventions]]; bootstrap/db/server parallel flakes pass in isolation).

## 6. Out of scope (later slices)
- **Slice 2:** SNOMED/RxNorm flat-term extractors + flip `SUPPORTED_SYSTEMS`; their loaders reference `canonicalSystemUrl` too (reconciles SNOMED's matchPrefix≠canonical-URL issue by construction).
- **Slice 3:** CLI parity, orphaned-`running`-job crash recovery, remove the legacy `POST /api/terminology/import/loinc`.

## 7. Open questions / risks
- **`upsertByUrl` id scheme:** relies on reading the id back via `getByUrl` after upsert (not constructing `cs-<CODE>-<pub>`), so it's robust to the store's internal id choice.
- **`:publisherId` vs resolved publisher:** the coding system's `publisherId` is `resolveSeedPublisherId(url)` (authoritative, matches the loader); the path `:publisherId` is navigational. A mismatch (operator on a different publisher) is not expected via the UI; do not hard-fail, but it's fine to log/audit.
