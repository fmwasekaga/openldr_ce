# In-App Documentation Step-by-Step Overhaul Design

**Date:** 2026-06-25  
**Status:** Approved for specification review  
**Scope:** English-first documentation for the current OpenLDR CE web interface

## Goal

Turn the in-app documentation into a complete, task-oriented manual for both regular users and advanced users of the OpenLDR CE web interface.

The documentation must teach users how to complete real tasks through numbered steps, focused screenshots, expected results, troubleshooting guidance, and advanced web-usage sections. It must cover every visible web area in scope without making installation, deployment, CLI, API, or plugin-development material part of the in-app manual.

DHIS2 is excluded at the product-context level: do not add, refresh, link to, or retain DHIS2 guides or DHIS2 documentation screenshots in the in-app documentation set.

## Decisions

1. Use a **progressive task-guide** structure rather than a reference-manual or role-separated structure.
2. Cover every current web section in scope: Start Here, Dashboard, Reports, Workflows, Forms, Terminology, Users and roles, Audit, Settings, Connectors, and Marketplace.
3. Lead each guide with common tasks and follow them with an **Advanced web usage** section.
4. Write and maintain the overhaul in English first.
5. Use realistic seeded demo data and actual successful states in screenshots.
6. Explain empty, loading, permission-denied, and error states in text; capture them only when a screenshot materially improves understanding.
7. Add an **Advanced Docs — Coming soon** placeholder for a future separate documentation web app.
8. Keep the current two-panel documentation experience, search, deep links, screenshot lightbox, and export features.
9. Remove DHIS2 from the in-app docs registry, navigation, content relationships, search corpus, and screenshot capture manifest. Product routes are not changed by this documentation project.

## Audience

The primary audience is people who can already open and sign in to the OpenLDR CE web app:

- Regular users completing day-to-day laboratory and reporting tasks.
- Lab managers configuring and monitoring web-based workflows.
- Administrators managing users, connectors, marketplace artifacts, terminology, and audit activity through the web interface.
- Experienced users who want deeper web-interface techniques without needing deployment, CLI, API, or developer documentation.

The in-app docs do not teach users how to install or deploy OpenLDR CE. A person who cannot access the app would not be able to use these docs, so those subjects belong in the future advanced documentation web app.

## Information Architecture

Replace the current flat nine-page navigation with grouped, task-oriented documentation.

### Start Here

- Welcome to OpenLDR CE.
- Understand the main navigation.
- Understand which features depend on a role.
- Complete a short first-use path using the web interface.
- Learn how to use documentation search, screenshots, and related-guide links.

The landing page must not contain a screenshot of the documentation page itself.

### Dashboard

- Read the current dashboard.
- Switch dashboards.
- Apply filters.
- Enter edit mode.
- Add and configure a widget.
- Move, resize, edit, and remove widgets.
- Advanced web usage: dashboard variables, query modes, and workflow-published datasets where available.

### Reports

- Find and open a report.
- Set report parameters.
- Interpret report output.
- Export supported formats.
- Review run history.
- Create, edit, trigger, and inspect report schedules where the current UI exposes those actions.
- Advanced web usage: parameter combinations, schedule management, and diagnosing empty results.

### Workflows

- Understand the workflow list.
- Create a workflow.
- Add, configure, connect, and remove nodes.
- Save and run a workflow.
- Read node and run status.
- Inspect run history and output datasets.
- Duplicate, import, export, and delete workflows.
- Configure manual, scheduled, webhook, and ingest triggers that are currently available.
- Advanced web usage: source/sink composition, branching, reusable datasets, failure investigation, and safe retries.

### Forms

- Understand the forms list and form states.
- Create a form.
- Add, configure, reorder, and remove fields.
- Preview, save, and publish a form.
- Capture and submit data.
- Open and continue existing form work where supported.
- Manage form lifecycle actions exposed by the UI.
- Advanced web usage: validation, conditional behavior, version/lifecycle implications, and marketplace form flows.

### Terminology

