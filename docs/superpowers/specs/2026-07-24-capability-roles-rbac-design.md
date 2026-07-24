# Settings → Roles: capability-based RBAC — Design

**Date:** 2026-07-24
**Status:** Approved (brainstorm), pending implementation plan
**Inspiration:** `corebunch/instatic` — admin-defined roles composed from a grid of granular capabilities.

## Problem

OpenLDR CE today has **five hardcoded roles** (`lab_admin`, `lab_manager`,
`lab_technician`, `data_analyst`, `system_auditor`) wired 1:1 to **coarse role
checks**. The server gates routes with `requireRole('lab_admin')`
([`apps/server/src/rbac.ts`](../../../apps/server/src/rbac.ts)); the frontend
gates routes with `<RequireRole role="…">`. Roles are flat and non-hierarchical,
and the *authorization source is Keycloak* — the server reads
`realm_access.roles` from the verified JWT
([`apps/server/src/auth-plugin.ts`](../../../apps/server/src/auth-plugin.ts)).

An operator cannot define a role like "Content editor: can edit dashboards and
run reports, but nothing else." They can only pick from the five fixed tiers.

## Goal

A true, admin-defined, capability-based RBAC system:

- Admins create/edit/delete **custom roles** in `Settings → Roles`, each composed
  from a grid of **~36 action-level capabilities** grouped by domain.
- Capabilities are **enforced end-to-end** — the server gates each route on the
  specific capability, and the UI hides what the user cannot do.
- Roles are assigned to users at creation/edit time.

## Key architectural decisions (from brainstorm)

1. **Enforcement depth:** real fine-grained gating — every capability gates a
   specific server route *and* the corresponding UI.
2. **Source of truth:** **OpenLDR's Postgres owns roles + capabilities.**
   Keycloak is demoted to **pure authentication** (proves identity via `sub`).
3. **Assignment model:** a `user_roles` table in OpenLDR links user → role(s).
   The token is **not consulted for authorization**. Capability/role edits take
   effect on the **next request** — no re-login, no Keycloak Admin API calls for
   authz.
4. **Granularity:** action-level (~36 caps across 14 domains).
5. **Multiple roles per user; effective capabilities = the union** across all
   assigned roles.

## Capability catalog (code-defined contract)

The catalog is a **constant in `@openldr/core`**, *not* a database table — it is
an application contract shipped and versioned with the code. The DB stores only
*which* capabilities a role grants (`role_capabilities` rows keyed by the string
capability key). A new app version may add capability keys; a seed/migration
backfills the affected system roles.

Catalog (36 keys below, across 14 domains; final set pinned during
implementation against the actual guarded surfaces). The four caps marked *(new)*
were added after mapping the presets to today's real guards — they cover gated
surfaces (Query workbench, Connectors, Activity, Notifications) that the first
draft missed:

| Domain | Capabilities |
|---|---|
| Dashboards | `dashboards.view` · `dashboards.create` · `dashboards.edit` · `dashboards.delete` |
| Reports | `reports.view` · `reports.run` · `reports.edit_templates` · `reports.export` |
| Forms | `forms.view` · `forms.edit` · `forms.publish` |
| Workflows | `workflows.view` · `workflows.edit` · `workflows.run` · `workflows.manage_secrets` |
| Query | `query.run` *(new)* |
| Users | `users.view` · `users.manage` · `users.reset_password` · `users.force_logout` |
| Roles | `roles.view` · `roles.manage` |
| Terminology | `terminology.view` · `terminology.manage` |
| Marketplace | `marketplace.view` · `marketplace.manage` |
| Connectors | `connectors.manage` *(new)* |
| Sync | `sync.view` · `sync.manage` |
| Settings | `settings.view` · `settings.edit_general` · `settings.feature_flags` · `settings.danger_zone` |
| Observability | `activity.view` *(new)* · `notifications.view` *(new)* |
| Audit | `audit.view` |

Each key has a human label + description + domain-group, defined alongside the
key so the builder UI and CLI render identically without duplicating strings.

## Data model — new `rbac` schema (Postgres)

- **`roles`** — `id`, `slug` (alias-safe, unique), `name`, `description`,
  `is_system` (bool), `created_at`, `updated_at`.
- **`role_capabilities`** — (`role_id`, `capability`) — one row per granted cap.
- **`user_roles`** — (`user_id`, `role_id`) — a user may hold multiple roles.

Follows existing schema conventions in `packages/db/src/schema`.

## System roles (backward-compat migration)

Seed the existing five as `is_system` roles so current installs keep working:

- **Administrator** (from `lab_admin`) → **all capabilities**; **locked**
  (cannot be deleted or edited) — the permanent escape hatch.
- `lab_manager`, `lab_technician`, `data_analyst`, `system_auditor` → seeded with
  the exact preset below; **editable but not deletable**.

The presets are derived from — and preserve — each role's *actual* access today
(mapped from every `requireRole`/`RequireRole` guard in the code), so the cutover
changes nobody's effective permissions:

