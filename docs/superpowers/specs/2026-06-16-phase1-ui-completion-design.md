# Phase-1 UI Completion — Users, Audit, Forms — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorm) — pending implementation plan
**Module:** apps/web + apps/server + @openldr/users + @openldr/audit + @openldr/forms + @openldr/db
**Design source of truth:** corlix (`D:\Projects\Repositories\corlix`) — reimplement-not-copy (PRD §10).

## Problem

Phase 1 (PRD `openldr-ce-prd-phase1.md`) requires the SPA to host **all** domain
surfaces: forms-driven entity screens (§5.3 / P1-FORM), users (§5.8 / P1-USER), and
audit (§5.7 / P1-AUD) — see P1-UI-1. The backends exist
(`packages/forms`, `packages/users`, `packages/audit`; `ctx.users`/`ctx.audit` are
wired; migrations `005_audit_events` + `006_users` exist) but the **UI was parked**:
`apps/web/src/shell/AppShell.tsx` lists **Forms / Users / Audit** in a disabled
`SOON` array, and `apps/web/src/App.tsx` routes only Dashboard/Reports/Terminology/
Docs. No `users`/`audit`/`forms` REST routes are registered. This sub-project
enables those three pages, closing the Phase-1 UI gap.

## Backend reality (drives the scope)

- **Users** — `@openldr/users` `UserStore`: `create/get/getByUsername/list/setRoles/
  setStatus/syncFromClaims`. A `User` is `{ id, subject, username, displayName, email,
  roles: string[], status: 'active'|'disabled', lastLoginAt }`. CE users are
  **Keycloak-decoupled / JIT-provisioned from token claims** — there is **no password,
  reset, reset-email, or force-logout** (corlix has those; CE deliberately does not —
  identity lives in the OIDC provider). *Stated divergence from corlix.*
- **Audit** — `@openldr/audit` `AuditStore`: `record/list(filter)/get`. `AuditEvent` is
  `{ id, occurredAt, actorType:'user'|'system', actorId, actorName, action, entityType,
  entityId, before?, after?, metadata? }`. `AuditFilter` = `{ actorId, entityType,
  entityId, action, from, to, limit }`. **Read-only** surface. The store needs a small
  extension for proper pagination (offset + total count).
- **Forms** — `@openldr/forms` is the **engine only** (FHIR Questionnaire conversion
  `toQuestionnaire`/`fromQuestionnaire`, `validateAnswers`, `visibility`, `response`,
  `to-bundle`, `extract`, sample forms via `samples/forms`). There is **no forms
  persistence store, no migration, no `ctx.forms`, no REST**. corlix's Form **Builder**
  (drag-drop, 17 field types, undo/redo, version history, translations, FHIR-path
  mapping, terminology binding) is its single largest UI.

**Forms decomposition (stated reason).** Because Forms needs a whole persistence +
REST layer that doesn't exist yet, and the full Builder is a major effort, Forms is
split:
- **Forms Slice A (this sub-project):** a `form_definitions` store + migration + REST
  + a Forms **list** page + a **runtime capture** page that renders a stored form for
  data entry using the existing `@openldr/forms` engine. This enables the Forms page
  and exercises the engine end-to-end.
- **Forms Slice B (next, separate spec+plan):** the full corlix Form **Builder**
  (authoring UI). Deferred — too large to bundle accurately here.

## Architecture overview

```
apps/web ─ AppShell (enable Forms/Users/Audit nav) · App.tsx routes
          pages/Users.tsx · pages/Audit.tsx · pages/Forms.tsx · pages/FormCapture.tsx
                │ api.ts (fetch)
apps/server ─ users-routes.ts · audit-routes.ts · forms-routes.ts  (via ctx, DP-1, redact())
                │ ctx.users / ctx.audit / ctx.forms
@openldr/users (UserStore)   @openldr/audit (AuditStore + offset/total)   @openldr/forms (engine + NEW FormStore)
                │
@openldr/db ─ migration 016_form_definitions   (audit_events/users already exist)
```

