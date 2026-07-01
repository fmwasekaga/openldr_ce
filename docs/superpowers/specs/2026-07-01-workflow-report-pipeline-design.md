# Workflow-Driven Report Pipeline — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorm) — ready for implementation plan
**Owner workstream:** Workflow node palette / reporting

## Problem

The Zambia team (APHL / OpenLDR) runs ~25 scheduled reports as a single Node.js
process under **pm2** (`temp/app.js`). Each report is one `getSomething(...)`
call with the same shape:

1. A `node-schedule` cron fires.
2. It runs an MSSQL stored procedure (e.g. `Exec OpenLDRReporting.dbo.sp_Ndola_ast_data_month`).
3. It opens a **branded Excel template** from `Templates/`, maps each result row
   into a hardcoded cell range (`A2:BV…`), applies an autofilter, and — for
   sensitive reports (AMR, recency, VL line-lists) — **password-protects** the file.
4. It emails the file as an attachment via SMTP (smtp2go / nodemailer) to
   hardcoded recipient + cc lists.

Behind that, the heavy stored procs (the AMR one is a CTE + a 70-antibiotic
`PIVOT` across `requests`/`labresults`/`patients`/`ASTResults`) are pre-materialized
into an `OpenLDRReporting` database so the report query hits a denormalized table
instead of the live LIMS tables.

So it is really **two pipelines**: *(A) materialize an optimized table* on a
schedule, and *(B) query it → fill a template → email* on a schedule.

**Goal:** reproduce this entirely inside the OpenLDR CE **Workflow Builder**, so
users never have to write and deploy separate Node.js apps to push data. The
report logic must be **portable** across databases (Postgres, MSSQL, or whatever
external DB the connector points at), not locked into MSSQL stored procedures.

## Non-Goals (MVP)

- Re-implementing all ~25 reports. Only **AMR Ndola** is built end-to-end as the
  reference; the rest are mechanical replication in a fast-follow.
- Province fan-out for the ~13 VL line-lists (fast-follow; see below).
- A recipient-list management UI (MVP keeps lists in the `send-email` node config).
- The 5-minute pre-send delay (`setTimeout(…, 300000)` in `app.js`).

## What already exists (reused, not rebuilt)

| Capability | Existing mechanism |
|---|---|
| Cron scheduling | `trigger` node |
| Portable DB extract (PG / MSSQL / MySQL) | `postgres` / `microsoft-sql` / `mysql` → `connectorSqlHandler`; the connector's type drives the dialect server-side, and the SQL string is run through `resolveTemplate` (so computed values can be injected) |
| Optimized/materialized table | `materialize-dataset` → `load-dataset` (a named dataset persisted in the CE store, independent of the source DB) |
| Email with attachment (SMTP) | `send-email` node (`emailHandler`) — picks up attachments from an item's `binary` field |
| Binary artifact storage | `ctx.services.writeBinary` / `readBinary` (returns/consumes a `BinaryRef`) |
| Sub-workflow invocation (for fan-out) | `execute-workflow` node |
| Date math, field shaping | `set`, `rename-keys`, `sort`, `filter` nodes |

## Approach (selected)

**Approach A — Two workflows joined by a named dataset, all reshaping done in
declarative nodes.** Rejected alternatives: one-workflow-per-report with SQL in
the node (not portable, no optimized-table speedup); a higher-level "report
definition" abstraction that compiles to workflows (larger build, premature).

### Architecture

**Workflow A — Materialize** (heavy, scheduled infrequently):
```
cron trigger
  → set: compute { periodStart, periodEnd } (last calendar month) in JS
  → DB "isolates": portable parameterized SELECT (culture/organism rows)
  → DB "ast_long": portable parameterized SELECT (AST results, long form)
      → pivot: long → wide antibiotic columns
  → merge(combineByKey): join isolates ↔ pivoted AST on [requestid, organism]
  → materialize-dataset "amr_ndola_monthly"
```

**Workflow B — Report & email** (delivery, scheduled per report):
```
cron trigger
  → load-dataset "amr_ndola_monthly"
  → excel-template: fill branded template + autofilter + password
  → send-email: recipients + cc, attachment
```

Key properties:

