# Marketplace Sub-project C — Form-template Install + Export — Design

**Date:** 2026-06-23
**Status:** Approved
**Parent roadmap:** `docs/superpowers/specs/2026-06-23-marketplace-roadmap-design.md`
**Depends on:** B (details page, `2667b45`) + A (remote registry: A1 `5b30b3d`, A2 `1fa1cac`).
**Topic:** Make the `form-template` artifact kind a first-class, tracked marketplace citizen —
install a signed form bundle into the forms subsystem (with update/detach + drift detection),
and export an authored form as an unsigned bundle for the off-server sign → A2 publish flow.

---

## 1. Motivation & scope decision

The roadmap's sub-project C was "non-plugin install lifecycles (forms / reports / test-definitions)."
A codebase survey established sharply different feasibility:

- **form** — install easy (`fromQuestionnaire()` → `ctx.forms.create/publish`), publish easy
  (`form_versions` already stores the FHIR Questionnaire). A real, first-class subsystem exists.
- **report** — **infeasible as designed**: reports are a *static code catalog*
  (`ReportDefinition` with a live `run()` + Zod `params`). Installing a runnable report from JSON
  would require a DB-backed custom-report engine or executing user code — a separate large project.
- **test-definition** — install is easy (ontology bulk-insert) but **OpenLDR has no `test-definition`
  entity** (only raw terminology/ontology rows); corlix's concept does not map. Thin, unnatural.

**Decision (approved): C = `form-template` only.** Reports and test-definitions are explicitly
deferred (not viable as designed). C is the one clean, shippable, corlix-parity unit.

---

## 2. Decisions locked during brainstorming

- **Install model: tracked, corlix-style.** Installed form-templates appear in the marketplace
  **Installed** tab with **Update / Detach** and **drift** detection — not a one-shot import.
- **Export output: download an unsigned bundle zip.** The browser downloads a `.zip` (`manifest.json`
  + `questionnaire.json`, unsigned, placeholder publisher); the maintainer runs `artifact sign`, stages
  it, and publishes via A2. **Signing stays off-server.**
- **Update = overwrite-with-warning.** Update re-applies the upstream questionnaire over the linked
  form (new published version), with a "this will overwrite local changes" warning when drifted.
  "Keep mine" = Detach. No merge UI (out of scope).
- **One small server zip dep** (e.g. `adm-zip`) is acceptable for building the export zip server-side.

---

## 3. Architecture

### 3.1 Tracking store + migration (`packages/db`)

New internal table `marketplace_installs` (migration `030` — next free after `029`; verify it's
still free at implementation time):

| column | type | notes |
| --- | --- | --- |
| `artifact_id` | text (PK) | stable marketplace id (e.g. `specimen-intake`) |
| `version` | text | installed bundle version |
| `kind` | text | `'form-template'` (room for future kinds) |
| `target_form_id` | text | the `form_definitions.id` this artifact created/manages |
| `payload_sha256` | text | hash of the applied questionnaire — drift baseline |
| `publisher_name` | text null | from the manifest, for display |
| `source_ref` | text null | the registry ref it was installed from |
| `installed_by` | text null | actor |
| `installed_at` / `updated_at` | timestamptz | |

`MarketplaceInstallStore` (`packages/db/src/marketplace-install-store.ts`):
`upsert(row)`, `get(artifactId)`, `list()`, `remove(artifactId)`. Tested via pg-mem like the other
internal stores.

### 3.2 Form-artifact installer (`ctx.marketplaceForms`, wired in bootstrap)

`createFormArtifactInstaller({ forms, installStore, audit })` exposing:

- `install(bundle, opts)`:
  1. `verifyBundle(bundle)` — fail-closed; refuse invalid/tampered (mirrors plugin install).
  2. parse `questionnaire.json` payload → `fromQuestionnaire(questionnaire)` → `FormSchema`.
  3. consent: if the manifest declares capabilities, require `opts.approval` with matching
     acknowledged capabilities (same contract as plugin install).
  4. if `installStore.get(artifactId)` exists → `forms.update(targetFormId, { schema, … })` +
     `forms.publish(targetFormId, { versionLabel: version })`; else
     `forms.create({ status: 'published', schema, name, versionLabel: version, … })`.
  5. `installStore.upsert({ artifactId, version, kind, targetFormId, payloadSha256, publisherName,
     sourceRef, installedBy })` where `payloadSha256 = sha256(canonical questionnaire.json)`.
  6. audit `marketplace.install` (type `form-template`).
- `detach(artifactId, opts)` → `installStore.remove` (the form itself is kept); audit
  `marketplace.detach`.
- `drift(row)` → fetch the linked form's current published questionnaire, hash it, compare to
  `row.payload_sha256`; return `{ drifted: boolean }`.

The installer lives in a small module (bootstrap or a tiny package) and is added to `AppContext` as
`ctx.marketplaceForms`. It depends only on `ctx.forms`, the install store, and audit — independently
testable.

### 3.3 Install dispatch + merged Installed view (`apps/server/src/marketplace-routes.ts`)

- **`POST /install`** branches by `manifest.type`: `plugin` → `ctx.plugins.install` (unchanged);
  `form-template` → `ctx.marketplaceForms.install`. Both go through the same source `getBundle(ref)`
  + consent payload.
