# DHIS2 Aggregate Reporting

OpenLDR can push AMR surveillance data to a DHIS2 instance as aggregate **dataValueSets** and as **tracker events**.

## Connecting

Set the DHIS2 connection in your environment:

```
REPORTING_TARGET_ADAPTER=dhis2
DHIS2_BASE_URL=http://localhost:8085
DHIS2_USERNAME=admin
DHIS2_PASSWORD=district
```

## Mapping

A mapping links OpenLDR organisation units and data elements to DHIS2 UIDs. It covers org-unit mapping, data-element/category-combo mapping, and period windowing (the reporting period is derived from the report's date range). Import the mappings, then validate before pushing:

```
pnpm openldr dhis2 orgunit import orgunits.json
pnpm openldr dhis2 map import mapping.json
pnpm openldr dhis2 validate <mappingId>
```

## Pushing

Push a mapping for a DHIS2 period. Add `--dry-run` to preview the payload without sending. Tracker events use a separate subcommand and target event programs only.

```
pnpm openldr dhis2 push <mappingId> --period 2026Q1
pnpm openldr dhis2 tracker push <mappingId> --period 2026Q1
```

## Scheduled & event-driven sync

Register a schedule to republish on a period cadence. Pass `--event-driven` (tracker) to also push after each completed ingest batch:

```
pnpm openldr dhis2 schedule add <mappingId> --mode aggregate --period-type quarterly
pnpm openldr dhis2 schedule add <mappingId> --mode tracker --period-type monthly --event-driven
```

![DHIS2 setup](doc-dhis2.png)
