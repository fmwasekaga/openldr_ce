# Workflow Builder — Remaining Nodes: Effort-Ranked Inventory & Slice Plan

**Date:** 2026-06-30
**Status:** Design / sequencing map (not an implementation plan)
**Relates to:** [workflow-node-palette], [workflow-builder-workstream], [workflow-plugin-nodes-workstream], [workflow-ingestion-loop-workstream]

## Purpose

The builder palette was curated to six categories (Core · Communication · Developer
Tools · Databases · Files & Storage · Data Transformation). ~19 nodes are fully
implemented; **40 remain as "Coming soon" placeholders** — rendered disabled because
their id is absent from `IMPLEMENTED_TEMPLATE_IDS` (`apps/web/src/workflows/constants.ts`)
and they have no handler.

This document inventories every remaining node, ranks it by level of effort, and
sequences the work into slices so we can do small wins first without losing sight of
the crucial-but-heavy ones. We are building a miniature, health-focused n8n — so we
mirror n8n's node behaviours, scoped down.

## What drives effort (the cost model)

A node's effort is determined almost entirely by **what its handler must touch**:

| Class | Touches | Pattern that already exists | Effort |
|---|---|---|---|
| **Pure in-memory transform** | only `WorkflowItem[]` | `set.ts` / `merge.ts` / `filter.ts` (~25 lines each) | **S** |
| **Format / codec** | CPU + a parsing lib; no I/O, no egress | `code.ts` sandbox; some logic exists in plugin converter crates | **M** |
| **Binary / file** | a binary payload | files channel + `BinaryRef` + `materializeEmittedBinary` + 50 MB cap (SP-4a/4b) | **M** |
| **External connector** | network egress + stored credentials | DHIS2 Connector (AES-256-GCM secrets, DB-stored) — needs *generalizing* | **L** |
| **Trigger w/ listener** | connector **+** trigger-runner integration | `syncWorkflowTriggers`, pg LISTEN/NOTIFY, trigger-runner | **L** |
| **Engine control-flow** | the executor itself (branching/iteration/recursion) | `if` multi-output; no iteration/sub-workflow primitive yet | **L + own spec** |

The mechanical cost of *adding* any node is constant and cheap: (1) descriptor in
`HOST_NODE_DESCRIPTORS`; (2) handler + register in `ACTION_HANDLERS`; (3) add id to
`IMPLEMENTED_TEMPLATE_IDS`; (4) declarative `config[]` auto-renders via
`DeclarativeNodeForm`. The *real* cost is the runtime capability behind it — which is
what the table above captures.

## Full inventory (40 nodes)

Effort: **XS** trivial (palette + tiny handler) · **S** small · **M** medium · **L** large.

### Tier 1 — Pure in-memory transforms (small wins)

No DB, no network, no credentials, no `ctx.services`. Same shape as `set`/`merge`.

