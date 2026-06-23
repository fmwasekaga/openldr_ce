# DHIS2 Aggregate Reporting

OpenLDR can push AMR surveillance data to a DHIS2 instance as aggregate **dataValueSets** and as **tracker events**.

## Connecting

Set the DHIS2 connection in your environment:

```text
REPORTING_TARGET_ADAPTER=dhis2
DHIS2_BASE_URL=http://localhost:8085
DHIS2_USERNAME=admin
DHIS2_PASSWORD=district
DHIS2_SYNC_ENABLED=true
```

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

If a command fails during configuration loading, confirm `REPORTING_TARGET_ADAPTER=dhis2` is paired with all three connection secrets: `DHIS2_BASE_URL`, `DHIS2_USERNAME`, and `DHIS2_PASSWORD`.

![DHIS2 setup](doc-dhis2.png)
