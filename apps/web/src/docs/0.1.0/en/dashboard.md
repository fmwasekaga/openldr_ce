# Dashboard

The dashboard is the landing page. It shows a configurable grid of **widgets**: KPIs, charts, gauges, and tables built from the data in your warehouse. You can keep several dashboards and switch between them with the selector in the top-left.

## Viewing

Each widget runs its own query and renders the result. Dashboards are shared across the deployment.

## Editing

Click **Edit** to enter edit mode. In edit mode you can add widgets, drag or resize them on the 12-column grid, edit or delete widgets from their header controls, and define dashboard-level filter variables.

## Building a widget

The widget editor has two query modes:

- **Builder**: choose a source, metric, optional group-by dimension, and date grain. The builder compiles to a safe query that works across PostgreSQL and SQL Server warehouses.
- **SQL**: advanced PostgreSQL-only mode for read-only `SELECT` statements.

## Dashboard filters

Define filter variables (text, number, date, or date range) and bind them into widgets. Changing a filter value re-runs the bound widgets.

## Custom SQL configuration

```text
DASHBOARD_SQL_ENABLED=false
DASHBOARD_SQL_TIMEOUT_MS=5000
DASHBOARD_SQL_ROW_CAP=10000
```

The SQL tab is disabled by default. It is available only on PostgreSQL warehouses and runs each query in a read-only transaction with timeout and row-cap safeguards.

Workflow datasets published with `WORKFLOW_DATASET_PUBLISH_ENABLED=true` are queryable from PostgreSQL dashboards as `wf_ds_<name>` tables with one `data jsonb` column.

![Dashboard](dashboard.png)
