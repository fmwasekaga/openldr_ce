# Audit

Audit helps administrators and managers trace user-visible changes across workflows, forms, users, reports, connectors, and settings.

> **Sign-in history:** Successful logins and logouts are handled by Keycloak, not OpenLDR — the app never sees the password. Find them in the Keycloak admin console under **Realm → Events**. This log records failed authentications (`auth.failed`) and operator actions — including CLI actions, shown with the `cli` actor type.

## Outcome

You can open Audit, apply filters, inspect an event, interpret actor/action/entity/time fields, copy identifiers, and trace a change across related events.

![Audit table with filters and timestamp column](audit-filter.png)

## Before you begin

- Know the approximate time, actor, entity, or action you want to investigate.
- Use narrow filters first when the event volume is high.

## Steps

1. Open **Audit**.
2. Set a time range or use the visible timestamp column to orient the investigation.
3. Filter by actor, action, entity type, or entity identifier.
4. Select an event row such as a workflow or form update.
5. Review actor, action, entity, and time.
6. Copy identifiers when you need to compare with another screen.
7. Inspect before/after details when they are available.
8. Follow related events by reusing the actor, entity, or identifier as another filter.

![Audit event detail with actor, entity, and before/after data](audit-event-detail.png)

## Expected result

You can explain who changed what, when it happened, which entity was affected, and what adjacent events may be part of the same activity.

## Troubleshooting

- **No events appear:** widen the time range or clear one filter at a time.
- **The actor is unexpected:** check whether a scheduled workflow or system action performed the change.
- **Before/after details are empty:** some events record the action without a full object snapshot.
- **Too many related events:** combine entity and actor filters to narrow the sequence.

## Advanced web usage

Combine filters to follow multi-step activity: start with the entity, add the actor, then compare timestamps across update, run, publish, or delete events.

## Related guides

- [Users and Roles](/docs/users)
- [Workflows](/docs/workflows)
