# Report Designer

Report Designer is a free-form, drag-and-drop page designer for printable report templates. Build a layout, bind its tables to a saved [Custom Query](/docs/query), and publish the result as a report on the [Reports](/docs/reports) library.

## Outcome

You can create a template, place and arrange Text, Table, Image, Line, Rectangle, and Date elements on A4 or Letter pages, bind a table to a Custom Query and choose its columns, add filter parameters, preview the template with live data, export it to PDF or Excel, and publish it as a report.

## Before you begin

- You need the Lab Admin or Lab Manager role.
- Write and save the query that will supply the report's data first — see [Custom Queries](/docs/query). You can also do this later and come back to bind it.
- Know the layout you want: single page or multi-page, and which columns the table should show.

## Steps

1. Open **Report Designer** from the main navigation.
2. Choose **New template** from the **⋯** menu, or select an existing template in the left explorer to keep working on it.
3. Set the template's name in the field at the top of the canvas.
4. Use **⋯ → Insert** to drop a Text, Table, Image, Line, Rectangle, or Date element onto the page. Drag to reposition and use the resize handles to size it.
5. Select the **Table** element and open its **Data** tab. Choose **Bind query** to pick a Custom Query, then **Load columns** and check off which columns appear on the report — reorder and relabel them as needed.
6. Still in the **Data** tab, use **Add parameter** to define the filters the report will expose (Text, Select, or Date range). Give each one a clear label — these become the filters shown when the report runs. Match a parameter's **Key** to a bound query's parameter **Variable ID** so the filter value flows into the query when the report runs.
7. Choose **Preview** to render the template to PDF using live data.
8. Select **Save**. The save status next to the template name shows Saved, Saving, or Unsaved changes; the designer also autosaves as you work.
9. Use **⋯ → Export → PDF** or **Excel** to download the current template's output directly.
10. When the template is ready, choose **⋯ → Publish**. Give the report a **Name**, **Category** (add, rename, or reorder categories from the same picker), an optional **Description**, and confirm the **Template** and **Primary query** — the primary query's rows feed the published report's Spreadsheet tab and summary. Select **Create report**.

## Expected result

The template saves and appears in the left explorer. Preview renders a PDF using the template's live data. Publishing adds a new entry to the [Reports](/docs/reports) library under the chosen category, with filters that match the template's parameters.

## Troubleshooting

- **Publish is unavailable or prompts you to save first:** a template must be saved at least once before it can be published.
- **No columns to choose from:** pick a query in **Bind query**, then select **Load columns**.
- **Preview fails to render:** check that the bound query and its parameters are valid, then try again.
- **Nothing to export:** the template has no table elements yet.
- **A table's rows run onto extra pages:** this is expected — tables paginate automatically across multiple pages when the data doesn't fit on one.

## Advanced web usage

- Turn on **Page numbers** in the page settings to add a footer to every page.
- A template can span several pages — add and arrange elements independently on each one.
- Use **⋯ → Duplicate** to branch a new template from an existing layout, and **⋯ → Delete** to remove one you no longer need.
- From [Reports](/docs/reports), managers can jump straight back into a published report's template with **Edit template**.
- Use **Undo/Redo** and the zoom controls while arranging elements precisely.

## Related guides

- [Reports](/docs/reports)
- [Custom Queries](/docs/query)
- [Connectors](/docs/connectors)