| Capability | Admin | Manager | Analyst | Auditor | Technician |
|---|:--:|:--:|:--:|:--:|:--:|
| `dashboards.view` | ✓ | ✓ | ✓ | ✓ | — |
| `dashboards.create` / `edit` / `delete` | ✓ | ✓ | — | — | — |
| `reports.view` | ✓ | ✓ | ✓ | ✓ | — |
| `reports.run` | ✓ | ✓ | ✓ | — | — |
| `reports.export` | ✓ | ✓ | ✓ | — | — |
| `reports.edit_templates` | ✓ | ✓ | — | — | — |
| `forms.view` (fill/submit) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `forms.edit` / `publish` | ✓ | ✓ | — | — | — |
| `workflows.view` / `edit` / `run` / `manage_secrets` | ✓ | ✓ | — | — | — |
| `query.run` | ✓ | ✓ | ✓ | — | — |
| `terminology.view` | ✓ | ✓ | ✓ | ✓ | — |
| `terminology.manage` | ✓ | ✓ | — | — | — |
| `activity.view` | ✓ | ✓ | ✓ | ✓ | — |
| `notifications.view` | ✓ | ✓ | ✓ | ✓ | — |
| `audit.view` | ✓ | — | — | ✓ | — |
| `users.*` | ✓ | — | — | — | — |
| `roles.view` / `manage` | ✓ | — | — | — | — |
| `marketplace.view` / `manage` | ✓ | — | — | — | — |
| `connectors.manage` | ✓ | — | — | — | — |
| `sync.view` / `manage` | ✓ | — | — | — | — |
| `settings.view` / `edit_general` / `feature_flags` / `danger_zone` | ✓ | — | — | — | — |

Deliberate calls baked into the presets:

- **Technician stays data-entry-only** — its one meaningful cap is `forms.view`
  (matches today, where it appears in no guard). No dashboards.
- **`terminology.view`** is a read baseline for analyst/auditor (browsing is
  largely open today); only `terminology.manage` (import/edit) is restricted.
- **Connectors** is a single admin-only `connectors.manage` cap, not a view/edit
  split (it is an admin infra page).

**Migration of existing users:** a Keycloak user already carrying `lab_admin`
(etc.) is auto-mapped to the matching system role by slug on first login, so
**nobody loses access** during the cutover. After migration, authorization comes
solely from `user_roles`.

**Currently-ungated routes:** a handful of authenticated routes have no role
guard today (e.g. form fill/submit). The enforcement slice pins each to either a
baseline cap (`forms.view`) or a specific cap; any that would tighten access
for a system role is called out in that slice's plan before it lands.

## Enforcement

### Server

- New `requireCapability('users.reset_password')` preHandler **replaces every**
  `requireRole(...)` call across the route files.
- Resolution: request → user id (verified token `sub`) → `user_roles` →
  `role_capabilities` → union set, **memoized per request**.
- `realm_access.roles` is **no longer consulted for authz**. Identity mirroring
  via `syncFromClaims` stays (audit-actor identity + disable switch).
- New `GET /api/me/capabilities` returns the caller's effective capability set.

### Frontend

- `useAuth()` gains `hasCapability(key)`.
- `<RequireCapability cap="…">` replaces `<RequireRole>` for route gating.
- Menu items / action buttons hide when the required capability is absent.
- The capability set is fetched from `GET /api/me/capabilities`.

### Dev bypass

`AUTH_DEV_BYPASS` dev actor is granted **all capabilities** (keeps local dev
frictionless). See [[auth-dev-bypass-optin]].

## Lockout safety (server-enforced invariants)

- The **Administrator** role cannot be deleted or edited.
- Cannot delete the last role that grants `roles.manage`.
- Cannot remove your **own** `roles.manage` capability, nor unassign your own
  last role that grants it.
- There must always be **≥1 user** holding `roles.manage`.

## Builder UI (`Settings → Roles`)

Instatic-style:

- **Roles list** — name, description, badge for `is_system`, member count,
  kebab menu (edit / delete). New "Create Role" button.
- **Create/Edit Role sheet** — `Name`, `Slug` (auto-derived, editable, locked on
  system roles), `Description`, and the **capability grid grouped by domain**
  with per-group + global "Select all" and an "N of M selected" counter — a
  direct analogue of the instatic screenshot.
- **User assignment** — the existing User dialog gains a **role multi-select**,
  replacing the raw Keycloak-roles field. Assignment writes `user_roles`.

Follows repo UI conventions: shadcn components, edge-to-edge dividers, kebab
menus, `StripedEmpty`/`Spinner` states.

## CLI parity (per repo convention)

Shared via `@openldr/bootstrap`:

- `openldr roles list | show <slug> | create | edit <slug> | delete <slug>`
- `openldr roles grant <slug> <cap> | revoke <slug> <cap>`
- `openldr user assign-role <user> <slug> | unassign-role <user> <slug>`

## Audit

New audited actions: `role.create`, `role.update`, `role.delete`,
`user.assign_role`, `user.unassign_role` — recorded via the existing
`recordAudit` helper.

## Non-goals (YAGNI)

- **No role hierarchy / inheritance** — flat roles, union of caps (matches
  today's model and instatic).
- **No row-level / per-resource permissions** (e.g. "can edit *this* dashboard
  only"). Caps are per-domain-action, not per-instance.
- **No Keycloak Admin API involvement for authz** — KC stays authentication-only.
- **No per-widget / per-connector sub-capabilities** in v1.

## Sequencing (independently testable slices)

1. **Model + catalog + seed/migration** — `rbac` schema, capability catalog in
   `@openldr/core`, system-role seed, existing-user auto-map.
2. **Server enforcement sweep** — `requireCapability`, per-request resolution,
   `GET /api/me/capabilities`, replace all `requireRole` calls.
3. **Builder UI + user assignment** — Roles page, role sheet, user dialog
   multi-select.
4. **CLI + audit** — CLI commands, audit actions.
