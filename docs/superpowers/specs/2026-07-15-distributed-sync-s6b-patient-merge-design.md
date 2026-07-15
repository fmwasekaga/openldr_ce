# Distributed Sync S6b — Patient MPI Merge (intra-lab) (design)

**Date:** 2026-07-15
**Status:** Approved (brainstorm) → ready for implementation plan
**Workstream:** distributed-sync. S1–S5 + **S6a result amendment** + **S6c order status** all DONE (merged local `main`). This is the **third and final co-edit sub-slice**.
**North-star:** `docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md` §5 ("patient MPI merge: the center emits a `Patient.link` (`type: replaced-by`) pointing at the canonical merged identity; the lab adopts the canonical id and marks its local record replaced"). S6a spec: `2026-07-15-distributed-sync-s6a-result-amendment-design.md`; S6c: `2026-07-15-distributed-sync-s6c-order-status-design.md`.

---

## 1. Summary

When a patient is registered twice at a lab (two visits → two `Patient` records for one person), central's MPI detects the duplicate and an operator decides a merge. **S6b syncs that merge as a batch of central-authored version bumps riding S6a's amendment transport:** the duplicate `Patient` gets a new version (`active:false` + `link replaced-by` survivor), and every resource that referenced the duplicate (`Observation`/`ServiceRequest`/`DiagnosticReport`/`Specimen`) gets a new version with its `subject` re-pointed to the survivor. The lab drains them over the existing stream, applies via the untouched `applyRemote`, and the projection re-derives — **unifying the patient's lab history under the survivor and marking the duplicate superseded**.

Unlike S6a/S6c (which version-bump one resource and let the read model re-derive), a merge is an identity operation spanning many resources. But by modelling it as a cascade of version bumps, S6b reuses the entire transport + `applyRemote` + the version-write helpers; the genuinely-new piece is **one atomic central primitive** (`mergePatients`) plus a small read-model marker.

## 2. Scope decisions (from brainstorm)

1. **Intra-lab dedup only.** The survivor (canonical) is one of the lab's *own* existing patients; both records already exist at the lab and are lab-owned by the same site; ownership is preserved. **Deferred:** cross-lab / foreign-canonical MPI identity (central introducing a patient the lab doesn't have).
2. **FHIR re-versioning cascade.** The merge = a batch of version bumps (duplicate `Patient` link + each referencing resource's `subject` re-point), not a lab-side read-model cascade and not a link-aware projection. The read model stays a **pure projection of the change_log** (the workstream's load-bearing invariant).
3. **Atomic `mergePatients` db-layer method.** The whole cascade (all version bumps + outbox rows + Provenance) is authored in **one central transaction** — central never emits a partial merge. The lab applies incrementally (eventually consistent).
4. **Surface the merge in the `patients` read model** — add `active` + `replaced_by_id` columns so a patient list can distinguish superseded duplicates, not just unify lab-data attribution.

Defaults (unless revisited): the **survivor stays untouched** (no demographic absorption in v1); the duplicate `Patient` amend uses Provenance activity **`merge`**; reference re-points are recorded under the single merge Provenance.

## 3. The `mergePatients` primitive (`@openldr/db` `fhir-store.ts`)

`mergePatients(input: { survivorId: string; duplicateId: string; agent: string; reason?: string }): Promise<MergeResult>` — a new `FhirStore` method. It does **not** go through the public `amend`/`AMENDABLE_TYPES` allowlist; it writes versions directly via the existing `writeVersion`/`nextVersion` helpers (so the allowlist is untouched — `Patient`/`Specimen` need not be added to it).

