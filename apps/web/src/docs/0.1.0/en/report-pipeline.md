# Scheduled reports with workflows

This guide shows how to reproduce a classic “scheduled report” — query a database, fill a branded Excel template, and email it — entirely with workflows, so nobody has to write or run a separate program to push data.

The pattern uses **two workflows joined by a dataset**:

1. **Materialize** — the heavy half. On a schedule it pulls data from the source database, reshapes it, and saves a named **dataset** (an “optimized table”). Run it as often as the data needs refreshing.
2. **Report & email** — the delivery half. It **loads** that dataset, fills an Excel template, and emails the file. Run it whenever the report is due.

Splitting the work this way keeps the source query fast (delivery reads the pre-built dataset, not the live tables) and lets the two halves run on different schedules.

## Outcome

A branded, optionally password-protected `.xlsx` report is generated from live data and emailed to recipients on a schedule — configured entirely in the builder.

## Before you begin

- The Lab Admin or Lab Manager role.
- A **database connector** to your source (see [Connectors → Database connectors](/docs/connectors)).
- An **email connector** — an SMTP connector is easiest, including Gmail via an App Password (see [Connectors → Send from Gmail](/docs/connectors)).
- Your branded `.xlsx` **template** file, with a header row and data starting on the row below it.

## Part A — the Materialize workflow

Build this graph (trigger → set → two SQL extracts → reshape → materialize):

1. **Schedule trigger** — set the cron for how often the data should rebuild.
2. **Edit Fields** — compute the reporting window, e.g. `periodStart` = first of last month, `periodEnd` = first of this month. These feed the queries.
3. **Database node(s)** — one or more **Postgres / Microsoft SQL** nodes, each with your source **connector** and a plain `SELECT`. Inject the window with templates:

   ```sql
   select ...
   from requests r
   where r.registered >= '{{ $json.periodStart }}'
     and r.registered <  '{{ $json.periodEnd }}'
   ```

   Keep each query a portable `SELECT` — do the reshaping in the next nodes, not in database-specific SQL.
4. **Pivot** (if needed) — turn long rows into wide columns (e.g. one column per antibiotic): set the group-by keys, the pivot column, the value column, and the fixed list of output columns.
5. **Merge → Combine by key** (if you have two extracts) — join them on shared keys (e.g. `requestid`, `organism`). Wire the “left” branch into the node **first**.
6. **Materialize Dataset** — give it a stable name, e.g. `amr_ndola_monthly`.

**Save and run it.** Confirm the run is green and the dataset has rows (an empty dataset means the source or the date window returned nothing).

## Part B — the Report & email workflow

Build this graph (trigger → load → template → email):

1. **Schedule trigger** — set it to fire after Part A has refreshed the dataset.
2. **Load Dataset** — the same name you materialized (`amr_ndola_monthly`).
3. **Excel Template**:
   - Click **Upload template** and choose your `.xlsx` — the *Template artifact key* fills in automatically. *(The workflow must be saved first, because the upload is stored against it.)*
   - **Start cell** — where data begins, e.g. `A2`.
   - **Columns (ordered)** — the item fields in template-column order; values are written left to right from the start cell.
   - **Auto-filter header cell** — e.g. `A1`, to add a filter over the header row (optional).
   - **Password** — to protect the file, point at a connector/secret holding the password; leave blank for an unprotected file.
4. **Send Email**:
   - **Connector** — your SMTP/email connector.
   - **To** (and **Cc**) — recipients.
   - **Subject** / **Body** / **Body format**.
   - **Attachment field** — set to `file` so the Excel Template output is attached.

**Run it** and check the recipient's inbox (and spam on first send).

## Worked example — the AMR monthly report

The Antimicrobial Sensitivity report is the pattern at full stretch:

- **Materialize:** two portable `SELECT`s — one for the culture isolates, one for the long-form AST results — then a **Pivot** spreads ~50 antibiotics into columns, a **Merge → Combine by key** joins isolates to their pivoted results on `requestid` + `organism`, and **Materialize Dataset** writes `amr_ndola_monthly`.
- **Report:** **Load Dataset** → **Excel Template** fills the branded `AMR_temp.xlsx` (start `A2`, auto-filter `A1`, optional password) → **Send Email** attaches the file to the recipients.

Every antimicrobial-specific and date-specific piece lives in nodes, so the same two workflows run against Postgres or SQL Server just by choosing the matching connector.

## Order of operations

Always run **Materialize before Report** — the Report reads what Materialize wrote. On a schedule, set the Report to fire a little after the Materialize run.

## Troubleshooting

- **Report attachment is empty / headers only:** the dataset was empty — run Materialize first and check the date window and source query.
- **“Save the workflow first” when uploading a template:** save the workflow, then upload (the file is stored against the saved workflow).
- **Email sends but no file is attached:** set the Send Email **Attachment field** to `file`.
- **Gmail rejects the login:** use an App Password, not your normal password — see [Connectors → Send from Gmail](/docs/connectors).
- **A database node has nothing to run against:** create and attach a database connector — see [Connectors](/docs/connectors).
- **Join produced no rows:** confirm both branches use the **same key field names**, and that the left branch is wired into the Merge node first.

## Related guides

- [Workflows](/docs/workflows)
- [Connectors](/docs/connectors)
- [Reports](/docs/reports)
