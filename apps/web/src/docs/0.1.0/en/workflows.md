# Workflows

Workflows let Lab Admins and Lab Managers design repeatable web-based data processes in a visual builder. Use them to pull data from a database, reshape it, publish datasets, fill spreadsheet templates, and email results — **without writing a standalone program**.

## Outcome

You can find a workflow, create one, add and connect nodes, configure them, save, run, inspect node states, and review run history — and you know what each node in the palette does.

![Workflow list with search and row actions](workflows-list.png)

## Before you begin

- You need the Lab Admin or Lab Manager role.
- Know the source, the transformation goal, and the output destination before building.
- Create or confirm any connector you plan to use from [Connectors](/docs/connectors) — database and email nodes reference a connector, so make it first.

## Core concepts

- **Nodes and edges.** A workflow is a graph. Each **node** does one step; you connect nodes by dragging from one node's handle to the next. Data flows along the edges as a list of **items** (each item is a record with a `json` object and optional attached files).
- **Triggers.** Every workflow starts with a trigger node (manual, schedule, webhook, ingest, or a listener). The trigger emits the first item.
- **The side panel.** Select a node to configure it. Required fields must be filled before the node can run.
- **Datasets.** A workflow can *materialize* its result as a named dataset that other workflows (and dashboards/reports) can read later. This is how a heavy “build the data” workflow hands off to a lighter “deliver the data” workflow.

## Steps

1. Open **Workflows** and choose the action for a new workflow (or open an existing one).
2. Name the workflow and open the builder.
3. Add a **trigger** node that matches the job: manual, schedule, webhook, or ingest.
4. Add nodes from the palette and **connect** them in execution order.
5. Select each node and complete its configuration in the side panel.
6. Select **Save**.
7. **Run** manually for an immediate test, and watch node states.

![Workflow builder with nodes, canvas, configuration, and run controls](workflow-builder.png)

8. Open **run history** to compare status, duration, and node-level results.

![Workflow run history with node results](workflow-run-history.png)

## Templating values

Most text fields (SQL, email To/Subject/Body, file names) accept **templates** that pull from the current item:

- `{{ $json.fieldName }}` — a field on the incoming item.
- Example in a SQL node: `... where registered >= '{{ $json.periodStart }}'`, where an upstream **Edit Fields** node set `periodStart`.

## Node reference

The palette is grouped by purpose. The most useful nodes for lab data work:

### Triggers

- **Manual / Schedule / Webhook / Ingest** — start a run on demand, on a cron schedule, from an HTTP call, or from an ingest event.
- **Postgres Trigger / Email Trigger** — start a run when a Postgres `NOTIFY` fires or when new email arrives (IMAP connector).

### Sources (bring data in)

- **Postgres / MySQL / Microsoft SQL** — run a SQL query against a **database connector** and emit one item per row. The connector sets the dialect. Enter the query in the built-in SQL editor (syntax highlighting), and use `{{ $json.x }}` to inject values. *Keep queries as plain, portable `SELECT`s and do the reshaping in nodes (below) so the same workflow works across databases.*
- **Load Dataset** — read a previously materialized dataset by name (the other half of a two-workflow report).
- **HTTP Request / FHIR Query** — fetch from an API or the FHIR store.

### Transforms (reshape data)

- **Edit Fields (Set)** — add or compute fields on each item (e.g. `periodStart` / `periodEnd` date bounds). Values support templates.
- **Pivot** — turn *long* rows into *wide* columns. Choose the **group‑by** keys, the **pivot column** (whose values become column names), the **value column**, and a **fixed list of output columns**. Example: antibiotic-per-row → one column per antibiotic. Collisions combine by `max`/`min`/`first`/`last`.
- **Merge** — combine multiple incoming branches. Modes: *Append* (stack), *Combine* (shallow-merge one object), *Choose Branch*, and **Combine by key (join)** — a SQL-style join of two branches on shared key fields (left/inner). The **first** branch wired into the node is the left side.
- **Filter / If / Switch** — branch by condition.
- **Aggregate / Summarize / Sort / Limit / Remove Duplicates / Rename Keys / Split Out / Date/Time** — common table operations.

### Files and output

- **Excel Template** — fill a branded `.xlsx` **template** with the incoming rows and return it as a file. **Upload the template** with the node's *Upload template* button (the artifact key fills in automatically), set the **Start cell** (e.g. `A2`), the **ordered Columns** (which item field goes in each column), an optional **Auto-filter header cell** (e.g. `A1`), and an optional **password** (resolved from a connector/secret) to protect the output. Values are written by position, exactly like a hand-built report.
- **Spreadsheet File / Convert to File / Export File** — generate plain CSV/XLSX/PDF from items (no template).
- **Materialize Dataset** — save the current items as a named dataset for later reuse.
- **Read/Write File** — sandboxed host-disk file operations (when enabled).

### Communication

- **Send Email (SMTP) / Gmail / Outlook** — send a message through an **email connector**. Set the connector, **To** (and optional **Cc**), **Subject**, **Body**, **Body format** (plain/HTML), and the **Attachment field** — set to the binary field produced upstream (e.g. the Excel Template output, field `file`) to attach the report.

### Control flow

- **Wait / Execute Workflow / Loop / Stop and Error** — pause, call another workflow, iterate, or fail deliberately.

## Building scheduled reports

The most common lab use — “query a database on a schedule, fill a template, email it” — has its own step-by-step walkthrough (including the AMR example): see **[Scheduled reports with workflows](/docs/report-pipeline)**.

## Expected result

The workflow saves, a manual run completes or reports a clear failure, and run history shows inputs, duration, status, and node outcomes for review.

## Troubleshooting

- **A node cannot run:** select it and complete every required field (a database/email node needs a **connector** selected).
- **A connector option is missing:** confirm the connector exists, is enabled, and matches the node's type (see [Connectors](/docs/connectors)).
- **A materialized dataset is empty:** run the workflow that *builds* it before the one that *reads* it, and check the source and transform nodes.
- **The email sent but has no attachment:** set the Send Email node's **Attachment field** to the binary field produced upstream (usually `file`).
- **A run fails after a branch:** inspect the branch condition and the node immediately before the failure.

## Advanced web usage

- Split heavy work into two workflows joined by a dataset: one **materializes** the optimized data on a schedule; a lighter one **loads** it, formats, and delivers. This keeps the source query fast and portable.
- Keep database queries as plain `SELECT`s and move pivots/joins into the **Pivot** and **Merge (combine by key)** nodes, so a workflow built for one database runs on another by swapping the connector.
- Investigate failures from run history before editing, so you know whether the issue is data, configuration, or destination availability.

## Related guides

- [Scheduled reports with workflows](/docs/report-pipeline)
- [Connectors](/docs/connectors)
- [Reports](/docs/reports)
- [Audit](/docs/audit)
