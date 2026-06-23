# Reports and AMR/GLASS

OpenLDR ships a catalog of parameterized reports over the flattened warehouse tables.

## Available reports

- **AMR Resistance Rate**: percent resistant per antibiotic, first-isolate deduplicated.
- **Antibiogram**: susceptibility matrix by organism and antibiotic.
- **Test Volume**: requests by test and month.
- **Turnaround Time**: collection-to-report hours.
- **Patient Demographics**: counts by gender and age band.

## Parameters

Reports accept a date window (`from`/`to`, inclusive) and optional filters such as facility.

## Exporting

Every report exports to **CSV** from its detail page. AMR reports also render to **PDF**. The WHO GLASS **RIS** file is available from the GLASS export route.

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr report list --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr report run amr-resistance --param from=2026-01-01 --param to=2026-03-31 --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr report glass-export --from 2026-01-01 --to 2026-03-31 --out glass-ris.csv
```

## History and schedules

Report runs are recorded under run history. Users with report-management permissions can create, patch, delete, and manually trigger schedules. Scheduled outputs can be downloaded from the schedule-run download route.

![AMR report](report-amr.png)
