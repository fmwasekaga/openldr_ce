# AMR Ndola report demo (dev-only toolkit)

Recreates the Zambia team's `sp_Ndola_ast_data_month` pm2 report job as two portable
**Workflow Builder** graphs (SQL → pivot → join → materialize, then load → Excel template
→ email). This is **development/demo tooling** — it is **not** part of the production
build (the `scripts/` folder is not bundled into the `api`/`studio`/`web` images). Use it
to demo or smoke-test the report pipeline against a synthetic fixture.

See also: `packages/workflows/src/reports/amr-columns.ts` (the 54 antibiotics / 74 template
columns) and `apps/studio/src/docs/0.1.0/en/report-pipeline.md`.

## Prerequisites
- Dev stack running (`docker compose up -d` → Postgres on `:5433`) and a `.env` with
  `INTERNAL_DATABASE_URL` + `SECRETS_ENCRYPTION_KEY`.
- Run everything from the repo root.

## Prove the pipeline end-to-end (no app, captured email)
```
docker exec openldr_ce-postgres-1 psql -U openldr -d openldr -c "CREATE DATABASE amr_fixture;"
pnpm tsx scripts/amr-report-integration.ts     # seeds, runs both graphs, verifies the encrypted xlsx → PASS
```

## Set it up inside the app (real Workflow Builder + real email)
```
# 1. generate the importable graphs + fixture SQL, then install the workflows
CLAUDE_SCRATCHPAD=./scratchpad pnpm tsx scripts/seed-amr-report-demo.ts
CLAUDE_SCRATCHPAD=./scratchpad pnpm tsx scripts/install-amr-workflows.ts
# 2. wire connectors
pnpm tsx scripts/wire-amr-postgres-connector.ts        # PG connector → Materialize DB nodes
pnpm tsx scripts/wire-amr-extras.ts                    # password connector + generates AMR_temp.xlsx to upload
GMAIL_USER=you@gmail.com GMAIL_APP_PASSWORD='...' pnpm tsx scripts/wire-gmail-connector.ts  # real SMTP (verified)
# 3. in Studio → Workflows: upload AMR_temp.xlsx to the excel-template node, Run Materialize then Report
```
Notes: the fixture holds one sample AMR row — repoint the PG connector at the real LIMS DB
for real data. `wire-gmail-connector` sets the recipient to `GMAIL_USER` by default; edit the
send-email node for the real recipients. The report xlsx is encrypted (default password `Micro!`).

## Tear it down (revert to a clean app)
```
pnpm tsx scripts/amr-demo-revert.ts                                                   # removes the 2 workflows + 3 demo connectors
docker exec openldr_ce-postgres-1 psql -U openldr -d openldr -c "DROP DATABASE IF EXISTS amr_fixture;"
```