- **The named dataset is the contract** between A and B. They schedule
  independently — exactly the Zambia "populate table faster, then report off it"
  split. Multiple report workflows can read the same dataset.
- **Portability lives in the split.** The external DB only ever runs a plain
  parameterized `SELECT` (ANSI, runs on PG or MSSQL). Every MSSQL-ism moves out
  of SQL:
  - `PIVOT` → the new `pivot` node.
  - `datepart`/`getdate` "last month" → a `set` node computing date bounds in JS,
    injected into the SQL via `resolveTemplate`.
  - specimen-code `CASE` map (`CULPU`→`Pus`, …) → **stays in the `SELECT`**; plain
    ANSI `CASE` is portable, so no reshape node is needed for it.
  - keyed join (`a left join b`) → the new `combineByKey` merge mode.
- **No host-level code execution.** All reshaping is declarative. `code` nodes
  (gated behind `WORKFLOW_CODE_ENABLED`, host-privileged) are deliberately not used.

## New components

### 1. `excel-template` node (action subtype)

Backed by **`xlsx-populate`** (the same library `app.js` uses — proven for
template fill + autofilter + password encryption, which the codebase's current
SheetJS community `xlsx` cannot do on write).

Takes the input items as data rows, fills a branded template, and outputs a
binary the `send-email` node attaches.

**Config:**

| Field | Meaning | `app.js` origin |
|---|---|---|
| `templateRef` | Uploaded branded `.xlsx`, stored via `writeBinary`, referenced by objectKey | `Templates/AMR_temp.xlsx` |
| `sheetIndex` | Target sheet (default `0`) | `workbook.sheet(0)` |
| `startCell` | Top-left of the data write range, e.g. `A2` | `range("A2:BV…")` |
| `columns` | **Ordered** list mapping each item field → column | the `bb.map(x=>[…])` array |
| `autoFilter` | bool + header cell/range (e.g. `A1`) | `q.autoFilter()` |
| `password` | optional; **resolved from the secret/connector store by key**, never plaintext | `{password:"0Micro!"}` |
| `fileName` | output attachment name, supports date templating | `NTH_AMR_LastMonth_20260701.xlsx` |

**Behavior:** `readBinary(templateRef)` → write `input` rows into the range
starting at `startCell` in declared `columns` order → apply autofilter if set →
save (encrypt when a password is resolved) → `writeBinary` the result → attach the
`BinaryRef` to the output item's `binary` field.

**Deliberate upgrades over `app.js`:** password comes from the encrypted secret
store (not plaintext in source); the column mapping is node config (not a
hardcoded `switch`), so a new report is a config change, never a code edit.

**Template upload:** through the builder — the user uploads the `.xlsx` once, it
is stored as an artifact, and the node references it by objectKey (template is
versioned with the workflow).

### 2. `pivot` node (action subtype)

Declarative long → wide reshape.

**Config:**

