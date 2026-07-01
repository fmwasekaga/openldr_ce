# Dashboard

Dashboards turn warehouse data into shared operational views. Use them to monitor key metrics, compare trends, and publish workflow-created datasets to users who do not need to build queries themselves.

## Outcome

You can open a dashboard, read existing widgets, enter edit mode, add a widget, choose between Builder and SQL mode, and save the layout for other users.

![Dashboard overview with shared widgets](dashboard-overview.png)

## Before you begin

- You can view dashboards with a normal signed-in account.
- You need dashboard editing permission to see **Edit**, **Add widget**, and **Save**.
- SQL mode may be hidden if the administrator has limited dashboards to Builder mode.

## Steps

1. Open **Dashboard** from the main navigation.
2. Use the dashboard selector, if present, to choose the dashboard you want to read.
3. Review each widget title, filter state, chart, table, or KPI card.
4. Open **Dashboard menu**.
5. Select **Edit**.
6. Open **Dashboard menu** again and select **Add widget**.
7. In the widget editor, enter a clear title and choose **Builder** for guided configuration or **SQL** for an advanced read-only query.
8. Use **Editor menu** to review widget actions, preview data, or adjust editor options.
9. Select **Save** to keep the widget.
10. Select **Done** to leave edit mode.

![Widget editor opened from dashboard edit mode](dashboard-edit-widget.png)

## Expected result

The dashboard reloads with the saved widget in place. Other users who can view the dashboard see the updated layout and widget output.

## Troubleshooting

- **No dashboard appears:** you may not have access to a shared dashboard yet, or no dashboard has been created.
- **A widget is empty:** check its filters and date range first; then open edit mode and confirm the source query returns rows.
- **SQL mode is missing:** SQL widgets are an advanced option and may be disabled for this deployment or unavailable for the connected warehouse.
- **The query shows an error:** switch back to Builder mode if possible, or simplify the SQL query to a read-only `SELECT` that returns a small result.

## Advanced web usage

- **Dashboard variables:** create text, number, date, or date-range variables so users can change filters without editing widgets.
- **Builder versus SQL mode:** use Builder for portable dashboards and SQL only when the exact warehouse shape matters.
- **Workflow-published datasets:** workflows can publish curated datasets that appear as dashboard sources, making complex transformations available through normal dashboard widgets.

## Related guides

- [Reports](/docs/reports)
- [Workflows](/docs/workflows)
