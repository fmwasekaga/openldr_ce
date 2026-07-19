# OpenLDR CE CLI Reference

Source of truth: `packages/cli/src/index.ts`. Captured help output for every command and subcommand is committed at `docs/audit/2026-06-23/cli-help-output.md`.

Run commands from the repository root:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr --help
```

## Exit Codes

Most commands return `0` on success and `1` on validation/runtime failure. Commander help invocations return `0`. Commands that talk to external services or databases also return `1` when required config is missing or the service is unavailable.

## Command Families

| Command | Purpose |
|---|---|
| `openldr health` | Probe configured adapters and service health. |
| `openldr errors list` | List the error-code catalog. |
| `openldr fhir validate <file>` | Validate a FHIR JSON resource or bundle. |
| `openldr db migrate/reset/seed` | Manage internal and target database schema and seed data. |
| `openldr target-store test` | Probe the analytics warehouse adapter. |
| `openldr terminology ...` | Import, query, translate, and administer terminology assets. |
| `openldr forms list/extract` | List forms or extract QuestionnaireResponse data. |
| `openldr ingest <file>` | **Ingest a data file through the pipeline** (accept + drain), optionally via a converter plugin. The primary "push data into CE" CLI. |
| `openldr pipeline ...` | Inspect/retry ingest pipeline batches. |
| `openldr queue status` | Inspect the event queue. |
| `openldr provenance audit` | Inspect provenance/audit information. |
| `openldr plugin ...` | Install, list, test, run, and remove WASM plugins. |
| `openldr report ...` | List/run reports and export GLASS RIS. |
| `openldr report-def list/delete` | Manage data-driven report definitions. |
| `openldr report-design list/delete` | Manage Report Designer page designs. |
| `openldr audit list` | Query append-only audit events. |
| `openldr users list` / `openldr user ...` | Manage local users and roles. |
| `openldr settings flags/numbers/sync/danger ...` | Read/write feature flags, numeric limits, sync config, and danger-zone actions. |
| `openldr sync ...` | Distributed (lab⇄central) sync status/control, enrollment, amendment, divergence, and offline bundle export/import. |
| `openldr export` | Export the complete dataset: canonical FHIR (NDJSON + Bundle) + flat-table CSV + manifest. |
| `openldr market ...` | Verify, install, update, enable/disable, roll back, and remove marketplace bundles. |
| `openldr artifact ...` | Author, build, sign, pack, test, and publish marketplace artifacts. |

> **DHIS2 has no core CLI.** DHIS2 shipped as a removable plugin; there is no `openldr dhis2 …` command. Its mappings, org units, and pushes are driven from the plugin's own screens or from workflow nodes.

## Copy-Paste Examples

PowerShell and bash use the same `pnpm openldr` command forms. Use PowerShell line continuations with backticks and bash continuations with backslashes.

```powershell
pnpm openldr health --json
pnpm openldr db migrate --json
pnpm openldr target-store test --engine pg --json
pnpm openldr report list --json
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --json
```

```bash
pnpm openldr health --json
pnpm openldr db migrate --json
pnpm openldr target-store test --engine pg --json
pnpm openldr report list --json
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --json
```

## Ingesting data — `openldr ingest`

`openldr ingest <file>` runs a file through the ingest pipeline (accept → convert → drain into the FHIR store). It is the file/CLI half of the "push data into CE" story (the HTTP half is the workflow webhook — see [Operator Guide → Ingesting & pushing data](OPERATOR-GUIDE.md)).

| Option | Default | Purpose |
|---|---|---|
| `--converter <id>` | `fhir-bundle` | Converter that parses the file. `fhir-bundle` expects a FHIR transaction/collection Bundle. |
| `--plugin <id>` | — | Alias of `--converter`; use an installed WASM converter plugin (e.g. `whonet-sqlite`, `hl7v2`, `tabular`). |
| `--config <file>` | — | Plugin config JSON (e.g. tabular column mapping). |
| `--source <s>` | `cli` | Source-system identifier recorded on the batch/provenance. |
| `--json` | off | Emit the batch result as JSON. |

```bash
# FHIR Bundle (default converter)
pnpm openldr ingest bundle.json --json
# WHONET SQLite via a converter plugin (must be installed first)
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --json
# Inspect / retry the resulting batch
pnpm openldr pipeline status --json
pnpm openldr pipeline retry <batchId>
```

## Sync

Distributed sync links labs to a central OpenLDR server. Two command groups cover it: `openldr settings sync …` edits the stored configuration on a lab, and `openldr sync …` reports live status, triggers a pass, and (on central) enrolls labs. All accept `--json`.

**Configuration (lab) — `openldr settings sync`**

| Command | Purpose |
|---|---|
| `openldr settings sync show` | Print the current sync configuration (the secret is never shown, only whether one is set). |
| `openldr settings sync set <field> <value>` | Set one field: `enabled`, `mode`, `centralUrl`, `siteId`, `oidcIssuer`, `clientId`, `clientSecret`, or `intervalMinutes`. |

`mode` is one of `push`, `pull`, or `bidirectional`. `clientSecret` is write-only.

**Status and control — `openldr sync`**

| Command | Purpose |
|---|---|
| `openldr sync status` | Show live sync status: workers, cursors, and the pending push backlog. |
| `openldr sync now` | Trigger a sync pass immediately. Fails (exit `1`) if sync is disabled. |
| `openldr sync quarantine list` | List bulk records the pull stream is holding or has quarantined, with attempt counts and the last error. |
| `openldr sync quarantine retry <entityType> <entityId>` | Clear a quarantined bulk entity and re-sync it by id (url). Fails (exit `1`) if the retry does not apply. |
| `openldr sync divergence list` | List same-version divergences detected between the lab and central. |
| `openldr sync divergence show <resourceType> <resourceId> <version>` | Inspect one divergence. |
| `openldr sync divergence clear <resourceType> <resourceId> <version>` | Acknowledge/clear a divergence. |

A pull record that fails repeatedly is quarantined rather than left to block the stream — see [Operator Guide → Distributed sync](OPERATOR-GUIDE.md#distributed-sync).

**Offline bundle (sneakernet) — `openldr sync`**

For a lab with no live link, sync can move through a signed file instead of HTTP.

| Command | Purpose |
|---|---|
| `openldr sync export` | Write a signed offline sync bundle to a file (on a lab this is the push delta; on central use `--site <id>` for that site's pull delta). |
| `openldr sync import <file>` | Apply a signed offline sync bundle received from the other side. |

**Result amendment — `openldr sync`** (run on the central server)

| Command | Purpose |
|---|---|
| `openldr sync amend --resource-type <t> --id <id> --status <s> [--reason <text>] [--patch <json>] [--agent <who>] [--activity <verb>]` | Amend a lab-owned result on central: writes a new FHIR version and queues it for the owning lab to pull back. `--patch` is a JSON fragment merged into the resource. `--activity` (default `amend`) labels the co-edit; supported resource types are `Observation`, `DiagnosticReport`, and `ServiceRequest`. |

For an order (co-edit lab request status/metadata), amend the `ServiceRequest`, e.g. `openldr sync amend --resource-type ServiceRequest --id <id> --status completed --activity update`.

| Command | Purpose |
|---|---|
| `openldr sync merge-patient --survivor <id> --duplicate <id> [--reason <text>]` | Intra-lab patient merge on central: re-points the duplicate patient's lab history (requests/results/specimens) to the survivor and marks the duplicate replaced. Both patients must belong to the same site. |

The owning lab drains these central-authored amendments on its pull pass via the `'sync-amend-pull'` cursor (a distinct `change_cursors` consumer alongside `'sync-push'`, `'sync-pull'`, and the terminology cursor).

**Central-side enrollment — `openldr sync`** (run on the central server)

| Command | Purpose |
|---|---|
| `openldr sync enroll <siteId> [--name <name>] --central-url <url>` | Mint a lab's Keycloak client + registry row and print the client id and secret **once**. `--central-url` is required. |
| `openldr sync list` | List enrolled sites and their status (never shows secrets). |
| `openldr sync rotate <siteId>` | Issue a new client secret for a site and print it once. |
| `openldr sync revoke <siteId>` | Delete a site's client and mark its registry row revoked (idempotent). |

Enrollment requires the central Keycloak realm to grant the admin service account `manage-clients`/`view-clients` (present in the shipped realm export).

Enroll a lab on central, then hand the printed credentials to the lab operator:

```bash
pnpm openldr sync enroll lab-site-01 --name "Regional Reference Lab" --central-url https://central.example.org --json
pnpm openldr sync list --json
```

## Captured Terminal Output

`docs/audit/2026-06-23/cli-help-output.md` is a captured terminal-output appendix (dated 2026-06-23 — it predates the `errors`, `ingest`, `report-def`, `report-design`, and `sync divergence/export/import` additions, and still shows the removed `dhis2` group, so treat it as a snapshot, not the current surface; run `pnpm openldr <group> --help` for the live help). It contains fenced `console` blocks with the prompt, command, real output, and `EXIT_CODE` for each command, including:

- top-level `openldr --help`;
- every command family help page;
- every leaf subcommand help page.

Live examples that require services, databases, Keycloak, or DHIS2 should be run only after `.env` is configured and `docker compose up -d` plus `pnpm e2e:seed` have completed.
