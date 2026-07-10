# Custom Queries

The Query workbench is a SQL editor for exploring your connected databases and saving reusable, parameterized queries. Saved **Custom Queries** are what [Report Designer](/docs/report-designer) tables bind to and what published [reports](/docs/reports) run to produce their results.

## Outcome

You can browse connectors, schemas, and tables in the Explorer, write and run a parameterized `SELECT` against the results grid, declare parameters, and save the query for reuse.

![Explorer tree with Connectors and Custom Queries expanded](query-workbench.png)

![SQL editor with a saved Custom Query run and results in the grid](query-sql-editor.png)

## Before you begin

- You need the Lab Admin, Lab Manager, or Data Analyst role.
- A Postgres connector must already exist — see [Connectors](/docs/connectors). The Query workbench works with Postgres connectors only.
- Basic SQL knowledge helps, but browsing tables does not require writing SQL yourself.

## Steps

1. Open **Query** from the main navigation.
2. In the **Explorer**, expand **Connectors** to browse a connector's schemas and tables, or expand **Datasets** to see datasets materialized by workflows.
3. Select a table to open a quick browse tab, or select **+** in the tab bar to start a new query.
4. Choose a connector for the query tab, then write a `SELECT` statement in the editor.
5. Select the parameters icon to declare parameters: a **Variable ID**, **Label**, **Type** (Text, Select, or Date range), and whether it's **Required**. A Select parameter also takes an **Options SQL** whose first column populates the dropdown.
6. Reference a declared parameter in your SQL as `{{ param.<id> }}` — a Date range parameter provides `{{ param.from }}` and `{{ param.to }}`.
7. Select **Run**. If the query has parameters, a sheet asks you to fill in run values first; otherwise it runs immediately. Results appear in the grid below, with paging.
8. Select **Save** to persist the query as a Custom Query. It appears under **Custom Queries** in the Explorer and can be reopened and re-run later; selecting Save again updates the same saved query.

## Expected result

The query runs against the chosen connector and returns rows in the results grid. Once saved, the Custom Query is available in the Explorer and can be bound to a table in [Report Designer](/docs/report-designer) or picked as a report's primary query.

## Troubleshooting

- **Run is disabled:** select a connector and write a query first.
- **"unbound parameter" error:** every `{{ param.x }}` token in the SQL needs a matching declared parameter.
- **"required parameter" error at run time:** fill in a value for every parameter marked Required.
- **The query is rejected:** only `SELECT` statements are allowed — statements that modify data or schema are not permitted.
- **No connectors listed in the Explorer:** create or enable a Postgres connector — see [Connectors](/docs/connectors).
- **You need to rename a saved query:** renaming and duplicating saved queries aren't available yet — save a new query with the name you want, then delete the old one from the Explorer (hover it and select the trash icon).

## Advanced web usage

- Keep queries as plain, parameterized `SELECT`s so the same Custom Query can be reused across a Report Designer table binding and a report's primary query.
- A report's filters always come from its template's parameters, not from the query directly — give a Custom Query parameter the same **Variable ID** as the matching template parameter's key so the template's filter value flows through when the report runs.
- Use **Datasets** in the Explorer to query data a workflow has already materialized, instead of hitting a live source table directly.

## Related guides

- [Reports](/docs/reports)
- [Report Designer](/docs/report-designer)
- [Connectors](/docs/connectors)