| Field | Meaning |
|---|---|
| `groupBy` | Key fields identifying an output row, e.g. `["requestid","organism"]` |
| `pivotColumn` | Field whose distinct values become columns, e.g. `LIMSSubstanceName` |
| `valueColumn` | Field supplying cell values, e.g. `ASTValue` |
| `columns` | Fixed allow-list of output columns (the 70 antibiotics) — guarantees stable template alignment even when a value is absent |
| `aggregate` | Collision handling (`MAX` mirrors the SP's `MAX(ASTValue)`); default configurable |
| `carry` | Other fields to pass through from within a group |

**Output:** one item per group — `groupBy` fields + `carry` fields + one field
per entry in `columns`.

### 3. `combineByKey` merge mode

Extend the existing `merge` node (which currently only supports `append` /
`combine` / `chooseBranch`) with a keyed-join mode.

**Config:** `mode: "combineByKey"`, `joinKeys: string[]` (e.g. `["requestid",
"organism"]`), `joinType: "left" | "inner"`, and a way to designate which incoming
branch is the left side.

**Note on key alignment:** the SP joins `a.RequestID = b.LabID` and
`a.LIMSRptResult = b.ORGANISM`. To keep the join config simple, the two extract
`SELECT`s alias their key fields to the **same names** (`requestid`, `organism`)
on both sides, so the join is a plain `joinKeys: ["requestid","organism"]`.

## Reference report: AMR Ndola (`sp_Ndola_ast_data_month`)

This proc is the hardest of the 25 (CTE + 70-column PIVOT + keyed join + specimen
map + password + widest template), so proving it validates every new capability;
all other reports are strictly easier.

**Workflow A — Materialize (`amr_ndola_monthly`):**
- `set`: `periodStart`/`periodEnd` = last calendar month.
- DB `isolates`: `SELECT requestid, LIMSRptResult AS organism, patient/specimen/
  location columns, CASE limspanelcode→specimen description … WHERE microbiology
  panels (Cult/Microbiology/FLUID) AND organism code like 'ORGS%' AND registered
  BETWEEN :periodStart AND :periodEnd AND facility='ZNP' AND authorised is not null`.
- DB `ast_long`: `SELECT requestid, organism, LIMSSubstanceName, ASTValue … WHERE
  SENS panel AND same date range AND facility='ZNP' AND authorised is not null`.
- `pivot` on `ast_long`: `groupBy=[requestid, organism]`,
  `pivotColumn=LIMSSubstanceName`, `valueColumn=ASTValue`, `columns=[Amikacin …
  Vancomycin]` (fixed 70), `aggregate=MAX`.
- `merge(combineByKey)`: left=`isolates`, right=pivoted AST,
  `joinKeys=[requestid, organism]`, left join.
- `materialize-dataset "amr_ndola_monthly"`.

**Workflow B — Report & email:**
- `load-dataset "amr_ndola_monthly"`.
- `excel-template`: `templateRef=AMR_temp.xlsx`, `startCell=A2`, `columns=[…BV
  order per app.js…]`, `autoFilter=A1`, `password=secret:amr_report_pw`,
  `fileName=NTH_AMR_LastMonth_{yyyymmdd}.xlsx`.
- `send-email`: `to`/`cc` per `app.js`, subject/body, attach produced binary.

## Testing

- **`pivot` node:** unit tests — long→wide with fixed columns, missing values,
  `MAX` collision handling, `carry` passthrough, empty input.
- **`combineByKey` merge:** unit tests — left vs inner join, multi-key match,
  unmatched rows, both-empty.
- **`excel-template` node:** unit tests — column-order mapping, autofilter applied,
  password-encrypted output opens with the password, `fileName` templating,
  missing/invalid `templateRef` error.
- **End-to-end (AMR Ndola):** run A+B against a **seeded fixture** (small realistic
  `requests`/`labresults`/`patients`/`ASTResults` rows covering the columns the two
  SELECTs read), assert the materialized dataset shape, then assert the produced
  xlsx opens, is password-protected, and has the expected filled range +
  autofilter. Follows the existing `scripts/*-demo.ts` seed pattern.

## Build sequencing (each a checkpoint)

1. **`excel-template` node**, validated first against the *simplest* template —
   **Transmission** (4 columns, no pivot, no password) — to prove template-fill +
   email plumbing quickly.
2. **`pivot` node** + **`combineByKey`** merge mode, with unit tests.
3. **Assemble AMR Ndola** Workflows A + B against the seeded fixture.
4. **Live send** (real SMTP + real template) as final acceptance.

## Fast-follow (post-MVP)

- Replicate the remaining ~24 reports (config-only once the pattern holds).
- **Province fan-out:** the ~13 VL line-lists share one template (`LPHO_TP.xlsx`)
  and one query shape (province parameter). Model as **one** parameterized report
  fanned out by province via `execute-workflow`, not 13 copies.
- Recipient-list management surface (move lists out of node config).
- Re-introduce a pre-send delay via the `wait` node only if a real need surfaces.

## Security notes

- Report passwords resolve from the encrypted secret/connector store (parity with
  DB/DHIS2 credentials) — no plaintext passwords in workflows or source.
- `code` nodes are intentionally unused; all reshaping is declarative, so no report
  requires `WORKFLOW_CODE_ENABLED` (host-level privileges).
- SQL injected date bounds are computed server-side/in a `set` node from the clock,
  not user input; the extract SQL is authored, not user-supplied at runtime.
