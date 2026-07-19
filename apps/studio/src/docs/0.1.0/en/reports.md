# Reports

Reports are data-driven: each one links a printable **Report Designer** template (the layout) to a **Custom Query** (the data). Use them when you need a repeatable result that can be run, reviewed, exported, scheduled, and audited from the web interface.

## Outcome

You can browse the report library by category, select a report, fill in filters derived from its template, run it, switch between **Document** and **Spreadsheet**, review **Run History**, and open **Schedules** when your role allows schedule management.

![Report selected with spreadsheet results](reports-run-result.png)

## Before you begin

- Confirm the report you need has already been published. Reports are **not** created from this page — a Lab Admin or Lab Manager authors and publishes them from [Report Designer](/docs/report-designer).
- Confirm the source data has been ingested and is visible to the web app.
- Know the date window or facility filter you want to use.
- Ask an administrator for report-management permission if you need **Schedules**.

## Steps

1. Open **Reports** from the main navigation.
2. Browse the library, grouped by **Category**. Use the search box to filter by name, or star a report to pin it to the top.
3. Select a report. Reports built from a template carry a **Template** badge.
4. Set the filters shown above the result — these are generated automatically from the parameters defined on the report's template (for example Date range or Facility). Leave optional filters blank when you want the broadest result.
5. Select **Run**.
6. Read the **Document** tab for the formatted, printable PDF.
7. Switch to **Spreadsheet** to inspect, sort, filter, and export rows as CSV or XLSX.
8. Review the summary strip above the result, if the report defines one, for at-a-glance totals.
9. Open the report's **⋯ Actions** menu and choose **Run History** to review previous runs, status, duration, and output format.
10. From the same **⋯ Actions** menu, open **Schedules** if your role allows recurring runs.
11. If you manage reports, use the report's **⋯** menu for **Edit template** (jumps to the template in Report Designer), **Unpublish** (removes it from the library without deleting the template), or **Delete** (with confirmation).

![Report history and schedules drawer](reports-history-schedules.png)

## Expected result

The report run completes, the result appears in both the Document and Spreadsheet views, and the run is listed in **Run History**. If schedules are enabled for your role, schedule controls are available from the same report area.

## Troubleshooting

- **Run is disabled:** a required filter is missing.
- **The result is empty:** widen the date range, remove optional filters, or confirm that the relevant data has been ingested.
- **Permission denied:** your account can view reports but may not have permission to manage schedules, edit templates, or unpublish/delete.
- **A previous run failed:** open **Run History**, inspect the error, adjust filters, and run again.
- **A report you expect isn't in the library:** it may have been unpublished, or it hasn't been created yet — see [Report Designer](/docs/report-designer) to publish it.

## Advanced web usage

- Use **Spreadsheet** when you need exact row values, sorting, filtering, or a CSV/XLSX export for downstream analysis.
- Use **Run History** to compare repeated runs and confirm whether a result changed after new data arrived.
- Use **Schedules** for recurring operational reports when the same filters should run on a predictable cadence.
- The filters on this page come straight from the template's parameters — to add, remove, or rename a filter, edit the template's parameters in [Report Designer](/docs/report-designer), not this page.
- Pair reports with [Audit](/docs/audit) when investigating who changed report settings or schedules.

## Related guides

- [Report Designer](/docs/report-designer)
- [Custom Queries](/docs/query)
- [Dashboard](/docs/dashboard)
- [Audit](/docs/audit)
