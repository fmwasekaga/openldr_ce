# Roles

Administrators use **Settings → Roles** to control exactly what each account can see and do, capability by capability.

> **Authentication vs. authorization:** Keycloak still handles sign-in — it verifies who a user is. OpenLDR owns *what a signed-in user can do*: every role, every capability, and every user-to-role assignment lives in the OpenLDR database, not in Keycloak. This means access control keeps working the same way regardless of which identity provider is connected.

## Outcome

You can see the built-in system roles, inspect the capabilities each one grants, create a custom role from the capability grid, and understand how roles reach a user's account.

## Before you begin

- You need the **Manage roles** capability (granted to Administrator by default).
- Know which capabilities the person's job actually requires — grant the smallest set that lets them work.

## What a capability is

A **capability** is a single, narrow permission such as *Run reports*, *Edit workflows*, or *Manage users*. Capabilities are grouped by area (Dashboards, Reports, Forms, Workflows, Query, Users, Roles, Terminology, Marketplace, Connectors, Sync, Settings, Observability, Audit) and are the only thing the server checks before it lets a request through — every page and every action is gated behind one or more capabilities.

A **role** is simply a named, reusable bundle of capabilities. A **user** can hold one or more roles; their effective permissions are the union of every capability granted by every role assigned to them.

## Built-in system roles

OpenLDR ships five system roles, each a starting point you can assign as-is or copy the idea from when building a custom role:

- **Administrator** — every capability in the catalog. This role is **locked**: its capability set cannot be edited or removed, so there is always at least one account that can recover access.
- **Lab Manager** — manage dashboards, reports, forms, and workflows, plus terminology and the query workbench. No user administration or settings access.
- **Data Analyst** — view dashboards, run and export reports, use the query workbench. Read-oriented, no editing capabilities.
- **System Auditor** — read-only oversight across the main workspaces, plus the audit log.
- **Lab Technician** — data entry only: open and submit forms, nothing else.

System roles other than Administrator can be edited (their capability set adjusted) but not deleted while users remain assigned, and Administrator can never be edited or deleted — it is permanently locked.

## Steps: create a custom role

1. Open **Settings → Roles**.
2. Select **Create Role**.
3. Enter a **Name**; a URL-safe **Slug** is derived automatically (you can adjust it before saving — it becomes fixed once the role is created).
4. Add an optional **Description** so other administrators know when to use this role.
5. In the capability grid, tick each capability the role should grant. Capabilities are grouped by area to make related permissions easy to find.
6. Select **Create** to save the role.

To change an existing non-locked role, open its row (or its **⋯ → Edit** action), adjust capabilities, and save. Roles that still have members can be edited but not deleted; remove all members first if you need to delete a role.

## Assign roles to users

Role assignment happens on the user's own record, not on the role:

1. Open **Users**.
2. Open the **Actions** menu for the account and choose **Edit**.
3. In the **Roles** section of the edit dialog, tick every role the user should hold (a user can hold more than one).
4. Save. The user's effective capabilities become the union of all ticked roles' capabilities, and take effect the next time their session refreshes (or immediately on next sign-in).

## Expected result

The Roles list shows each role's name, description, and member count. A user's visible pages, menu items, and allowed actions match the union of capabilities granted by their assigned roles.

## Troubleshooting

- **Can't edit a role's capabilities:** the role is locked (Administrator) or you lack the **Manage roles** capability — you can still open it to inspect its capabilities.
- **Can't delete a role:** it is a locked system role, or it still has members; reassign or remove those members first.
- **A user still has old access after a role change:** ask them to sign out and back in, or wait for their session to refresh.
- **A newly created user seems to have no access:** confirm at least one role was assigned — an account with zero roles has zero capabilities.

## Advanced web usage

Prefer several narrow custom roles over one broad role reused everywhere — it keeps the audit trail (`role.create`, `role.update`, `role.delete`, `user.assign_role`) meaningful and makes it obvious what a future capability change actually affects. The `openldr roles` CLI commands mirror everything in this page for scripted or headless administration.

## Related guides

- [Users and Roles](/docs/users)
- [Audit](/docs/audit)
- [Settings](/docs/settings)
