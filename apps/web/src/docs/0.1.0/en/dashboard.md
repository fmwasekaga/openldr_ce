# Dashboard

The dashboard is the landing page. It shows a configurable grid of **widgets** — KPIs, charts, gauges, and tables — built from the data in your warehouse. You can keep several dashboards and switch between them with the selector in the top-left.

## Viewing

Each widget runs its own query and renders the result. Switch dashboards with the **Dashboard** selector. Dashboards are shared across the deployment.

## Editing

Click **Edit** to enter edit mode. In edit mode you can:

- **Add Widget** — open the widget editor (see below).
- **Drag** a widget by its header handle to move it, or drag its corner to resize. The 12-column grid packs widgets upward automatically.
- **Edit** or **delete** a widget with the buttons on its header.
- **Filters** — define dashboard-level filter variables.

Changes auto-save while you edit; click **Done** to leave edit mode.

## Building a widget

The widget editor has two ways to define a query, with a live preview on the right:

- **Builder** (default) — pick a **Source** (e.g. Test Orders, Results, Specimens), a **Metric** (a count or aggregate), an optional **Group by** dimension, and — for date dimensions — a **Grain** (day/week/month/year). The builder compiles to a safe, parameterized query that runs on both PostgreSQL and SQL Server warehouses.
- **Visualization** — choose how the result is drawn: KPI, line / bar / area / row / pie / scatter / funnel chart, gauge, progress bar, traffic light, or table.

## Dashboard filters

Define filter variables (text, number, date, or date range) and bind them into widgets. Changing a filter value re-runs the bound widgets, so one control can drive the whole dashboard.

## Custom SQL (advanced)

When enabled by an administrator, a **SQL** tab lets you write a read-only `SELECT` query directly. This escape hatch is **disabled by default**, is available **only on PostgreSQL warehouses**, and runs each query in a read-only transaction with a statement timeout and row cap. Use `{{variable}}` placeholders to reference dashboard filters. For portability and safety, prefer the visual builder.

## Themes

Use the sun/moon toggle in the top bar to switch between dark and light themes. Your choice is remembered in the browser.

![Dashboard](dashboard.png)