- Browse code systems.
- Search and inspect terms.
- Import terms through the web interface.
- Import and manage ValueSets.
- Browse ontology indexes where available.
- Understand validation, status, and common import failures.
- Advanced web usage: choosing import formats, avoiding duplicate concepts, and distinguishing terms, ValueSets, and ontology indexes.

### Users and Roles

- Understand roles and feature visibility.
- Create or invite a user through the available UI.
- Change roles and account state.
- Perform supported identity actions.
- Diagnose why a user cannot see or use a feature.
- Advanced web usage: least-privilege role assignment and identity-provider constraints visible in the web app.

### Audit

- Browse audit events.
- Filter and inspect event details.
- Interpret actor, action, target, and timestamp information.
- Use audit evidence to investigate a user-visible change.
- Advanced web usage: combining filters and tracing a multi-step action across events.

### Settings

- Understand the settings navigation and administrator-only access.
- Explain which settings belong to connectors and marketplace management.
- Link to focused task guides rather than duplicating their procedures.

### Connectors

- View configured connectors.
- Create a connector.
- Enter and save configuration safely.
- Test a connection.
- Enable, disable, edit, and remove a connector where supported.
- Understand masked secrets and why saved credentials cannot be read back.
- Advanced web usage: connector capability differences, failure diagnosis, and safe credential rotation.

### Marketplace

- Browse installed and available artifacts.
- Inspect artifact details and versions.
- Install, update, enable, disable, and remove supported artifacts.
- Configure remote registries where exposed.
- Understand form, workflow, connector, plugin, and UI artifact differences.
- Advanced web usage: version selection, compatibility/capabilities, remote registries, and diagnosing installation failures.

### Advanced Docs — Coming Soon

Add a clearly marked placeholder page or navigation item explaining that a separate advanced documentation web app is planned for:

- Installation and deployment.
- Environment and infrastructure configuration.
- CLI reference.
- HTTP API reference.
- Plugin and extension development.
- Operator troubleshooting.

The placeholder must not pretend that the separate app exists, and it must not use a dead external link. It should briefly explain the future scope and point users back to current web-interface guides.

## Guide Template

Every substantive guide follows the same structure:

1. **Outcome** — one or two sentences stating what the user will accomplish.
2. **Before you begin** — required role, prerequisite data/state, and any feature dependency.
3. **Estimated time and difficulty** — short metadata for orientation.
4. **Steps** — numbered actions using the exact current UI labels.
5. **Focused screenshots** — placed immediately after the step or small group of steps they illustrate.
6. **Expected result** — the visible state that confirms success.
7. **Troubleshooting** — common empty, loading, permission, validation, and failure states.
8. **Advanced web usage** — deeper techniques limited to the web interface.
9. **Related guides** — explicit next or supporting tasks.

Short overview pages may omit unnecessary sections, but task guides must include outcome, prerequisites, steps, expected result, troubleshooting, and related guides.

## Documentation Metadata and Registry

Extend the documentation registry so navigation and rendering are driven by structured metadata rather than only a flat slug array.

Each guide record contains:

- `slug`
- `title`
- `group`
- `summary`
- `audience`
- `requiredRoles`
- `estimatedMinutes`
- `difficulty`
- `relatedSlugs`
- `screenshotNames`
- `status` (`published` or `coming-soon`)

The registry remains the authoritative source for navigation order and required English pages. It must support locale fallback, but English is the only language required for this overhaul.

For new or substantially rewritten guides, absent French and Portuguese files must resolve to the English page through the existing per-page fallback mechanism. Stale translated copies must not silently override newly rewritten English content. Existing translations may remain only for pages whose meaning and procedures remain accurate.

## Navigation and Reading Experience

Keep the current two-panel docs layout:

- Persistent documentation sidebar.
- Main content panel.
- Deep links at `/docs/:slug`.
- Sidebar collapse control.
- Search.
- Screenshot lightbox.
- Current-page and all-docs export.

Improve it with:

