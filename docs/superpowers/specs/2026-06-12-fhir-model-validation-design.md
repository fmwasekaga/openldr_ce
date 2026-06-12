# Sub-project 2a — FHIR R4 Model + Validation

**Date:** 2026-06-12
**Status:** Approved design (ready for implementation planning)
**PRD:** `openldr-ce-prd-phase1.md` — P1-FHIR-1 (model + validation slice), P1-FHIR-2 (canonical resource set), and the `fhir validate` slice of P1-CLI-1/2
**Build-sequence step:** §8 step 2, first half (the data layer is split 2a model+validation / 2b storage+flattening+migrations)

---

## 1. Purpose & scope

Deliver `@openldr/fhir` as a pure, programmatic **FHIR R4 model + validation library**, plus a CLI surface to validate resources. This is the canonical-data foundation the ingest pipeline (§8 step 4) and the flattening layer (2b) build on.

CE is **FHIR-canonical**: ingested data becomes FHIR R4 (the canonical internal representation, DP-6 / P1-FHIR-2), is stored internally as FHIR, and is later flattened outward to relational analytics tables (P1-FHIR-3, sub-project 2b). This inverts Corlix (relational-first, FHIR projected on read). We reuse Corlix's *techniques* — hand-rolled resource modeling, the resource registry pattern, `OperationOutcome` — but write original CE implementations (§10: reimplement, never copy). Corlix uses no FHIR library and no `@types/fhir`; neither do we.

**In scope (2a):**
- zod schemas for the FHIR R4 datatype subset and resource subset CE uses, with TS types via `z.infer`.
- A validation function returning a spec-valid FHIR `OperationOutcome`.
- A resource registry mapping `resourceType → schema` for validation dispatch.
- `openldr fhir validate <file> [--json]`.

**Deferred to 2b:** internal canonical storage, flattening projection to the external DB, migrations.

**Deferred further (later sub-projects / out of scope):** HTTP/REST FHIR endpoints, dynamic CapabilityStatement, terminology (CodeSystem/ValueSet) management, FHIR transaction Bundle processing, Subscriptions/webhooks.

---

## 2. Cross-cutting principles this sub-project demonstrates

- **DP-6 FHIR R4 native** — the canonical internal model is FHIR R4; this package defines it.
- **DP-4 Agent-operability** — `openldr fhir validate --json` is an agent-inspectable surface.
- **DP-5 Lean by default** — hand-written zod for our subset; no multi-megabyte schema, no FHIR server library.

---

## 3. Module structure

Build into the existing `@openldr/fhir` package (replace its placeholder `src/index.ts`). Each file has one focused responsibility.

```
packages/fhir/src/
├─ datatypes/
│  ├─ primitives.ts   # FHIR primitive zod refinements: id, uri, code, dateTime, instant, date, decimal, base64Binary
│  ├─ complex.ts      # Identifier, Coding, CodeableConcept, Reference, HumanName, ContactPoint, Address, Period, Quantity, Meta, Annotation
│  └─ index.ts
├─ resources/
│  ├─ patient.ts
│  ├─ specimen.ts
│  ├─ service-request.ts
│  ├─ diagnostic-report.ts
│  ├─ observation.ts
│  ├─ organization.ts
│  ├─ location.ts
│  ├─ bundle.ts
│  └─ index.ts
├─ operation-outcome.ts  # OperationOutcome type + builders (from zod issues, and ad-hoc)
├─ registry.ts           # resourceType → zod schema map; register/get/list
├─ validate.ts           # validateResource(data) and validateBundleEntries
└─ index.ts              # public surface
```

**Dependencies:** `zod` only. `@openldr/fhir` is a domain module; `.dependency-cruiser.cjs` already forbids it from importing `adapter-*` or `apps/*`. It does **not** depend on `@openldr/core` (self-contained); the CLI wires it in.

---

## 4. Modeling approach (the core technique)

Each datatype and resource is a zod schema; its TS type is `z.infer<typeof Schema>`. Element definitions (presence, cardinality, value-set bindings) are transcribed from the official FHIR R4 spec (hl7.org/fhir/R4) — there is **no committed JSON schema file**.

Two deliberate fidelity choices:

1. **`.passthrough()` on every resource schema.** FHIR is extensible (`extension`, `modifierExtension`, and forward-compatible elements). We validate *known* elements but **preserve unknown ones** so canonical resources round-trip intact rather than being stripped (zod's default) or rejected (`.strict()`). Datatype sub-schemas also passthrough.

2. **Encode what actually matters**, not every element:
   - **Real R4 min-cardinality** for required elements, e.g.: `Observation.status` + `Observation.code` required; `ServiceRequest.status` + `intent` + `subject` required; `DiagnosticReport.status` + `code` required; `Specimen` has none beyond `resourceType`; `Patient`/`Organization`/`Location` have none required.
   - **Bound code sets** as zod enums where the binding is required/important, e.g.: `Patient.gender ∈ {male,female,other,unknown}` (administrative-gender); `Observation.status ∈ {registered,preliminary,final,amended,corrected,cancelled,entered-in-error,unknown}`; `ServiceRequest.status` and `intent` enums; `Specimen.status ∈ {available,unavailable,unsatisfactory,entered-in-error}`; `Location.status ∈ {active,suspended,inactive}`.
   - Everything else (optional complex elements) is typed but lenient.

Every resource schema pins `resourceType: z.literal('<Type>')`.

---

## 5. Validation → OperationOutcome, via a registry

`registry.ts` holds a `Map<string, ZodType>` of `resourceType → schema`, with `registerResource(type, schema)`, `getResourceSchema(type)`, and `listResourceTypes()`. Each resource module registers itself; `index.ts` imports them so the registry is populated.

`validate.ts` exposes:

```ts
type ValidationResult =
  | { ok: true; resource: FhirResource }
  | { ok: false; outcome: OperationOutcome };

function validateResource(data: unknown): ValidationResult;
function validateBundleEntries(bundle: unknown): { entry: number; result: ValidationResult }[];
```

`validateResource`:
- non-object / missing `resourceType` → `{ ok:false, outcome }` with issue `code:'structure'`.
- unknown `resourceType` (not in registry) → issue `code:'not-supported'`.
- known type, zod failure → each `zod` issue becomes one `OperationOutcome.issue`: `severity:'error'`, `code:'invalid'` (or `'structure'` for type/shape errors), `expression:[<dot-path>]`, `diagnostics:<zod message>`.
- success → `{ ok:true, resource }`.

`operation-outcome.ts` builds spec-valid `OperationOutcome` resources (reimplements Corlix's `outcome.ts` shape): `{ resourceType:'OperationOutcome', issue:[...] }`, with helpers `outcomeFromIssues(issues)` and `singleIssueOutcome(severity, code, diagnostics, expression?)`. An all-valid result is represented by `{ ok:true }`, never an empty outcome.

---

## 6. Resource coverage & the isolate shape

Nine schemas: the seven P1-FHIR-2 resources — **Patient, Specimen, ServiceRequest, DiagnosticReport, Observation, Organization, Location** — plus **Bundle** (so the CLI can validate export/collection bundles) and **OperationOutcome** (output type; not required as validation *input*, but defined for type-completeness).

Per the approved isolate decision (**derived Specimen + Observations**):
- `Specimen` includes `parent: Reference[]` (an isolate is a Specimen whose `parent` is the patient specimen) and `subject`, `type`, `collection`, `status`.
- `Observation` includes `specimen: Reference`, `code`, `value[x]` (at least `valueCodeableConcept`, `valueQuantity`, `valueString`), `interpretation`, `method`, and `component[]` — enough to express organism identification and antibiotic-susceptibility (AST) results referencing the isolate Specimen.

No custom profiles in 2a.

---

## 7. CLI — `openldr fhir validate <file> [--json]`

Extends sub-project 1's CLI (`packages/cli`) with a `fhir` command group and a `validate` subcommand. The `cli` package gains a dependency on `@openldr/fhir` (allowed: `cli` may import a domain module).

Behaviour:
- Reads the file at `<file>`, `JSON.parse`s it.
- If `resourceType === 'Bundle'`, validates each `entry.resource` via `validateBundleEntries`; otherwise validates the single resource.
- Human output: a per-resource `valid`/`invalid` summary; for invalid, the issues (`expression: diagnostics`).
- `--json`: emits the raw `OperationOutcome`(s) as JSON.
- Exit code `0` if every validated resource is valid, `1` otherwise. Parse errors (bad JSON, missing file) → exit `1` with a clear message (and a JSON error object under `--json`).

This does **not** require `createAppContext` / adapters — validation is pure, so the command needs no config or running infra.

---

## 8. Testing & acceptance

**Unit — datatypes**
- `Identifier`, `Coding`, `CodeableConcept`, `Reference`, `HumanName` (and the others): a valid sample parses; a wrong-typed field fails; primitives reject malformed values (e.g. a non-date `birthDate`).

**Unit — resources** (each of the nine)
- A representative valid sample parses and infers the right TS type.
- A missing required element fails with the correct `expression` (e.g. an `Observation` without `status`).
- A bad bound code fails (e.g. `Patient.gender:'X'`, `Observation.status:'done'`).
- An `extension` on the resource passes through untouched (round-trips after parse).

**Unit — validation dispatch**
- valid resource → `{ ok:true }`; unknown `resourceType` → `not-supported` outcome; missing `resourceType` → `structure` outcome.
- `validateBundleEntries` returns one result per entry; a Bundle with one bad entry flags exactly that index.
- `OperationOutcome` builders produce spec-shaped output.

**Integration — CLI (acceptance)**
- A fixture file with a valid `Patient` → `openldr fhir validate patient.json` exits `0`.
- A fixture with an invalid `Observation` (missing `status`) → exits `1` and the output names `status`.
- `--json` emits a parseable `OperationOutcome`.
- A `Bundle` fixture with one bad entry → exits `1`, pinpoints the entry.

**Gate**
- `pnpm --filter @openldr/fhir test` + `typecheck` green; `pnpm --filter @openldr/cli test` + `build` green; `pnpm depcruise` clean (fhir imports no adapter/app).

---

## 9. Acceptance criteria checklist

- [ ] `@openldr/fhir` exports zod schemas + inferred types for the nine resources and the datatype subset (P1-FHIR-1 model).
- [ ] Resources `.passthrough()` (extensions preserved); required cardinality + bound code sets enforced.
- [ ] Canonical CE resource set present (Patient, Specimen w/ `parent`, ServiceRequest, DiagnosticReport, Observation w/ AST shape, Organization, Location) (P1-FHIR-2).
- [ ] `validateResource` returns typed resource or a spec-valid `OperationOutcome`; registry dispatch by `resourceType`; unknown type → `not-supported`.
- [ ] `openldr fhir validate <file> [--json]` validates single resources and Bundles, correct exit codes (P1-CLI-1/2, DP-4).
- [ ] Full gate green; dependency-cruiser clean.

---

## 10. Open items carried forward (not blocking 2a)

- 2b: internal canonical FHIR storage (jsonb in internal Postgres), flattening projection to the external DB, kysely migrations (internal + external), and the `db migrate` CLI.
- Terminology binding beyond the few hard-coded enums (LOINC/SNOMED ValueSets) — later terminology sub-project.
- REST FHIR endpoints + CapabilityStatement — later (forms/ingest/UI).
- License headers pending company/legal sign-off (§9).