| id | label | kind | effort | notes |
|---|---|---|---|---|
| `no-op` | No Operation | action | **XS** | Handler already exists (`defaultHandler`); just add to `IMPLEMENTED_TEMPLATE_IDS`. |
| `stop-error` | Stop and Error | action | **XS** | Throw configured message; engine already records node errors. |
| `sort` | Sort | action | **XS** | Order items by field(s) + direction. |
| `limit` | Limit | action | **XS** | Keep first N items. |
| `remove-duplicates` | Remove Duplicates | action | **S** | Dedupe by selected field(s) or whole-item hash. |
| `rename-keys` | Rename Keys | action | **S** | Map old→new object keys. |
| `split-out` | Split Out | action | **S** | Explode an array field into one item each. |
| `aggregate` | Aggregate | action | **S** | Collect many items → one (inverse of split-out); optional group-by. |
| `summarize` | Summarize | action | **M** | sum/avg/min/max/count grouped by field (pivot-lite). |
| `edit-fields` | Edit Fields (Set) | action | **XS** | Duplicate of the working `set` node. Decision: alias `action:'set'` or drop from palette. |
| `item-lists` | Item Lists | action | **M** | Legacy n8n umbrella (split/aggregate/sort helpers). Likely **drop** — superseded by the discrete nodes above. |
| `compare-datasets` | Compare Datasets | action | **M** | Diff two input branches by key → added/removed/changed. Needs 2 named inputs. |
| `date-time` | Date & Time | action | **S** | Format/parse/offset. Use a small date lib or `Intl`; no new infra. |
| `switch` | Switch | condition | **M** | Multi-branch routing; needs N named outputs (generalizes `if`'s true/false). |
| `wait` | Wait | action | **S→L** | Fixed short delay = **S**. Durable "wait until / resume" (survives restart) = **L**, own design. Ship S first. |

### Tier 2 — Format / codec (CPU-only, library-backed)

Sandbox-safe, no egress. Some overlap with existing plugin converter crates.

| id | label | effort | notes |
|---|---|---|---|
| `crypto` | Crypto | **S** | hash/HMAC/encrypt via Node `crypto` builtin. |
| `jwt` | JWT | **S** | sign/verify (jose). |
| `markdown` | Markdown | **S** | md↔html (marked / turndown). |
| `xml` | XML | **S** | parse/build (fast-xml-parser). |
| `html-extract` | HTML Extract | **M** | CSS-selector scrape (cheerio). |
| `html` | HTML | **M** | build/template + extract HTML. Pairs with `html-extract`. |

### Tier 3 — Binary / file (reuse the SP-4 files channel)

These ride the existing binary infra (`files` channel, `BinaryRef`, 50 MB cap,
`materializeEmittedBinary`). Medium, not large, because that plumbing is done.

| id | label | effort | notes |
|---|---|---|---|
| `convert-to-file` | Convert to File | **M** | items → CSV/XLSX/JSON `BinaryRef`. Overlaps `export-artifact` + plugin binary OUTPUT. |
| `extract-from-file` | Extract from File | **M** | uploaded file → items. Overlaps plugin binary INPUT (`abi:'bytes'` / `wf_convert`). |
| `spreadsheet-file` | Spreadsheet File | **M** | read/write CSV/XLSX (xlsx lib already used by export). |
| `read-pdf` | Read PDF | **M** | extract text (pdf-parse). |
| `compression` | Compression | **M** | zip/unzip (zlib / adm-zip). |
| `read-write-file` | Read/Write File | **L** | Arbitrary host-FS access — **security-gated**. Must restrict to an allow-listed dir (e.g. workflow-artifacts), never raw paths. Treat as its own mini-design. |

### Tier 4 — External connectors (need the Connector credential model)

All require generalizing the DHIS2 Connector (AES-256-GCM, DB-stored secrets) into a
reusable model + a driver per system. The **first** one carries the model cost; the
rest are incremental.

| id | label | effort | notes |
|---|---|---|---|
| `send-email` | Send Email (SMTP) | **M** | nodemailer; first Communication connector establishes SMTP creds pattern. |
| `microsoft-sql` | Microsoft SQL | **M** | **Lowest-effort DB** — MSSQL toolchain already in repo (Kysely MssqlDialect + tedious + tarn). |
| `postgres` | Postgres | **M→L** | pg via Kysely already present; first DB connector carries the generic-connector cost. Natural **reference connector**. |
| `mysql` | MySQL | **L** | mysql2 driver (new dep). |
| `mongodb` | MongoDB | **L** | mongo driver + document model (new dep, different shape). |
| `redis` | Redis | **L** | ioredis; kv/pub-sub/streams (new dep). |
| `ftp` | FTP / SFTP | **L** | ssh2-sftp-client; connector + binary channel. |
| `gmail` | Gmail | **L** | OAuth2 + Gmail API (OAuth flow is the cost, not the API). |
| `outlook` | Microsoft Outlook | **L** | OAuth2 + Graph API. |

### Tier 5 — Triggers with listeners (connector + trigger-runner)

| id | label | effort | notes |
|---|---|---|---|
| `postgres-trigger` | Postgres Trigger | **L** | LISTEN/NOTIFY on external PG → trigger-runner + `syncWorkflowTriggers`. Build with/after `postgres`. |
| `email-trigger` | Email Trigger (IMAP) | **L** | IMAP polling → trigger-runner. Build with/after `send-email`. |

### Tier 6 — Engine control-flow (architecturally distinct — own specs)

| id | label | effort | notes |
|---|---|---|---|
| `loop` | Loop Over Items | **L** | Sub-graph iteration / batching — changes the executor's model. Own design. |
| `execute-workflow` | Execute Workflow | **L** | Invoke another workflow + run-context recursion + loop-safety guard. Already **deferred to its own spec** in the ingestion-loop workstream. |

## Recommended slice sequence

1. **Slice A — Tier-1 transforms (small wins).** Batch the XS/S transforms in one
   TDD slice: `no-op`, `stop-error`, `sort`, `limit`, `remove-duplicates`,
   `rename-keys`, `split-out`, `aggregate`, plus resolve `edit-fields`/`item-lists`
   (alias/drop). High visible progress, zero new infra. *(Split into A1 trivial / A2
   `summarize`+`switch`+`compare-datasets`+`date-time` if the slice gets large.)*
2. **Slice B — Tier-2 format/codec.** `crypto`, `jwt`, `markdown`, `xml`,
   `html-extract`, `html`. CPU-only, one lib each.
3. **Slice C — Tier-3 binary/file.** `convert-to-file`, `extract-from-file`,
   `spreadsheet-file`, `read-pdf`, `compression` on the existing files channel.
   Defer `read-write-file` to its own security-gated mini-design.
4. **Slice D — Connector foundation + reference DB.** Generalize the DHIS2 Connector
   into a reusable credential model; implement **Postgres** (or **MSSQL**, given the
   existing toolchain) as the reference. This unblocks all of Tier 4/5.
5. **Slice E — Remaining DB connectors.** `microsoft-sql`/`postgres` (whichever not
   done in D), `mysql`, `mongodb`, `redis`.
6. **Slice F — Communication.** `send-email` first (SMTP creds), then `gmail` /
   `outlook` (OAuth), `ftp`.
7. **Slice G — Listener triggers.** `postgres-trigger`, `email-trigger` (fold into
   D/F where the connector already exists).
8. **Slice H — Engine control-flow.** `switch` lands in Slice A; `loop` and
   `execute-workflow` each get their own spec.

## Open decisions (resolve before the slice they affect)

1. **`edit-fields` & `item-lists`** — ✅ **RESOLVED 2026-06-30: drop both** from the
   palette. `set` already covers edit-fields; the discrete sort/split-out/aggregate
   nodes cover item-lists. (Affects Slice A.)
2. **Connector model shape** — one generic `Connector` table with a `type`
   discriminator + per-type secret schema, vs. per-connector tables. (Affects Slice D.)
3. **`wait` scope** — ship fixed-delay only now, durable wait later? *Recommendation: yes.*
4. **`read-write-file` policy** — allow-listed artifact dir only; confirm no raw-path
   escape hatch. (Affects Slice C/its own design.)

## Non-goals

- No new palette categories; we only fill in existing placeholders.
- No plugin-node (wasm) work here — that path is for sandboxed format/egress logic and
  is already covered by its own workstream.