DP-1 preserved: `apps/server` imports `@openldr/bootstrap` only; routes use
`ctx.users`/`ctx.audit`/`ctx.forms`, never `@openldr/db`. Errors via `redact()`.

## Section 1 — Users

### Store (no change needed beyond what exists)
`ctx.users` already exposes `list/create/get/setRoles/setStatus`. Add a thin
`update(id, { displayName?, email? })` convenience if not present (else the route
composes existing setters). Keep create input `{ username, displayName?, email?,
roles? }`.

### REST (`apps/server/src/users-routes.ts`)
| Method | Path | Handler |
|---|---|---|
| GET | `/api/users` | `ctx.users.list()` |
| POST | `/api/users` | create (zod: username required, displayName/email/roles optional) |
| GET | `/api/users/:id` | get (404 if missing) |
| PUT | `/api/users/:id` | update displayName/email + setRoles (zod) |
| POST | `/api/users/:id/roles` | setRoles (zod: roles[]) |
| POST | `/api/users/:id/status` | setStatus (zod: 'active'|'disabled') |

A small role vocabulary constant (suggested, not enforced): `lab_admin`,
`lab_manager`, `lab_technician`, `data_analyst`, `system_auditor` (mirrors corlix's
`ROLE_ORDER`, used to sort + offer chips; roles remain free-form strings).

### Page (`apps/web/src/pages/Users.tsx`) — corlix `UsersPage` adapted
- AppShell page; toolbar: search (debounced) over username/displayName + "New user"
  button. (No bulk-import — corlix has it; CE defers.)
- Table (shadcn `Table` + `TablePagination`, reuse SP1–SP4 components): Username ·
  Full name · Email · Roles (badge pills, sorted by the role vocabulary) · Status
  (Active=emerald / Disabled=gray badge, reuse `statusBadge` pattern) · Last login ·
  `⋯`.
- Row `⋯`: Edit · Enable/Disable (toggle via `/status`). No reset/logout.
- **UserDialog** (right `Sheet`): create = username (required) + displayName + email +
  roles (chip multi-select from the vocabulary, free add allowed); edit = username
  read-only + displayName/email/roles + status. Uses shadcn primitives only.
- Errors surfaced inline (action-error banner pattern from `TermsTable`).

## Section 2 — Audit

### Store extension (`@openldr/audit`)
Extend `AuditFilter` with `offset?: number` and add `count(filter): Promise<number>`
(same WHERE clauses, `count(*)`), OR change `list` to return `{ events, total }`.
Chosen: add `offset` to `list` + a separate `count(filter)` (smaller change, keeps
`list` shape). The route returns `{ events, total }`.

### REST (`apps/server/src/audit-routes.ts`)
| Method | Path | Handler |
|---|---|---|
| GET | `/api/audit?action=&entityType=&entityId=&actorId=&from=&to=&limit=&offset=` | `{ events: list(filter), total: count(filter) }` |
| GET | `/api/audit/:id` | get (404 if missing) |

### Page (`apps/web/src/pages/Audit.tsx`) — corlix `AuditLogPage` adapted
- Filter popover (shadcn `Popover`): Action · Entity type · Entity ID · Actor · From ·
  To · (sort defaults newest-first — the store already orders `occurred_at desc`).
  Draft filters apply on "Apply"; active-filter chips with remove; Reset.
- Table: Timestamp · Actor (actorName) · Action (badge; `tamper.*`/`*delete*` →
  destructive color, else muted) · Entity type · Entity ID · `⋯`/row-click → detail.
  `TablePagination` (limit/offset + total).
- **Detail Sheet** (right): id, occurredAt, actor (name + id + type), action, entity
  (type + id), and **Before / After / Metadata** rendered as pretty-printed JSON
  blocks with copy buttons. Read-only.

## Section 3 — Forms Slice A (store + list + runtime capture)

