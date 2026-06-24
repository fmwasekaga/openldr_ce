# DHIS2 Reporting

OpenLDR can push AMR surveillance data to a DHIS2 instance as aggregate **dataValueSets** and as **tracker events**.

## Connecting

DHIS2 connection details (base URL, username, password) live in an encrypted **Connector**, not in environment variables. Create one under **Settings ▸ Connectors**: pick the `dhis2-sink` plugin, enter the base URL and credentials, then click **Test connection** to verify reachability and pull a metadata summary. Secrets are encrypted at rest and never shown again.

Two environment values still apply:

```text
REPORTING_TARGET_ADAPTER=dhis2     # enables DHIS2 reporting-target wiring
SECRETS_ENCRYPTION_KEY=<base64>    # 32-byte key (openssl rand -base64 32) — required to store/read connector secrets
DHIS2_SYNC_ENABLED=true            # optional, enables scheduled/event-driven sync
```

Each DHIS2 mapping selects which connector receives its push (see **Mapping** below).

## Mapping

A mapping links OpenLDR organisation units and data elements to DHIS2 UIDs. It covers org-unit mapping, data-element/category-combo mapping, and period windowing. Import the mappings, then validate before pushing:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 orgunit import orgunits.json --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 map import mapping.json --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 validate <mappingId> --json
```

Use `pnpm openldr dhis2 pull-metadata` before building mappings if you want the UI and validators to use cached DHIS2 metadata. Use `pnpm openldr dhis2 status` to confirm connector and cache state.

## Pushing

Push a mapping for a DHIS2 period. Add `--dry-run` to preview the payload without sending. Tracker events use a separate subcommand and target event programs only.

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 push <mappingId> --period 2026Q1 --dry-run --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 push <mappingId> --period 2026Q1 --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 tracker push <mappingId> --period 2026Q1 --dry-run --json
```

## Scheduled and event-driven sync

Register a schedule to republish on a period cadence. Pass `--event-driven` for tracker schedules that should also push after completed ingest batches.

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 schedule add <mappingId> --mode aggregate --period-type quarterly --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 schedule add <mappingId> --mode tracker --period-type monthly --event-driven --json
```

If a command fails during configuration loading, confirm `REPORTING_TARGET_ADAPTER=dhis2` is set, `SECRETS_ENCRYPTION_KEY` is configured, and a connector is created and enabled under Settings ▸ Connectors.

![DHIS2 setup](doc-dhis2.png)