- Grouped sidebar headings matching the information architecture.
- A task-oriented Start Here landing page.
- Visible metadata near the guide introduction.
- Previous and next guide navigation.
- Related-guide links at the end.
- A visually distinct coming-soon treatment for Advanced Docs.
- No DHIS2 navigation item or DHIS2 search result.

## Search

Search must index:

- Guide title and summary.
- Task/outcome wording.
- Headings.
- Exact web-interface labels.
- Troubleshooting terms and common error wording.
- Advanced web-usage topics.

Results should take users directly to the relevant guide. Search remains client-side and locale-aware. New guides without a translation appear through English fallback.

## Screenshot Strategy

### Principles

- Every screenshot must teach an action, state, or result.
- Do not use a screenshot of a page merely to prove that the page exists.
- Prefer focused viewport captures or deterministic crops around the relevant interface.
- Use multiple screenshots for complex flows instead of one unreadable full-page image.
- Show realistic seeded demo data and successful completed states.
- Never expose real credentials, access tokens, connector secrets, personal data, or unstable identifiers.
- Use English UI screenshots for this phase.

### Step Callouts

Screenshots used in numbered procedures should contain numbered callouts that correspond to the written steps. Callouts may be added through a deterministic post-processing step so the captured application remains unmodified.

Callouts must:

- Use a consistent visual style and position.
- Avoid covering important labels or values.
- Match the step numbers exactly.
- Remain legible in the existing thumbnail and lightbox views.

### Capture Manifest

Replace the small hard-coded screenshot list with a manifest that records:

- Output filename.
- Route.
- Guide slug.
- Purpose/state.
- Required role.
- Fixture/setup scenario.
- Theme.
- Viewport.
- Locator or crop region when applicable.
- Optional callout coordinates and labels.
- Sensitive selectors or regions to mask.

The manifest is the single source of truth for capture and docs screenshot validation.

### Fixture-Driven Capture

The current capture harness depends on seeded AMR report data even when capturing unrelated docs. Refactor docs capture so each screenshot declares the minimum fixture scenario it needs.

- Use stable, deterministic seeded records.
- Avoid requiring AMR report rows for unrelated guides.
- Reuse authentication development bypass and role-specific test contexts.
- Seed workflows, forms, users, connectors, terminology records, marketplace artifacts, reports, and audit events needed by the documented flows.
- Fail with an actionable message naming the missing fixture scenario.

Where practical, capture setup should call supported APIs or repository seed helpers rather than clicking through unrelated setup steps. Playwright still drives the documented user-facing flow and takes the final screenshots.

### Screenshot States

Capture:

- Action entry points.
- Important forms/configuration panels.
- Successful results.
- Complex builder or editor states.
- Stable advanced-use states.

Usually explain in text:

- Generic loading spinners.
- Simple empty tables.
- Repetitive permission-denied screens.
- Transient toasts.

Capture an error, empty, or permission state only when users need visual recognition to recover.

## English-First Localization Behavior

English is the source of truth for this overhaul.

- All required pages and screenshot alt text are complete in English.
- New pages may omit French and Portuguese files so registry fallback displays English.
- Substantially rewritten pages must also fall back to English unless their existing translations are updated to match the new procedures.
- The UI continues to indicate when English fallback is shown.
- Translating the expanded manual and localizing screenshots are separate future work.

## DHIS2 Exclusion

DHIS2 is removed from the in-app documentation context:

- Remove the `dhis2` slug from documentation ordering and grouped navigation.
- Remove or archive the bundled in-app DHIS2 markdown from the active registry.
- Remove `doc-dhis2.png` and DHIS2 entries from the active screenshot manifest.
- Remove related-guide links that point to DHIS2.
- Ensure docs search cannot return the retired DHIS2 guide.
- Do not add replacement DHIS2 wording elsewhere.

This project does not delete or alter DHIS2 application routes, server behavior, packages, or product configuration.

## Validation and Automated Checks

Add automated checks for:

- Every published registry entry resolves to an English page.
- Every internal docs link targets a valid published or coming-soon slug.
- Every related-guide slug exists.
- Every screenshot reference resolves.
- Every screenshot manifest output is referenced by at least one guide.
- Every guide-declared screenshot exists in the manifest.
- Screenshot filenames are unique.
- Screenshot alt text is present and descriptive.
- No active registry entry, relationship, or screenshot manifest item references DHIS2.
- New/substantially rewritten guides do not accidentally serve stale French or Portuguese content.
- Search includes new guides and excludes the retired DHIS2 guide.

Existing component and end-to-end tests must continue covering:

- Grouped sidebar navigation.
- Search.
- Deep linking.
- English fallback.
- Lightbox behavior.
- Export menu accessibility.
- Unknown slugs.

Add Playwright smoke coverage for at least one representative regular-user guide and one advanced web-usage section.

## Error Handling

- Missing published English page: fail registry tests and omit the broken entry defensively at runtime.
- Missing screenshot: render the existing unavailable placeholder, warn in development, and fail validation.
- Missing fixture scenario: fail screenshot capture before navigation with instructions naming the fixture.
- Unsupported role during capture: fail setup rather than capture a permission-denied page accidentally.
- Unknown docs slug: keep the current not-found content inside the docs layout.
- Export failure: keep the current non-blocking error status.
- Coming-soon page: render intentional explanatory content, not a not-found state.

## Implementation Boundaries

Likely areas of change:

- `apps/web/src/docs/registry.ts` and registry tests.
- `apps/web/src/pages/Docs.tsx` and docs component tests.
- `apps/web/src/docs/0.1.0/en/*.md`.
- Active French/Portuguese files where removal is needed to enable accurate fallback.
- `apps/web/src/docs/screenshots.ts` validation support.
- `apps/web/src/docs/0.1.0/screenshots/*.png`.
- `e2e/capture-docs/docs-screenshots.spec.ts`.
- New screenshot manifest, fixture helpers, and deterministic callout/crop support under `e2e/capture-docs/`.
- Docs Playwright tests.

The work should be split into implementation slices so content, fixture setup, capture tooling, and final screenshot capture remain reviewable.

## Testing and Verification

1. Run focused registry, search, docs-layout, markdown, lightbox, and export tests.
2. Run docs Playwright smoke tests.
3. Seed each screenshot fixture scenario and regenerate all manifest screenshots.
4. Visually inspect every generated image for correct state, legibility, masking, callout alignment, and absence of sensitive data.
5. Open every guide in the built app and verify steps, image placement, links, metadata, and fallback behavior.
6. Run web typecheck, tests, and build.
7. Run the broader repository verification gates required by the implementation plan.

## Acceptance Criteria

- The in-app docs cover Start Here, Dashboard, Reports, Workflows, Forms, Terminology, Users and roles, Audit, Settings, Connectors, and Marketplace.
- Each substantive guide is outcome-led and step-by-step, with troubleshooting and an Advanced web usage section.
- Screenshots are purposeful, realistic, consistently sized, safely masked, and tied to specific steps or results.
- Workflows and other previously undocumented web areas have complete guides.
- The OpenLDR overview no longer uses a screenshot of the docs page itself.
- The docs include an honest Advanced Docs — Coming soon placeholder for the future separate app.
- DHIS2 does not appear in active in-app docs navigation, search, content relationships, or screenshot capture.
- New and substantially rewritten content is correct in English and falls back to English rather than showing stale translations.
- Grouped navigation, search, deep links, lightbox, and exports continue to work.
- Automated checks catch broken pages, links, screenshot references, manifest drift, missing alt text, stale translations, and DHIS2 regressions.

## Out of Scope

- Installation and deployment instructions.
- CLI and HTTP API reference.
- Plugin or extension development.
- Infrastructure/operator runbooks.
- Building the future advanced documentation web app.
- French and Portuguese translation of the expanded manual.
- Localized screenshots.
- Changes to underlying DHIS2 product functionality or routes.