### Migration `016_form_definitions` (`@openldr/db`)
```sql
CREATE TABLE form_definitions (
  id            text PRIMARY KEY,                 -- form-<uuid>
  name          text NOT NULL,
  version_label text,
  fhir_resource_type text,                        -- Patient | Bundle | … | null (custom)
  status        text NOT NULL DEFAULT 'draft',    -- draft | published | archived
  active        boolean NOT NULL DEFAULT true,
  schema        jsonb NOT NULL,                    -- the FormSchema (engine type) as JSON
  target_pages  jsonb,                             -- string[] (patients/orders/…) or null
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_definitions_status ON form_definitions(status);
```
Register in `internal/index.ts`; add `FormDefinitionsTable` to `schema/internal.ts`.
Optionally **seed** the `@openldr/forms` `samples/forms` so the list isn't empty.

### Form store (`packages/forms/src/store.ts`)
`createFormStore(db: Kysely<InternalSchema>)` — `@openldr/forms` already exists; add a
`@openldr/db` dependency for `InternalSchema` (audit/users do the same). API:
```ts
list(): Promise<FormSummary[]>;                 // id,name,versionLabel,status,active,fhirResourceType,fieldCount,updatedAt
get(id): Promise<FormDefinition | null>;        // full schema
create(input): Promise<FormDefinition>;         // name + schema (+ metadata)
update(id, input): Promise<FormDefinition>;     // schema + metadata
setStatus(id, 'draft'|'published'|'archived'): Promise<FormDefinition>;
delete(id): Promise<void>;
listPublished(targetPage?): Promise<FormSummary[]>;  // active && status=published
```
`FormSummary.fieldCount` = `schema.fields.length`. jsonb via `JSON.stringify` (pg-mem).

### Bootstrap
Add `ctx.forms = createFormStore(internal.db)` (+ the `AppContext.forms` type), mirror
in any second wiring site.

### REST (`apps/server/src/forms-routes.ts`)
| Method | Path | Handler |
|---|---|---|
| GET | `/api/forms` | list |
| GET | `/api/forms/published?targetPage=` | listPublished |
| GET | `/api/forms/:id` | get (404) |
| POST | `/api/forms` | create (zod: name + schema object) |
| PUT | `/api/forms/:id` | update |
| POST | `/api/forms/:id/status` | setStatus (zod enum) |
| DELETE | `/api/forms/:id` | delete |
| GET | `/api/forms/:id/questionnaire` | `toQuestionnaire(schema)` (FHIR R4 export) |
| POST | `/api/forms/:id/responses` | validate answers (engine) → return FHIR QuestionnaireResponse/Bundle |

