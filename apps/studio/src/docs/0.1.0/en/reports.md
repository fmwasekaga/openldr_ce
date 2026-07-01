# Reports

Reports are guided, parameterized views over the warehouse. Use them when you need a repeatable result that can be run, reviewed, exported, scheduled, and audited from the web interface.

## Outcome

You can select a report, set parameters, run it, switch between **Document** and **Spreadsheet**, review **History**, and open **Schedules** when your role allows schedule management.

![Report selected with spreadsheet results](reports-run-result.png)

## Before you begin

- Confirm the source data has been ingested and is visible to the web app.
- Know the date window or facility filter you want to use.
- Ask an administrator for report-management permission if you need **Schedules**.

## Steps

1. Open **Reports** from the main navigation.
2. Select a report such as **AMR Resistance Rate**.
3. Review the description so you know what the report counts and how it groups results.
4. Set required parameters. Leave optional parameters blank when you want the broadest result.
5. Select **Run**.
6. Read the **Document** view for a formatted explanation.
7. Switch to **Spreadsheet** to inspect rows and columns.
8. Open **History** to review previous runs, status, duration, and output format.
9. Open **Schedules** if your role allows recurring runs.

![Report history and schedules drawer](reports-history-schedules.png)

## Expected result

The report run completes, the result appears in the selected view, and the run is listed in **History**. If schedules are enabled for your role, schedule controls are available from the same report area.

## Troubleshooting

- **Run is disabled:** a required parameter is missing or the selected report is not ready to run.
- **The result is empty:** widen the date range, remove optional filters, or confirm that the relevant data has been ingested.
- **Permission denied:** your account can view reports but may not have permission to manage schedules or run restricted reports.
- **A previous run failed:** open **History**, inspect the error, adjust parameters, and run again.

## Advanced web usage

- Use **Spreadsheet** when you need exact row values for review or downstream analysis.
- Use **History** to compare repeated runs and confirm whether a result changed after new data arrived.
- Use **Schedules** for recurring operational reports when the same parameters should run on a predictable cadence.
- Pair reports with [Audit](/docs/audit) when investigating who changed report settings or schedules.

## Related guides

- [Dashboard](/docs/dashboard)
- [Audit](/docs/audit)
