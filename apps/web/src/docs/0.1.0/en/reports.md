# Reports & AMR/GLASS

OpenLDR ships a catalog of parameterized reports over the flattened warehouse tables.

## Available reports

- **AMR Resistance Rate** — percent resistant (%R) per antibiotic, first-isolate deduplicated.
- **Antibiogram** — susceptibility matrix by organism and antibiotic.
- **Test Volume** — requests by test and month.
- **Turnaround Time** — collection-to-report hours.
- **Patient Demographics** — counts by gender and age band.

## Exporting

Every report exports to **CSV** from its detail page. AMR reports also render to **PDF**. The WHO GLASS **RIS** file is available from the GLASS export route.

![AMR report](report-amr.png)

## Parameters

Reports accept a date window (`from`/`to`, inclusive) and an optional facility filter via the parameter bar.