- **`GET /installed`** returns plugins (as today) **plus** form installs from
  `MarketplaceInstallStore`, mapped into the existing `InstalledArtifact` shape with
  `type: 'form-template'`, `drifted: boolean`, and `targetFormId`. (`active`/`enabled` are `true` and
  not user-toggleable for forms.)
- **`POST /:artifactId/detach`** (`lab_admin`) → `ctx.marketplaceForms.detach`.
- Update is just `POST /install` again with the newer version (the installer's update path).

### 3.4 Export endpoint (`apps/server/src/forms-routes.ts`)

`GET /api/forms/:id/export-bundle` (`lab_admin`): read the form's latest published `questionnaire`
from `form_versions`; build an **unsigned bundle**:
- `manifest.json`: `{ schemaVersion:1, type:'form-template', id, version, description, license,
  compatibility:{ceVersion:'*'}, capabilities:[], payload:{ kind:'form-template',
  questionnaireSha256 } }` — `id` derived from the form (slug of name), `version` from the form's
  versionLabel (default `1.0.0`), **no `publisher` / no `signature`** (the maintainer's
  `artifact sign` fills these).
- `questionnaire.json`: the stored FHIR Questionnaire bytes; `questionnaireSha256 = sha256(those
  bytes)`.
Zip the two files (new server dep `adm-zip`, in-memory) and stream as
`application/zip` with `Content-Disposition: attachment; filename="<id>-<version>.zip"`.

### 3.5 Web (`apps/web/src/pages/settings/marketplace/` + forms page)

- **Browse install**: drop the plugin-only gate for `form-template` so its card/detail Install works
  (consent dialog already generic).
- **Installed detail — kind-aware actions** (`PackageDetail`): for `form-template` show **Update**
  (when a newer registry version exists), **Detach** (ConfirmDialog), **Open in Form Builder**
  (navigate to `/forms/:targetFormId`), and a **"Modified locally"** badge when `drifted`. Plugin
  actions (enable/disable/rollback/remove) unchanged. Update shows an overwrite warning when drifted.
- **Forms page**: an "Export as marketplace bundle" action (per published form) → hits
  `GET /api/forms/:id/export-bundle` and downloads the zip. A short in-app/doc note describes the
  sign → stage → publish handoff.
- `api.ts`: `detachArtifact(artifactId)`, `exportFormBundle(id)` (triggers download), and the
  `installed` type gains `drifted?`/`targetFormId?`.

---

## 4. Data flow

**Install (remote or local):** Browse a `form-template` → detail `getBundle(ref)` → Install → consent
→ `POST /install` → dispatch → `marketplaceForms.install` → `fromQuestionnaire` →
`forms.create/publish` → record install row. It now shows in **Installed** (with drift state) and in
the Forms list.

**Update:** Installed detail shows Update when registry version > installed version → `POST /install`
again → installer's update path re-applies upstream → bumps the install row.

**Detach:** Installed detail → Detach → `POST /:artifactId/detach` → remove the row; the form stays.

**Export → publish:** Forms page → Export as bundle → unsigned `.zip` downloads → maintainer
`artifact sign` → stage in `MARKETPLACE_REGISTRY_DIR` → A2 **Publish to GitHub** → PR → merge →
others install over HTTPS (A1).

---

## 5. Error handling

- Install: `verifyBundle` invalid → refuse (fail-closed, mirrors plugin install); `fromQuestionnaire`
  parse failure → 400 with message; consent mismatch → reject (existing contract).
- Detach: missing install row → 404.
- Export: form not found / not published (no `form_versions` row) → 404 with a clear message.
- Drift computation failure (form deleted out from under the row) → treat as not-drifted + surface a
  stale-link indicator; never throw into the Installed list.

---

## 6. Testing

- **`MarketplaceInstallStore`** (pg-mem): upsert/get/list/remove round-trip.
- **`createFormArtifactInstaller`**: install creates a form + records the row (sha set); a second
  install of a higher version updates the same form (no duplicate row); `drift()` true after the
  linked form's questionnaire changes; invalid bundle refused.
- **Routes**: `/install` dispatches form-template to the forms installer; `/installed` merges
  plugin + form rows with `drifted`/`targetFormId`; `/:artifactId/detach` removes the row;
  `form-template` install no longer blocked by the plugin-only gate.
- **Export route**: returns a zip whose `manifest.json` has `type:'form-template'` +
  `payload.questionnaireSha256` matching `sha256(questionnaire.json)`.
- **Web**: form-template install enabled; Installed detail shows Update/Detach/Open + drift badge for
  a form, enable/disable/rollback/remove for a plugin; Forms export action triggers the download.

---

## 7. Non-goals (deferred)

- Report-template and test-definition install/publish (infeasible/awkward as designed — see §1).
- Merge-on-update UI (overwrite-with-warning only).
- In-app signing (stays off-server; export is unsigned).
- Auto update-scanning (Update shows when the Browse/registry version exceeds the installed version,
  computed on load — no background poller).

---

## 8. Implementation note (plan sub-phasing)

Plan in two phases: **C1** — tracking store + migration, `createFormArtifactInstaller`, install
dispatch, merged Installed view, detach, drift, kind-aware Installed UI (the substance) — then
**C2** — the export endpoint + Forms export action. C1 is independently shippable (install/track/
manage form-templates); C2 adds the authoring→publish on-ramp.