**Steps:**
1. **Validate:** both Patients exist (`ResourceNotFoundError`-style `PatientNotFoundError` otherwise); both lab-owned by the **same** `site_id` (resolved from each one's latest `change_log` row) → else `CrossSiteMergeError`; `survivorId !== duplicateId` → else `SamePatientError`.
2. **Enumerate** the resources referencing the duplicate from the **read model as a reverse index**: `SELECT id FROM {lab_requests, lab_results, specimens, diagnostic_reports} WHERE patient_id = duplicateId`. (Central projects the lab's mirrored data, so `patient_id` is populated. Limitation: a ref pushed up but not yet projected at central could be missed — documented; self-heals on re-run since re-point is idempotent.)
3. **In one transaction**, reusing `writeVersion`/`nextVersion` (each write keeps the owning lab's `site_id`):
   - version-bump the duplicate `Patient`: body `{ ...dup, active: false, link: [...(existing link ?? []), { type: 'replaced-by', other: { reference: 'Patient/' + survivorId } }] }`.
   - for each enumerated referencing resource: read its current central body, patch `subject` → `{ reference: 'Patient/' + survivorId }`, version-bump it.
   - write **one merge `Provenance`** (version 1): `target` = references to all changed resources (duplicate `Patient` + each re-pointed ref), `activity` coding `{ system: v3-DataOperation, code: 'MERGE', display: 'merge' }`, `agent`, optional `reason`, `recorded`.
   - write `sync_amendments` outbox rows for: the duplicate `Patient`, each re-pointed resource, and the merge `Provenance` — all stamped with the owning `site_id`.
4. **Return** `{ survivorId, duplicateId, repointed: <count>, provenanceId, siteId }`.

The survivor's body is **not** rewritten. The cascade is all-or-nothing (atomic authoring). The `change_log`-ordering invariant (change_log insert never a transaction's first write) is preserved because `writeVersion` already inserts history→resources→change_log in that order and the enumeration SELECTs are read-only.

**New typed errors:** `PatientNotFoundError`, `CrossSiteMergeError`, `SamePatientError` (each with a distinct `name`). `MergeResult` interface as above.

## 4. Read-model change: surface the merge in `patients`

**Migration (external schema):** add to `patients`:
- `active boolean` default `true` (from `Patient.active`).
- `replaced_by_id text` nullable (from the `replaced-by` link's target id).

No data migration for existing rows (defaults are correct: active, not replaced).

**`projectPatient` update** (`packages/db/src/relational/patient.ts`, already parses the Patient body):
- `active`: `r['active']` coerced to boolean, defaulting to `true` when absent (FHIR: a Patient with no `active` is active).
- `replaced_by_id`: find the `link` entry with `type === 'replaced-by'`, take `other.reference`, strip the `Patient/` prefix → survivor id; `null` when no such link.

Also update the `PatientsTable` type + `export-data` column list if it enumerates patient columns.

After a merge re-projects at the lab, the duplicate's `patients` row shows `active:false` + `replaced_by_id: <survivor>`; the survivor is unambiguous. The `patient_id` re-attribution in the 4 tables re-derives for free from the re-pointed `subject`s.

## 5. Operator surface

Minimal primitive + CLI + endpoint (S6a/S6c precedent; MPI-matching UI deferred). `mergePatients` is orchestrated thinly from `@openldr/bootstrap` (enumeration lives in the db method; the bootstrap layer validates input + is the shared home for CLI/HTTP per CLI-operator-parity).

- **CLI:** `openldr sync merge-patient --survivor <id> --duplicate <id> [--reason "<text>"] [--json]` — prints `{survivorId, duplicateId, repointed, provenanceId, siteId}`; errors → exit 1 with friendly messages.
- **HTTP:** `POST /api/settings/sync/merge-patient` (`requireRole('lab_admin')`, user-authed, under `/api/settings/sync/*` — **not** the machine surface). Errors: `PatientNotFoundError` → 404, `CrossSiteMergeError` → 409, `SamePatientError` → 400, bad input → 400. Audited `settings.sync.merge` PHI-free (`{survivorId, duplicateId, repointed, provenanceId}` — ids/counts only, no demographics).

## 6. Transport & apply — unchanged (the payoff)

The merge's outbox rows are ordinary `sync_amendments` entries → `serveAmendments` (site-scoped) → the amendment pull runner (`'sync-amend-pull'` cursor) → `applyRemote`. The duplicate `Patient`, the re-pointed refs, and the merge `Provenance` all apply as normal versioned records; the projection re-derives. **Nothing to build in the serve / route / runner / bootstrap wiring / `applyRemote` / the `sync_amendments` table.**

## 7. Testing

- **Unit (`mergePatients`):** marks the duplicate `active:false` + `link replaced-by` survivor; each referencing resource's `subject` re-points to survivor and its version bumps; one merge `Provenance` (`activity MERGE`) targeting all changed resources; correct outbox rows (duplicate + M refs + Provenance), all stamped with the site; cross-site (different `site_id`) → `CrossSiteMergeError`; `survivor===duplicate` → `SamePatientError`; missing patient → `PatientNotFoundError`; atomicity (a mid-cascade failure writes nothing).
- **Unit (`projectPatient`):** `active` defaults true / reads false; `replaced_by_id` extracted from a `replaced-by` link (null otherwise).
- **Live acceptance** — `scripts/sync-patient-merge-live-acceptance.ts` + `pnpm sync:patient-merge:accept` (two internal DBs + a lab target DB, modeled on the S6c harness `sync-order-status-live-acceptance.ts`): lab creates two Patients (survivor + duplicate) + a couple of results/orders referencing the **duplicate**, mirrored up → central `mergePatients(survivor, duplicate)` → lab pulls the amendment stream → assert: the lab's duplicate `Patient` is `active:false` + `link replaced-by survivor`; the lab's results now have `subject = Patient/survivor`; **read model unified** (drive the projection runner as the S6c harness does) — `lab_results`/`lab_requests`.`patient_id = survivor`, and the duplicate's `patients` row shows `active:false` + `replaced_by_id = survivor`; the merge `Provenance` landed; cross-site isolation (a 2nd site sees nothing); idempotent re-drain (a second drain applies nothing).
- **Regression:** `pnpm sync:amend:accept` + `pnpm sync:order-status:accept` + the full per-package gate stay green.

## 8. Components

| Piece | Package / file |
|---|---|
| `mergePatients` atomic primitive + `MergeResult` + `PatientNotFoundError`/`CrossSiteMergeError`/`SamePatientError` | `@openldr/db` `fhir-store.ts` (reuses `writeVersion`/`nextVersion`) |
| `patients.active` + `patients.replaced_by_id` migration | `@openldr/db` external migrations + `schema/external.ts` |
| `projectPatient` reads `active` + `replaced_by_id` | `@openldr/db` `relational/patient.ts` |
| `mergePatients` orchestrator (validate + surface) | `@openldr/bootstrap` |
| `POST /api/settings/sync/merge-patient` (lab_admin) | `@openldr/server` `settings-routes.ts` |
| `openldr sync merge-patient` | `@openldr/cli` `sync.ts` + `index.ts` |
| Patient-merge round-trip acceptance | `scripts/sync-patient-merge-live-acceptance.ts` + `package.json` |
| Docs (merge-patient usage) | `docs/` (CLI/HTTP/operator) |
| **Transport / serve / runner / wiring / `applyRemote` / `sync_amendments`** | **unchanged — nothing to build** |

## 9. Build / process conventions

- Branch `feat/sync-s6b-patient-merge`; subagent-driven per task with two-stage review; merge `--no-ff` to local `main`.
- Gate per-package on Windows (`pnpm --filter <pkg> exec vitest run` / `tsc --noEmit`); never pipe turbo through `tail`. The external-schema migration touches the analytics DB — the live acceptance needs the lab target DB (like the S6c harness).
- Ask before pushing to origin. **No `Co-Authored-By` trailer.**

## 10. Follow-ups after S6b (co-edit workstream complete)

With S6a/S6c/S6b done, the co-edit set from north-star §5 is fully synced. Remaining:
- **S7 hardening:** same-version divergence detection; versioned Provenance `target`; bundle/store-and-forward parity for amendments/merges; cross-lab / foreign-canonical MPI (Q1 Option B); demographic absorption into the survivor; un-merge/split; automated MPI *matching* (S6b syncs an operator-decided merge, it does not detect duplicates); the standing S5 deferrals (studio key reveal, bundle encryption, central-key rotation); the amend/merge studio validation UI.
