# CDR Source Plugin — Scoping

**Status:** scoped, not started. A companion to the sync live-test plan (`docs/sync-live-test-phase1-lan.md`): its purpose is to let real deployments (Mozambique, Zambia) test OpenLDR against **real lab data** instead of synthetic seeds — "rather than guessing how the data will look, we'll know."

## What it is

A **third-party OpenLDR CE plugin** (distributed via the marketplace — **not** shipped in CE core, for licensing/naming reasons) that ingests a DISA*Lab source database and lands it in OpenLDR CE's canonical FHIR store:

```
SOURCE (MSSQL / DISA*Lab)  →  VALIDATE (workflow nodes)  →  PERSIST (CE FHIR store)
```

## Constraints (fixed)

- **Third-party plugin, not CE core.** Ships and installs through the CE marketplace (signed, capability-scoped); lives in its own repository.
- **Source is MSSQL** — DISA*Lab runs on SQL Server.
- **Reuse CE's existing MSSQL and connector machinery** rather than reinventing it.
- **Name is not "disalab"** — a neutral name (e.g. `cdr-bridge` / `cdr-source`, TBD).

## Prior art — `cdr-toolchain`

An existing monorepo (`CLI + API` over a shared `packages/disalab` library) that already migrates DISA → OpenLDR **v2**. Its command surface is the shape of the work: read the source (`tables`, `show`, `ping`), run checks (`audit-batch`, `audit-report`, `compare-batch`), push (`export-batch`). Because the validation logic already lives in a shared library, the plugin is a **third adapter over an existing core**, not a rewrite.

## Why it "doesn't diverge much" — CE already has the parts

| Need | Reuse in CE |
|---|---|
| MSSQL connectivity | `packages/adapter-mssql-store` (SQL Server 2017/2019/2022 validated) |
| A DB source connector | the `connector-sql-service` / `connector-db` family (siblings: mongo, redis, sftp, email, target) |
| A plugin contributing a connector **and** nodes | the plugin manifest already contributes `connectors` + `workflowNodes` + `capabilities` |
| A working connector-plugin precedent | the DHIS2 **sink** plugin — this is the same machinery pointed *inward* (source instead of sink) |
| Persistence | CE's FHIR store / ingest path (no new endpoint) |

## Key architectural note

Because the plugin **persists natively through CE's FHIR store**, it does **not** need to match any HTTP webhook or the v2 ingestion format. OpenLDR v2's `hl7-fhir.schema` plugin is therefore a **mapping reference** — how DISA rows become FHIR resources — not an integration target to conform to.

## Two paths to decide up front

- **(A) Get real data into the live test cheaply** — reuse `cdr-toolchain`'s existing `export-batch` against a test central to bootstrap real data without building the full plugin.
- **(B) Build the third-party CE plugin** — the actual product. The "not in core" constraint points at (B) as the deliverable, but (A) may seed real test data sooner.

These are different scopes. The live test does not need (B) to begin: synthetic data proves the **transport**; real DISA data proves the **data mapping**. Keep the two apart.

## Recommended first step (before any design)

A grounding read of three things — because the decomposition and the (A)-vs-(B) call depend entirely on what's actually in the code:

1. **`cdr-toolchain`** — the `disalab` core + `export-batch`: what it checks, what it produces, how it maps DISA → FHIR.
2. **OpenLDR v2** — `hl7-fhir.schema` + its examples: the FHIR mapping reference.
3. **OpenLDR CE** — `adapter-mssql-store`, `connector-sql-service` / `connector-db`, the plugin registry, and the FHIR persist path: the reuse surface.

## Open questions for the design phase

- **Source vs target direction.** CE's MSSQL support today is a *write-out target* (analytics). Here MSSQL is a *read-in source*. Same driver, opposite direction — confirm the SQL connector reads a source, not only writes a target.
- **PHI / governance.** Real Mozambique/Zambia backups are real patient data; prefer backups over live databases, and note that wherever the data lands inherits the handling obligations.
- **Decomposition.** Is this one plugin contributing (source connector + validation nodes), or a connector plus a separate node pack? The grounding read decides.