### Forms list page (`apps/web/src/pages/Forms.tsx`) — corlix `FormListPage` adapted
- Toolbar: search + "Import form JSON" (file input → validate name+fields → create).
  ("New form" is **disabled with a tooltip** — "Form builder coming in a later
  sub-project" — since the Builder is Slice B; stated divergence/placeholder.)
- Table: Name (+ optional profile subtitle) · FHIR resource type (badge) · Fields
  (count) · Version · Status (badge) · Active · Updated · `⋯` (View/Run · Publish ·
  Archive · Export questionnaire · Delete). Row-click → FormCapture (run).

### Forms runtime capture page (`apps/web/src/pages/FormCapture.tsx`)
Reuses the `@openldr/forms` engine to render a stored form for data entry and produce
a `QuestionnaireResponse`/Bundle:
- Load the form via `getForm(id)`; render its `schema.fields`/`sections` with shadcn
  inputs per `fieldType` (text/number/date/datetime/boolean/select/multiselect; group/
  repeatable add-remove). Use the engine's `visibility` (enableWhen) + `validateAnswers`
  for required/constraint/binding validation. (Specialized widgets — organism/
  antibiogram/reference/facility — render as basic inputs in Slice A with a TODO note;
  full widgets ride with Slice B.)
- On submit: `validateAnswers` → if clean, build the response via the engine
  (`response`/`to-bundle`) and **POST `/api/forms/:id/responses`**, which validates
  server-side (`validateAnswers`) and returns the FHIR `QuestionnaireResponse`/Bundle
  (persisting the response to the FHIR store is a thin add; if out of scope for Slice A,
  return it + log). Surface validation errors inline.

> Slice A proves the forms pipeline (define → store → render → validate → FHIR
> response) without the authoring Builder. Entity-specific capture (Patients/Orders
> bound to `targetPages`) and the Builder are Slice B.

## Section 4 — Web shell wiring

- `AppShell.tsx`: move **Users, Audit, Forms** out of `SOON` into `NAV` with routes
  `/users`, `/audit`, `/forms` (+ `/forms/:id` capture). Keep icons.
- `App.tsx`: add the four routes.
- `api.ts`: client fns + types for users / audit / forms (duplicate types web-side per
  the established cross-boundary rule).

## Section 5 — CLI (optional, lightweight)

Add read commands for agent-operability (P1-CLI), matching existing style:
- `users list [--json]`, `audit list [--action --entity --from --to --json]`,
  `forms list [--json]`. (Create/mutate via UI/REST; CLI stays read-first here.)

## Section 6 — Testing

- **Audit store** (pg-mem): `offset`/`count` pagination; filter combinations.
- **Form store** (pg-mem): create/get/update/setStatus/list/listPublished/delete;
  jsonb round-trip; fieldCount.
- **REST contract**: users CRUD + status; audit query + detail + pagination shape;
  forms CRUD + status + questionnaire export + capture validation (happy + invalid).
- **Web**: a render/smoke test per page (table renders, dialog opens) following the
  SP-era `*.test.tsx` pattern; unit tests for any helper (role-sort, action-badge).
- **e2e** (`e2e/tests/`): Users (create → appears → disable), Audit (filter narrows
  rows → open detail), Forms (import sample → appears → open capture → submit a valid
  response). Idempotent via `RUN=Date.now()`.
- **Gates**: `pnpm turbo typecheck lint test build` + `pnpm depcruise` green (no new
  cycles — `@openldr/forms` gaining a `@openldr/db` dep mirrors audit/users; confirm
  acyclic).
- i18n: new strings English-literal for now (consistent with SP1–SP4; the repo's
  fr/pt coverage is a separate gap noted for later — P1-UI-4).

## Section 7 — Non-goals (deferred)

- **Forms Slice B — the full drag-drop Form Builder** (authoring): own spec+plan next.
- Keycloak-side user ops (password/reset/reset-email/force-logout) — not in CE's
  decoupled model.
- Bulk user import; audit CSV export beyond the global `export` CLI.
- Entity-specific capture screens (Patient/Order registration bound to `targetPages`)
  and specialized form widgets (organism/antibiogram/reference/facility) — Slice B.
- fr/pt translations of the new UI (tracked separately under P1-UI-4).

## Affected code (orientation)

- `packages/db/src/migrations/internal/016_form_definitions.ts` (+ test) + `index.ts`;
  `schema/internal.ts` (`FormDefinitionsTable`).
- `packages/audit/src/store.ts` (+ test) — `offset` + `count`.
- `packages/forms/src/store.ts` (+ test) + `packages/forms/package.json` (`@openldr/db` dep) + `index.ts` export.
- `packages/bootstrap/src/index.ts` — `ctx.forms` (+ type).
- `apps/server/src/{users,audit,forms}-routes.ts` + register in `app.ts`.
- `packages/cli/src/{users,audit,forms}.ts` (+ `index.ts`) — read commands.
- `apps/web/src/api.ts` — users/audit/forms clients + types.
- `apps/web/src/pages/{Users,Audit,Forms,FormCapture}.tsx` (+ dialogs).
- `apps/web/src/shell/AppShell.tsx` (nav), `apps/web/src/App.tsx` (routes).
- `e2e/tests/{users,audit,forms}.spec.ts`.
```
