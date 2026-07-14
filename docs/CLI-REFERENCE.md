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
| `openldr fhir validate <file>` | Validate a FHIR JSON resource or bundle. |
| `openldr db migrate/reset/seed` | Manage internal and target database schema and seed data. |
| `openldr target-store test` | Probe the analytics warehouse adapter. |
| `openldr terminology ...` | Import, query, translate, and administer terminology assets. |
| `openldr forms list/extract/ingest` | List forms, extract QuestionnaireResponse data, or ingest responses. |
| `openldr pipeline ...` | Inspect/retry ingest pipeline batches. |
| `openldr queue status` | Inspect the event queue. |
| `openldr provenance audit` | Inspect provenance/audit information. |
| `openldr plugin ...` | Install, list, test, run, and remove WASM plugins. |
| `openldr report ...` | List/run reports and export GLASS RIS. |
| `openldr audit list` | Query append-only audit events. |
| `openldr users list` / `openldr user ...` | Manage local users and roles. |
| `openldr settings sync ...` | Read/write the lab⇄central sync configuration (the discrete `sync.*` keys the workers read). |
| `openldr sync ...` | Lab⇄central sync status/control and central-side site enrollment. |
| `openldr export` | Export a portable data snapshot manifest. |
| `openldr dhis2 ...` | Manage DHIS2 mappings, org units, pushes, metadata, tracker, and schedules. |
| `openldr market ...` | Verify, install, update, enable/disable, roll back, and remove marketplace bundles. |
| `openldr artifact ...` | Author, build, sign, pack, test, and publish marketplace artifacts. |

## Copy-Paste Examples

PowerShell and bash use the same `pnpm openldr` command forms. Use PowerShell line continuations with backticks and bash continuations with backslashes.

```powershell
pnpm openldr health --json
pnpm openldr db migrate --json
pnpm openldr target-store test --engine pg --json
pnpm openldr report list --json
pnpm openldr dhis2 push mapping-1 --period 2026Q1 --dry-run --json
```

```bash
pnpm openldr health --json
pnpm openldr db migrate --json
pnpm openldr target-store test --engine pg --json
pnpm openldr report list --json
pnpm openldr dhis2 push mapping-1 --period 2026Q1 --dry-run --json
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
pnpm openldr sync enroll lab-ndola-01 --name "Ndola Central Hospital" --central-url https://central.example.org --json
pnpm openldr sync list --json
```

## Captured Terminal Output

The audit ran `--help` for 99 CLI command forms. Use `docs/audit/2026-06-23/cli-help-output.md` as the terminal-output appendix. It contains fenced `console` blocks with the prompt, command, real output, and `EXIT_CODE` for each command, including:

- top-level `openldr --help`;
- every command family help page;
- every leaf subcommand help page.

Live examples that require services, databases, Keycloak, or DHIS2 should be run only after `.env` is configured and `docker compose up -d` plus `pnpm e2e:seed` have completed.
