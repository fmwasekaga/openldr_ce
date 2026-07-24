# Documentation data → CE as QuestionnaireResponse (CE-side design)

**Date:** 2026-07-24
**Repo:** `openldr_ce` (CE side). Companion spec for the producer lives in
`cdr-toolchain/docs/superpowers/specs/2026-07-24-documentation-fhir-ce-delivery-design.md`.

## Problem

DISA specimens carry two kinds of observations: real instrument **test** results and
**documentation** (non-test questionnaire/metadata — e.g. HIV viral-load indication, ART/EID
programmatic fields). In the v2 OpenLDR platform, cdr-toolchain split these apart and routed
documentation to a dedicated **forms feed**, so the two were stored distinctly.

That capability was never ported to CE. On the CE ingest path, cdr-toolchain's `export-batch`
builds the FHIR payload with `excludeObs: isDocumentationObs` and has **no forms leg**, so
documentation observations are silently **dropped** — they never reach CE. For a Zambian batch
(where the whole `VIRAL` panel is documentation) or a Tanzanian batch (`ARTID`/`EIDID`/`VLID`),
this means documentation-heavy records produce empty/invalid lab payloads and appear to "fail"
or "not arrive." This is the likely mechanism behind the field report of "~90 of 100 rejected."

This spec covers the **CE side**: what CE must accept and how documentation data is projected
into a queryable read model. The **producer** side (building the FHIR and posting it) is the
companion cdr-toolchain spec.

## Approach

Documentation data reaches CE as a FHIR **`QuestionnaireResponse`** (one per documentation
`form_code` per specimen), plus a minimal **`Questionnaire`** per `form_code` (the "form"),
delivered in the **same bare FHIR array** cdr-toolchain already POSTs to the existing CE
workflow webhook. No new ingest endpoint, no new webhook, no new auth path.

This is deliberately FHIR-native rather than routing documentation through CE's `Form Validate`
node: documentation params are **dynamic per panel** and live in cdr-toolchain's DISA codebook,
not CE. Baking per-panel fields into a CE form would violate the "don't hardcode vocabularies"
rule and fight `Form Validate`'s strict field checking. A `QuestionnaireResponse` carries its
answers as a dynamic `item[]` list, needs no fixed CE form definition, and — critically — is
**not a lab result**, so it is exempt from the clinical validation that rejects unlinked results.

### Why it already validates (no ingest change needed)

CE's persist path runs `validateBatch` (`packages/fhir/src/validate-batch.ts`):

1. **Structural validation — always.** `Questionnaire` and `QuestionnaireResponse` schemas are
   already registered (`packages/fhir/src/resources/forms.ts`; proven by
   `packages/fhir/src/resources/forms.test.ts`), so both pass `validateResource`.
2. **Clinical rules — level-gated.** The only clinical rule is `result-requires-request`
   (`packages/fhir/src/rules/result-requires-request.ts`), whose `appliesTo` is `isLabResult`:
   an `Observation` with `category=laboratory` or a `DiagnosticReport` with `category=LAB`. A
   `QuestionnaireResponse` is neither, so the rule never fires — documentation lands cleanly
   **even at strictness `high`** (the default — `validation-settings.ts`).

The canonical FHIR store (`createFhirStore`) is resource-type-generic and persists any
structurally valid resource, so both the `QuestionnaireResponse` and the `Questionnaire` are
stored without change.

## What CE must add: projection to a read model

The gap is the read model. `projectResource` (`packages/db/src/relational/index.ts`) returns
`null` for `QuestionnaireResponse` (hits `default`), so documentation would sit only in the
canonical `fhir` store — retrievable by id, but invisible to relational read/report surfaces.
We add a projector so documentation data is queryable alongside lab data.

### New external read table: `questionnaire_responses`

One row per `QuestionnaireResponse`. Columns (mirroring the provenance discipline of the
existing projection tables — `source_system`/`batch_id` are required, never defaulted):

| column | source |
|---|---|
| `id` | `QuestionnaireResponse.id` |
| `questionnaire` | `QuestionnaireResponse.questionnaire` (canonical ref to the form) |
| `form_code` | derived from the questionnaire canonical / `Questionnaire.name` (e.g. `hiv_vl_documentation`) |
| `subject_id` | `subject.reference` → Patient id |
| `authored` | `QuestionnaireResponse.authored` |
| `based_on_id` | `basedOn[].reference` → ServiceRequest id (null for documentation-only) |
| `items` | `jsonb` — the `item[]` array (linkId, text, answer) verbatim, for query/report |
| `source_system` | provenance |
| `batch_id` | provenance |

v1 keeps the answers as a `jsonb` `items` column rather than a child `questionnaire_response_items`
table — sufficient to query/report documentation, and a per-answer table can be added later
(YAGNI). `Questionnaire` itself is **not** projected in v1; the form definition lives in the
canonical store only (its `form_code`/canonical is denormalized onto the response rows for
querying).

### Wiring

- Migration: create `questionnaire_responses` in the external schema (all three engines follow
  the existing projection-table migration pattern; the projector targets pg first, MSSQL/MySQL
  parity handled by the shared `batch-upsert` layer as with other tables).
- `packages/db/src/relational/questionnaire-response.ts`: `projectQuestionnaireResponse(r, prov)`.
- Register it in `projectResource` and `tableForResourceType` (`relational/index.ts`).
- Type the new table in `ExternalSchema`.

## Data flow (CE side)

```
bare FHIR array (existing webhook)
  → split-out → persist-store
    → validateBatch  [QuestionnaireResponse: structural OK; lab-result rule N/A]
      → fhirStore.save (canonical)               [Questionnaire + QuestionnaireResponse]
        → projection worker
           ServiceRequest/Observation/… → existing read tables
           QuestionnaireResponse         → questionnaire_responses (NEW)
           Questionnaire                 → canonical store only (not projected)
```

## Error handling

- A malformed `QuestionnaireResponse` (missing `status`, etc.) fails **structural** validation
  and is reported in the batch `OperationOutcome` exactly like any other malformed resource —
  the producer is responsible for emitting valid FHIR.
- `based_on_id` is nullable: documentation-only specimens have no test leg, and that is valid
  (a QR is not required to reference a ServiceRequest).
- Projection is best-effort/idempotent like the existing projectors; an unmapped resource type
  still returns `null` (skipped), so adding this projector cannot regress other types.

## Testing

- **Validation contract:** a `QuestionnaireResponse` posted through the persist path validates
  and persists at strictness `high` (regression guard that documentation never trips the
  lab-result rule).
- **Projection:** `projectQuestionnaireResponse` maps a representative QR (with `basedOn`,
  `authored`, dynamic `item[]`) to the expected `questionnaire_responses` row; documentation-only
  QR projects with `based_on_id = null`.
- **End-to-end (the real acceptance):** `OPENLDR_COUNTRY=tanzania openldr export-batch <lab with
  VLID> --ce-url … --ce-tz +02:00` against a local CE → the documentation QR appears in the
  canonical store and in `questionnaire_responses`, while the test observations still land in
  `lab_results`.

## Out of scope (v1)

- Projecting the `Questionnaire` resource to a read table (form definitions stay in the canonical
  store).
- A per-answer `questionnaire_response_items` child table.
- Any CE UI surface for viewing documentation submissions.
- Routing documentation through CE's `Form Validate` node / CE form definitions.
