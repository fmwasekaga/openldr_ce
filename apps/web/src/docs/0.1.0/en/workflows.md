# Workflows

Workflows let Lab Admins and Lab Managers design repeatable web-based data processes. Use them to collect inputs, transform records, branch by condition, publish datasets, and send outputs to approved connectors.

## Outcome

You can find a workflow, create one, add and connect nodes, configure visible triggers, save, run, inspect node states, and review run history.

![Workflow list with search and row actions](workflows-list.png)

## Before you begin

- You need the Lab Admin or Lab Manager role.
- Know the source, transformation goal, and output destination before building.
- Create or confirm any connector you plan to use from [Connectors](/docs/connectors).

## Steps

1. Open **Workflows**.
2. Use search to find an existing workflow, then use row actions to open, duplicate, import, export, or delete when your role allows it.
3. Choose the action for a new workflow.
4. Name the workflow and open the builder.
5. Add a trigger node. Use the visible trigger type that matches the job: manual, schedule, webhook, or ingest.
6. Add source, transform, branch, materialize, or sink nodes from the node palette.
7. Drag from one node handle to another to connect nodes in execution order.
8. Select a node to configure required fields in the side panel.
9. Remove a node or connection only after checking downstream dependencies.
10. Select **Save**.
11. Run the workflow manually when you need an immediate test.

![Workflow builder with nodes, canvas, configuration, and run controls](workflow-builder.png)

12. Watch node states while the run progresses.
13. Open run history to compare status, duration, and node-level results.

![Workflow run history with node results](workflow-run-history.png)

## Expected result

The workflow saves successfully, a manual run completes or reports a clear failure, and run history shows the inputs, duration, status, and node outcomes needed for review.

## Troubleshooting

- **A node cannot run:** select it and complete every required configuration field.
- **A connector option is missing:** confirm the connector is enabled and that your role can use it.
- **A run fails after a branch:** inspect the branch condition and the node state immediately before the failing node.
- **A materialized dataset is empty:** check the upstream source and transform nodes before changing dashboard or report configuration.

## Advanced web usage

- Compose source and sink nodes so data flows from a controlled input to an approved destination.
- Use branching for quality checks, exception handling, and separate paths for accepted and rejected records.
- Materialize datasets when dashboards or reports need stable, reusable workflow output.
- Design retry-safe workflows by avoiding duplicate side effects in sink nodes.
- Investigate failures from run history before editing the workflow, so you know whether the issue is data, configuration, or destination availability.

## Related guides

- [Reports](/docs/reports)
- [Connectors](/docs/connectors)
- [Audit](/docs/audit)
