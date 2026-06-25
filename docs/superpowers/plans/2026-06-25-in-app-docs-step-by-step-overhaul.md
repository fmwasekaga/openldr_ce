# In-App Documentation Step-by-Step Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the compact in-app docs with a complete English-first, step-by-step manual for every supported web area, backed by deterministic Playwright screenshots and automated documentation integrity checks.

**Architecture:** The web app keeps its existing bundled-markdown docs system, but `registry.ts` gains structured guide metadata and grouped navigation. A versioned JSON screenshot manifest becomes the shared contract between markdown validation and the Playwright capture project; deterministic fixture helpers prepare realistic UI states, and capture helpers add masks, crops, and numbered callouts without changing production UI code.

**Tech Stack:** React 18, TypeScript, Vite `import.meta.glob`, react-markdown, Fuse.js, Vitest/Testing Library, Playwright, Fastify HTTP APIs, pnpm/Turbo.

---

## Scope and file map

The implementation is one cohesive docs subsystem with four reviewable slices:

1. **Registry/UI foundation** — metadata, grouping, search, guide navigation, locale fallback, integrity checks.
2. **English content** — eleven web-interface guides plus the advanced-docs coming-soon page; retire DHIS2 and operator-oriented pages.
3. **Screenshot system** — one manifest, deterministic fixtures, masks/crops/callouts, and committed PNGs.
4. **Verification** — component tests, docs e2e, capture validation, visual inspection, and monorepo gates.

Files created:

- `apps/web/src/docs/validation.ts` — parses internal links and image references and validates registry/content/manifest consistency.
- `apps/web/src/docs/validation.test.ts` — integrity and DHIS2-exclusion tests.
- `apps/web/src/docs/0.1.0/screenshot-manifest.json` — shared screenshot source of truth.
- `apps/web/src/docs/0.1.0/en/start-here.md`
- `apps/web/src/docs/0.1.0/en/workflows.md`
- `apps/web/src/docs/0.1.0/en/forms.md`
- `apps/web/src/docs/0.1.0/en/users.md`
- `apps/web/src/docs/0.1.0/en/audit.md`
- `apps/web/src/docs/0.1.0/en/settings.md`
- `apps/web/src/docs/0.1.0/en/connectors.md`
- `apps/web/src/docs/0.1.0/en/marketplace.md`
- `apps/web/src/docs/0.1.0/en/advanced-docs.md`
- `e2e/capture-docs/manifest.ts` — typed loader for the JSON manifest.
- `e2e/capture-docs/fixtures.ts` — idempotent API-driven documentation fixtures.
- `e2e/capture-docs/capture-helpers.ts` — theme, readiness, crop, mask, and callout helpers.
- `e2e/capture-docs/capture-helpers.spec.ts` — browser-level helper smoke tests.
- `e2e/capture-docs/manifest.test.ts` — Node test for manifest schema and exclusions.

Files substantially modified:

- `apps/web/src/docs/registry.ts`
- `apps/web/src/docs/registry.test.ts`
- `apps/web/src/docs/search.ts`
- `apps/web/src/docs/search.test.ts`
- `apps/web/src/pages/Docs.tsx`
- `apps/web/src/pages/Docs.test.tsx`
- `apps/web/src/docs/0.1.0/en/dashboard.md`
- `apps/web/src/docs/0.1.0/en/reports.md`
- `apps/web/src/docs/0.1.0/en/terminology.md`
- `apps/web/src/docs/screenshots.test.ts`
- `e2e/capture-docs/docs-screenshots.spec.ts`
- `e2e/global-setup.ts`
- `e2e/tests/docs.spec.ts`
- `package.json`
- `e2e/package.json`

Files removed from the active bundled corpus:

- `apps/web/src/docs/0.1.0/en/overview.md`
- `apps/web/src/docs/0.1.0/en/getting-started.md`
- `apps/web/src/docs/0.1.0/en/ingestion.md`
- `apps/web/src/docs/0.1.0/en/dhis2.md`
- `apps/web/src/docs/0.1.0/en/external-db.md`
- `apps/web/src/docs/0.1.0/en/cli.md`
- All files under `apps/web/src/docs/0.1.0/fr/`
- All files under `apps/web/src/docs/0.1.0/pt/`
- `apps/web/src/docs/0.1.0/screenshots/docs.png`
- `apps/web/src/docs/0.1.0/screenshots/doc-dhis2.png`
- Old screenshot files superseded by the new manifest.

Removing the current French and Portuguese files is intentional: every retained page is substantially rewritten, so locale requests must use the existing English fallback rather than serve stale procedures.

### Task 1: Structured guide registry and English fallback

**Files:**

- Modify: `apps/web/src/docs/registry.ts`
- Modify: `apps/web/src/docs/registry.test.ts`
- Delete: `apps/web/src/docs/0.1.0/fr/*.md`
- Delete: `apps/web/src/docs/0.1.0/pt/*.md`

- [ ] **Step 1: Replace the old registry expectations with failing metadata/grouping tests**

Add tests that assert:

```ts
expect(DOC_GROUPS.map((group) => group.id)).toEqual([
  'start',
  'daily-work',
  'data-design',
  'administration',
  'more',
]);

expect(DOC_GUIDES.map((guide) => guide.slug)).toEqual([
  'start-here',
  'dashboard',
  'reports',
  'workflows',
  'forms',
  'terminology',
  'users',
  'audit',
  'settings',
  'connectors',
  'marketplace',
  'advanced-docs',
]);

expect(resolve('en', 'dashboard')).toMatchObject({
  slug: 'dashboard',
  group: 'daily-work',
  requiredRoles: [],
  difficulty: 'beginner',
  status: 'published',
  localeUsed: 'en',
});

expect(resolve('fr', 'dashboard')).toMatchObject({
  slug: 'dashboard',
  localeUsed: 'en',
});

expect(resolve('en', 'dhis2')).toBeNull();
expect(list('en').some((section) => section.slug === 'dhis2')).toBe(false);
```

Also assert that every `relatedSlugs` entry names a slug present in `DOC_GUIDES` and every published guide has a non-empty summary, audience, estimated time, and difficulty. Do not require every markdown file yet; the corpus-completeness assertion is added after Tasks 5–7 author the files.

- [ ] **Step 2: Run the focused registry test and confirm failure**

Run: `pnpm -C apps/web test registry`

Expected: FAIL because `DOC_GROUPS`, `DOC_GUIDES`, and metadata fields do not exist and the old `dhis2` slug still resolves.

- [ ] **Step 3: Implement the structured registry**

In `registry.ts`, define and export:

```ts
export type DocGroupId = 'start' | 'daily-work' | 'data-design' | 'administration' | 'more';
export type DocAudience = 'all-users' | 'lab-users' | 'lab-managers' | 'administrators';
export type DocDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type DocStatus = 'published' | 'coming-soon';

export interface DocGroup {
  id: DocGroupId;
  title: string;
}

export interface DocGuide {
  slug: string;
  title: string;
  group: DocGroupId;
  summary: string;
  audience: DocAudience[];
  requiredRoles: string[];
  estimatedMinutes: number;
  difficulty: DocDifficulty;
  relatedSlugs: string[];
  screenshotNames: string[];
  status: DocStatus;
}

export interface DocSection extends DocGuide {
  content: string;
  localeUsed: Locale;
}
```

Add `DOC_GROUPS` in the order tested above. Add `DOC_GUIDES` with these exact guide relationships:

- `start-here` → `dashboard`, `reports`, `advanced-docs`
- `dashboard` → `reports`, `workflows`
- `reports` → `dashboard`, `audit`
- `workflows` → `reports`, `connectors`, `audit`
- `forms` → `terminology`, `marketplace`
- `terminology` → `forms`, `audit`
- `users` → `audit`, `settings`
- `audit` → `users`, `workflows`
- `settings` → `connectors`, `marketplace`
- `connectors` → `settings`, `workflows`, `marketplace`
- `marketplace` → `settings`, `connectors`, `forms`
- `advanced-docs` → `start-here`, `settings`

Set `start-here` as the first guide. Implement `resolve()` by looking up guide metadata first, then localized markdown, then English markdown. Set the resolved title to `firstHeading(content) || guide.title` so future translated H1s can localize navigation without changing metadata. Return `null` when the slug is absent from `DOC_GUIDES`, even if an orphan markdown file exists.

Keep `LOCALES = ['en', 'fr', 'pt']`; fallback behavior remains per page.

- [ ] **Step 4: Remove all stale French and Portuguese markdown**

Delete the current `fr/*.md` and `pt/*.md` files. Do not add replacement translations in this workstream.

- [ ] **Step 5: Run registry tests**

Run: `pnpm -C apps/web test registry`

Expected: PASS. This task tests metadata, existing Dashboard resolution, English fallback after translation removal, and DHIS2 exclusion without requiring the not-yet-authored pages.

- [ ] **Step 6: Commit the registry foundation**

```bash
git add apps/web/src/docs/registry.ts apps/web/src/docs/registry.test.ts apps/web/src/docs/0.1.0/fr apps/web/src/docs/0.1.0/pt
git commit -m "feat(docs): add structured guide registry"
```

### Task 2: Grouped docs layout, guide metadata, and guide-to-guide navigation

**Files:**

- Modify: `apps/web/src/pages/Docs.tsx`
- Modify: `apps/web/src/pages/Docs.test.tsx`

- [ ] **Step 1: Write failing layout tests**

Mock `DOC_GROUPS`, `DOC_GUIDES`, `list()`, and `resolve()` with a complete synthetic corpus in this component test so the layout can be developed before the real markdown-writing tasks. Add tests that verify:

```ts
expect(within(nav).getByText('Start here')).toBeInTheDocument();
expect(within(nav).getByText('Daily work')).toBeInTheDocument();
expect(within(nav).getByText('Data and design')).toBeInTheDocument();
expect(within(nav).getByText('Administration')).toBeInTheDocument();
expect(within(nav).getByText('More')).toBeInTheDocument();

expect(screen.getByText('About 8 minutes')).toBeInTheDocument();
expect(screen.getByText('Beginner')).toBeInTheDocument();

expect(screen.getByRole('link', { name: /Next: Dashboard/i })).toHaveAttribute(
  'href',
  '/docs/dashboard',
);

expect(screen.getByRole('heading', { level: 1, name: 'Advanced Docs — Coming soon' }))
  .toBeInTheDocument();

expect(within(nav).queryByText(/DHIS2/i)).toBeNull();
```

Change the mocked default `/docs` expectation from `OpenLDR Community Edition` to `Start Here`.

- [ ] **Step 2: Run the focused layout test and confirm failure**

Run: `pnpm -C apps/web test Docs.test`

Expected: FAIL because the sidebar is flat, `/docs` defaults to `overview`, and metadata/previous-next controls do not exist.

- [ ] **Step 3: Implement grouped navigation**

Update `Docs.tsx` to:

- Default to the first resolved section (`sections[0]?.slug`) and fall back to `start-here` only when no section resolves. Once Task 5 adds `start-here.md`, the real default is Start Here without an interim not-found page.
- Build sidebar groups from `DOC_GROUPS` and resolved sections.
- Render a small group heading before each group’s links.
- Preserve search behavior; while searching, render one flat “Search results” group.
- Render `Coming soon` beside `advanced-docs`.
- Never render `dhis2`.

Use the existing route shape `/docs/:slug`; no `App.tsx` route change is required.

- [ ] **Step 4: Add the metadata strip**

Directly above `<DocMarkdown>`, render:

- Audience labels derived from `section.audience`.
- Required roles, or `No special role`.
- `About N minutes`.
- Capitalized difficulty.

Use semantic text and existing `Badge` components; do not add another design-system dependency.

- [ ] **Step 5: Add previous, next, and related-guide navigation**

Derive previous/next from resolved `DOC_GUIDES` order. At the bottom of the content panel:

- Render previous and next links when present.
- Render `Related guides` using `section.relatedSlugs`.
- Exclude the current slug and unresolved slugs.

- [ ] **Step 6: Run layout tests**

Run: `pnpm -C apps/web test Docs.test`

Expected: PASS.

- [ ] **Step 7: Commit the docs reading experience**

```bash
git add apps/web/src/pages/Docs.tsx apps/web/src/pages/Docs.test.tsx
git commit -m "feat(docs): group guides and add reading navigation"
```

### Task 3: Search task outcomes, UI labels, and troubleshooting language

**Files:**

- Modify: `apps/web/src/docs/search.ts`
- Modify: `apps/web/src/docs/search.test.ts`

- [ ] **Step 1: Write failing metadata-aware search tests**

Use synthetic `DocSection` records with complete metadata and assert:

```ts
expect(searchDocs(buildIndex(sections), 'permission denied')[0].slug).toBe('users');
expect(searchDocs(buildIndex(sections), 'create workflow')[0].slug).toBe('workflows');
expect(searchDocs(buildIndex(sections), 'lab_admin')[0].slug).toBe('users');
expect(searchDocs(buildIndex(sections), 'dhis2')).toEqual([]);
```

The users guide body should contain “permission denied”; the workflows summary should contain “Create and run workflows”; the users `requiredRoles` should contain `lab_admin`.

- [ ] **Step 2: Run search tests and confirm failure**

Run: `pnpm -C apps/web test search`

Expected: FAIL because the index only includes title, headings, and body.

- [ ] **Step 3: Extend `DocRecord` and Fuse weights**

Add:

```ts
export interface DocRecord {
  slug: string;
  title: string;
  summary: string;
  audience: string;
  roles: string;
  headings: string;
  body: string;
}
```

Populate metadata in `toRecord()`. Use Fuse weights:

- title `0.30`
- summary `0.20`
- headings `0.20`
- body `0.20`
- roles `0.05`
- audience `0.05`

Keep the existing score cutoff and snippet behavior.

- [ ] **Step 4: Run search tests**

Run: `pnpm -C apps/web test search`

Expected: PASS.

- [ ] **Step 5: Commit search improvements**

```bash
git add apps/web/src/docs/search.ts apps/web/src/docs/search.test.ts
git commit -m "feat(docs): index tasks roles and troubleshooting"
```

### Task 4: Shared screenshot manifest and documentation integrity validation

**Files:**

- Create: `apps/web/src/docs/0.1.0/screenshot-manifest.json`
- Create: `apps/web/src/docs/validation.ts`
- Create: `apps/web/src/docs/validation.test.ts`
- Modify: `apps/web/src/docs/screenshots.test.ts`

- [ ] **Step 1: Create a failing integrity test**

Create a synthetic valid corpus and assert `validateDocs(sections, guides, manifest, availableScreenshotNames)` returns no errors. Add focused synthetic negative tests for:

- Broken internal `/docs/<slug>` links.
- Unknown related slugs.
- Missing image alt text.
- Markdown image not declared by the guide.
- Guide screenshot absent from the manifest.
- Manifest output unreferenced by all guides.
- Duplicate output names.
- Any active slug, link target, output name, route, purpose, or guide containing `dhis2` case-insensitively.

- [ ] **Step 2: Run the validation test and confirm failure**

Run: `pnpm -C apps/web test validation`

Expected: FAIL because the validator and manifest do not exist.

- [ ] **Step 3: Add the shared JSON manifest schema**

Create `screenshot-manifest.json` with this object shape:

```json
{
  "version": 1,
  "viewport": { "width": 1440, "height": 900 },
  "shots": []
}
```

Each eventual shot contains:

- `name`
- `guide`
- `route`
- `purpose`
- `fixture`
- `theme`
- `ready`
- optional `crop`
- optional `mask`
- optional `callouts`

The final entries are added in Task 8.

- [ ] **Step 4: Implement pure validation helpers**

Export:

```ts
export interface DocsValidationError {
  code: string;
  message: string;
  slug?: string;
}

export interface ScreenshotManifestShot {
  name: string;
  guide: string;
  route: string;
  purpose: string;
  fixture: string;
  theme: 'dark' | 'light';
  ready: { kind: 'selector' | 'text'; value: string };
  steps: Array<
    | { action: 'click'; role: string; name: string }
    | { action: 'clickTestId'; testId: string }
    | { action: 'fill'; label: string; value: string }
    | { action: 'selectText'; text: string }
    | { action: 'waitForText'; text: string }
  >;
  crop?: string;
  mask?: string[];
  callouts?: Array<{ number: number; selector: string; offsetX?: number; offsetY?: number }>;
}

export interface ScreenshotManifest {
  version: number;
  viewport: { width: number; height: number };
  shots: ScreenshotManifestShot[];
}

export function markdownLinks(markdown: string): string[];
export function markdownImages(markdown: string): Array<{ alt: string; src: string }>;
export function validateDocs(
  sections: DocSection[],
  guides: DocGuide[],
  manifest: ScreenshotManifest,
  availableScreenshotNames: string[],
): DocsValidationError[];
```

Only treat `/docs/<slug>` and relative docs links as internal docs links. Ignore `http`, `https`, and hash-only anchors.

- [ ] **Step 5: Connect screenshot resolver tests to manifest outputs**

Keep `makeResolver()` unit coverage and add an assertion that every manifest `name` is a bare `.png` basename and unique.

- [ ] **Step 6: Run validation and screenshot tests**

Run: `pnpm -C apps/web test validation screenshots`

Expected: PASS for parser behavior and synthetic positive/negative fixtures. Add the real-corpus zero-error assertion only in Task 11 after content, manifest, and PNGs exist.

- [ ] **Step 7: Commit the validation foundation**

```bash
git add apps/web/src/docs/0.1.0/screenshot-manifest.json apps/web/src/docs/validation.ts apps/web/src/docs/validation.test.ts apps/web/src/docs/screenshots.test.ts
git commit -m "test(docs): add manifest-backed integrity validation"
```

### Task 5: Author Start Here, Dashboard, and Reports guides

**Files:**

- Create: `apps/web/src/docs/0.1.0/en/start-here.md`
- Modify: `apps/web/src/docs/0.1.0/en/dashboard.md`
- Modify: `apps/web/src/docs/0.1.0/en/reports.md`
- Delete: `apps/web/src/docs/0.1.0/en/overview.md`
- Delete: `apps/web/src/docs/0.1.0/en/getting-started.md`
- Delete: `apps/web/src/docs/0.1.0/en/ingestion.md`
- Delete: `apps/web/src/docs/0.1.0/en/external-db.md`
- Delete: `apps/web/src/docs/0.1.0/en/cli.md`
- Delete: `apps/web/src/docs/0.1.0/en/dhis2.md`

- [ ] **Step 1: Add failing content-structure assertions**

In `validation.test.ts`, add a helper that accepts explicit sections and assert each section supplied by this task contains these headings:

```text
## Outcome
## Before you begin
## Steps
## Expected result
## Troubleshooting
## Advanced web usage
## Related guides
```

Allow `settings` and `advanced-docs` to use their shorter structures defined in Tasks 7.

- [ ] **Step 2: Write `start-here.md`**

Use H1 `# Start Here`. Cover:

- What the in-app docs cover.
- Main app navigation and role visibility.
- A first-use path: open Dashboard → open Reports → search Docs.
- How numbered screenshots, lightbox, search, and related guides work.
- Why installation/deployment/CLI/API/plugin topics are not in this manual.
- Link to `/docs/advanced-docs`.

Reference `start-here-navigation.png`. Do not reference `docs.png` or show the docs page inside itself.

- [ ] **Step 3: Rewrite `dashboard.md` as a procedure**

Use exact UI labels `Dashboard`, `Dashboard menu`, `Edit`, `Add widget`, `Editor menu`, `Save`, and `Done`.

Use:

- `dashboard-overview.png` after opening and reading a dashboard.
- `dashboard-edit-widget.png` after entering edit mode and opening the widget editor.

Troubleshooting must cover no dashboard, empty widget, missing SQL mode, and a query error. Advanced usage must cover dashboard variables, Builder versus SQL mode, and workflow-published datasets without mentioning CLI or environment-variable setup.

- [ ] **Step 4: Rewrite `reports.md` as a procedure**

Use exact UI actions visible in `Reports.tsx`: select a report, set parameters, run, switch between Document and Spreadsheet, open History, and open Schedules when the role allows it.

Use:

- `reports-run-result.png`
- `reports-history-schedules.png`

Troubleshooting must cover disabled Run, empty result, permission-limited schedules, and export failure. Advanced usage must cover pinned reports, reusing history parameters, document/spreadsheet differences, and schedule review.

- [ ] **Step 5: Remove retired English pages**

Delete the six retired/operator pages listed above, including DHIS2. Do not move their content into another active guide.

- [ ] **Step 6: Run registry and validation tests**

Run: `pnpm -C apps/web test validation -t "start dashboard reports"`

Expected: PASS for the three authored guides.

- [ ] **Step 7: Commit the first content slice**

```bash
git add apps/web/src/docs/0.1.0/en
git commit -m "docs(web): add start dashboard and reports guides"
```

### Task 6: Author Workflows, Forms, and Terminology guides

**Files:**

- Create: `apps/web/src/docs/0.1.0/en/workflows.md`
- Create: `apps/web/src/docs/0.1.0/en/forms.md`
- Modify: `apps/web/src/docs/0.1.0/en/terminology.md`

- [ ] **Step 1: Write `workflows.md`**

Use H1 `# Workflows`. Cover:

- Required role: Lab Admin or Lab Manager.
- Workflow list search and row actions.
- New workflow creation.
- Adding, connecting, selecting, configuring, and removing nodes.
- Saving and running.
- Reading node states and run history.
- Duplicate, import, export, and delete.
- Manual, schedule, webhook, and ingest triggers that are visible in the builder.

Use:

- `workflows-list.png`
- `workflow-builder.png`
- `workflow-run-history.png`

Advanced usage must cover source/sink composition, branching, materialized datasets, retry safety, and failure investigation. Do not document the DHIS2 push node.

- [ ] **Step 2: Write `forms.md`**

Use H1 `# Forms`. Cover:

- Forms list and Draft/Published/Archived states.
- `Form actions` → `New`.
- Form name, version label, FHIR version/resource type, and target pages.
- Adding, configuring, reordering, and removing fields.
- Preview, Save draft, Publish, Compare.
- View/Run and submission.
- Duplicate, archive, export, marketplace bundle export, and delete.

Use:

- `forms-list.png`
- `form-builder.png`
- `form-capture.png`

Advanced usage must cover validation, conditional visibility, terminology bindings, repeatable fields, target pages, and lifecycle/version implications.

- [ ] **Step 3: Rewrite `terminology.md`**

Keep the guide strictly web-based. Cover:

- Browsing publishers/code systems.
- Searching and inspecting terms.
- `Actions` → term import.
- ValueSet import and management.
- Ontology browsing.
- Distinguishing terms, ValueSets, and ontology indexes.

Use:

- `terminology-overview.png`
- `terminology-import.png`

Troubleshooting must cover unsupported file shape, missing code/display name, licensing/source availability, and empty ontology indexes.

- [ ] **Step 4: Run content validation**

Run: `pnpm -C apps/web test validation -t "workflows forms terminology"`

Expected: PASS for the three authored guides.

- [ ] **Step 5: Commit the data-design guides**

```bash
git add apps/web/src/docs/0.1.0/en/workflows.md apps/web/src/docs/0.1.0/en/forms.md apps/web/src/docs/0.1.0/en/terminology.md
git commit -m "docs(web): add workflows forms and terminology guides"
```

### Task 7: Author Users, Audit, Settings, Connectors, Marketplace, and Advanced Docs

**Files:**

- Create: `apps/web/src/docs/0.1.0/en/users.md`
- Create: `apps/web/src/docs/0.1.0/en/audit.md`
- Create: `apps/web/src/docs/0.1.0/en/settings.md`
- Create: `apps/web/src/docs/0.1.0/en/connectors.md`
- Create: `apps/web/src/docs/0.1.0/en/marketplace.md`
- Create: `apps/web/src/docs/0.1.0/en/advanced-docs.md`

- [ ] **Step 1: Write `users.md`**

Cover user list search, creating a user, editing profile fields, assigning roles, enabling/disabling, reset actions, and feature visibility. Use:

- `users-list.png`
- `user-edit-roles.png`

Advanced usage must explain least privilege and the difference between local profile data and identity-provider-controlled actions visible in the UI.

- [ ] **Step 2: Write `audit.md`**

Cover opening Audit, applying filters, inspecting an event, interpreting actor/action/entity/time, copying identifiers, and tracing a change. Use:

- `audit-filter.png`
- `audit-event-detail.png`

Advanced usage must explain combining filters and following multi-step activity across related events.

- [ ] **Step 3: Write `settings.md`**

Use H1 `# Settings`. This is a short routing guide, not a duplicate procedure. Include:

- Administrator-only access.
- Links to `/docs/connectors` and `/docs/marketplace`.
- An explicit statement that this manual documents supported settings areas only.

Do not include a Settings screenshot because the current product settings navigation still contains a DHIS2 entry that is excluded from this documentation context.

- [ ] **Step 4: Write `connectors.md`**

Cover list, create, plugin selection, name/configuration, save, test, edit, enable/disable, remove, masked secrets, and credential rotation. Use:

- `connectors-list.png`
- `connector-form.png`

Fixtures and screenshots must use the generic `test-sink` plugin and the connector name `Training destination`; neither text nor image may contain DHIS2.

- [ ] **Step 5: Write `marketplace.md`**

Cover Installed, Available, Registries, artifact details, versions, capabilities, install approval, enable/disable/remove, and registry create/edit. Use:

- `marketplace-browse.png`
- `marketplace-detail.png`
- `marketplace-registries.png`

Advanced usage must explain compatibility, capabilities, version selection, registry source, and install failure diagnosis.

- [ ] **Step 6: Write `advanced-docs.md`**

Use H1 `# Advanced Docs — Coming soon`. State plainly that the separate app does not exist yet. List the future scope:

- Installation and deployment.
- Environment/infrastructure configuration.
- CLI.
- HTTP API.
- Plugin and extension development.
- Operator troubleshooting.

Link back to `/docs/start-here` and `/docs/settings`. Do not include a dead external link or screenshot.

- [ ] **Step 7: Run complete registry and validation tests**

First add the real-corpus registry completeness assertion now that all English files exist. Then run: `pnpm -C apps/web test registry validation -t "guide structure"`

Expected: PASS for registry completeness and all guide-structure checks. Manifest-to-file validation remains a separate synthetic test until Task 11.

- [ ] **Step 8: Commit the administration guides**

```bash
git add apps/web/src/docs/0.1.0/en/users.md apps/web/src/docs/0.1.0/en/audit.md apps/web/src/docs/0.1.0/en/settings.md apps/web/src/docs/0.1.0/en/connectors.md apps/web/src/docs/0.1.0/en/marketplace.md apps/web/src/docs/0.1.0/en/advanced-docs.md
git commit -m "docs(web): add administration and advanced-docs guides"
```

### Task 8: Populate the screenshot manifest and typed capture loader

**Files:**

- Modify: `apps/web/src/docs/0.1.0/screenshot-manifest.json`
- Create: `e2e/capture-docs/manifest.ts`
- Create: `e2e/capture-docs/manifest.test.ts`

- [ ] **Step 1: Add the final manifest entries**

Add exactly these 22 shots:

| Name | Guide | Route | Fixture | Ready selector |
|---|---|---|---|---|
| `start-here-navigation.png` | start-here | `/` | `base` | `nav` |
| `dashboard-overview.png` | dashboard | `/` | `amr` | `[aria-label="Dashboard"]` |
| `dashboard-edit-widget.png` | dashboard | `/` | `amr` | `[aria-label="Editor menu"]` |
| `reports-run-result.png` | reports | `/reports` | `amr` | text `Spreadsheet` |
| `reports-history-schedules.png` | reports | `/reports` | `amr` | `[role="dialog"]` |
| `workflows-list.png` | workflows | `/workflows` | `workflow` | `[data-testid="workflow-list"]` |
| `workflow-builder.png` | workflows | `/workflows/docs-training-workflow` | `workflow` | `.react-flow` |
| `workflow-run-history.png` | workflows | `/workflows/docs-training-workflow` | `workflow-run` | text `Run history` |
| `forms-list.png` | forms | `/forms` | `form` | `[aria-label="Search forms"]` |
| `form-builder.png` | forms | `/forms/{formId}/builder` | `form` | `[aria-label="Builder actions"]` |
| `form-capture.png` | forms | `/forms/{formId}` | `form` | text `Training intake` |
| `terminology-overview.png` | terminology | `/terminology` | `terminology` | text `LOINC` |
| `terminology-import.png` | terminology | `/terminology` | `terminology` | `[role="dialog"]` |
| `users-list.png` | users | `/users` | `users` | text `docs.user` |
| `user-edit-roles.png` | users | `/users` | `users` | `[role="dialog"]` |
| `audit-filter.png` | audit | `/audit` | `audit` | text `TIMESTAMP` |
| `audit-event-detail.png` | audit | `/audit` | `audit` | `[role="dialog"]` |
| `connectors-list.png` | connectors | `/settings/connectors` | `connector` | `[data-testid="connectors-page"]` |
| `connector-form.png` | connectors | `/settings/connectors` | `connector` | `[data-testid="connector-save"]` |
| `marketplace-browse.png` | marketplace | `/settings/marketplace` | `marketplace` | `[data-testid="marketplace-page"]` |
| `marketplace-detail.png` | marketplace | `/settings/marketplace` | `marketplace` | `[data-testid="detail-docs"]` |
| `marketplace-registries.png` | marketplace | `/settings/marketplace` | `marketplace` | `[data-testid="registries-tab"]` |

Each shot must include an explicit interaction sequence in a `steps` array. Supported step operations are:

```ts
type CaptureStep =
  | { action: 'click'; role: string; name: string }
  | { action: 'clickTestId'; testId: string }
  | { action: 'fill'; label: string; value: string }
  | { action: 'selectText'; text: string }
  | { action: 'waitForText'; text: string };
```

Use callouts only on action-oriented images; list/overview images may omit them.

Use these exact interaction intentions when populating `steps`:

- `start-here-navigation`, `dashboard-overview`, `workflows-list`, `forms-list`, `terminology-overview`, `users-list`, `audit-filter`, `connectors-list`, and `marketplace-browse`: no interaction before readiness.
- `dashboard-edit-widget`: click `Dashboard menu` → `Edit` → `Dashboard menu` → `Add widget`; call out the title field and `Editor menu`.
- `reports-run-result`: select `AMR Resistance Rate`, leave the optional date range empty so the seeded sample is fully represented, click `Run`, wait for `Spreadsheet`; call out the report selector, parameters, Run, and result tabs.
- `reports-history-schedules`: select `AMR Resistance Rate`, click `Actions` → `Run history`, wait for `Run history`; call out Activity and Scheduled runs.
- `workflow-builder`: open the fixture workflow row; call out the node palette, canvas, configuration panel, and run/save toolbar.
- `workflow-run-history`: open the fixture workflow, click the run-history control exposed by the builder, wait for `Run history`; call out status, duration, and node results.
- `form-builder`: open `Training intake`, choose `Edit builder`; call out the field palette, canvas/preview, field editor, and `Builder actions`.
- `form-capture`: open `Training intake` with `View/Run`; call out the required patient identifier, specimen date, and submit action.
- `terminology-import`: open the LOINC/code-system action menu and choose `Import terms`; call out the file chooser, format guidance, and import action.
- `user-edit-roles`: click `Actions for docs.user` → `Edit`; call out profile fields, roles, status, and save.
- `audit-event-detail`: click the first `workflow.update` or `form.update` fixture row; call out actor/action/entity details and before/after JSON.
- `connector-form`: click test id `add-connector`; select `test-sink`, fill name `Training destination`, and call out plugin, name/configuration, enabled state, and save. Mask password-type inputs even when empty.
- `marketplace-detail`: click the fixture artifact card, wait for `detail-docs`, and call out version, compatibility/capabilities, documentation, and install action.
- `marketplace-registries`: switch to Registries, click `Add registry`, and call out name, kind, location, enabled state, and save.

Set crops that prevent the excluded Settings subsection from entering images:

- `connectors-list` crops to `[data-testid="connectors-page"]`.
- `connector-form` crops to its open `[role="dialog"]`.
- `marketplace-browse` crops to `[data-testid="marketplace-page"]`.
- `marketplace-detail` crops to `[data-testid="marketplace-page"]` after the detail view opens.
- `marketplace-registries` crops to `[data-testid="registries-tab"]`.

- [ ] **Step 2: Write a failing Node manifest test**

Assert:

- 22 unique names.
- Every route starts with `/`.
- Every guide is in `DOC_GUIDES`.
- Every `ready` selector/text is non-empty.
- No serialized entry contains `dhis2`.
- The two connector shots use fixture `connector`.

- [ ] **Step 3: Add the typed manifest loader**

`manifest.ts` reads the JSON file with `readFile`, validates required fields at runtime, and exports `loadCaptureManifest()`. Throw errors containing the shot index and invalid field name.

- [ ] **Step 4: Run the manifest spec**

Run: `pnpm --filter @openldr/e2e docs:manifest`

Expected: PASS without taking screenshots.

- [ ] **Step 5: Commit the capture contract**

```bash
git add apps/web/src/docs/0.1.0/screenshot-manifest.json e2e/capture-docs/manifest.ts e2e/capture-docs/manifest.test.ts
git commit -m "feat(docs): define screenshot capture manifest"
```

### Task 9: Add idempotent documentation fixture scenarios

**Files:**

- Create: `e2e/capture-docs/fixtures.ts`
- Create: `scripts/make-docs-marketplace-bundle.ts`
- Modify: `e2e/global-setup.ts`
- Modify: `package.json`
- Modify: `e2e/package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add fixture contract tests to `manifest.spec.ts`**

For every manifest fixture name, assert it is one of:

```ts
const FIXTURES = [
  'base',
  'amr',
  'workflow',
  'workflow-run',
  'form',
  'terminology',
  'users',
  'audit',
  'connector',
  'marketplace',
] as const;
```

- [ ] **Step 2: Implement `ensureDocsFixtures()`**

Use `APIRequestContext` and idempotent GET-before-create behavior.

Create:

- Workflow ID `docs-training-workflow`, name `Training workflow`, with:
  - manual trigger node `docs-trigger`;
  - set node `docs-set` producing `specimen=Blood`, `organism=E. coli`, and `result=Resistant`;
  - materialize node `docs-materialize` with dataset name `docs-training-results`;
  - edges `docs-trigger → docs-set → docs-materialize`.
- Published form ID discovered after creation by name `Training intake`, with patient identifier, specimen date, specimen type, and notes fields; if the generated ID differs, return it in the fixture result and replace `{formId}` tokens in manifest routes at runtime.
- User `docs.user` with display/profile data and role `lab_technician`.
- Connector `Training destination` using installed plugin `test-sink`, with non-secret training configuration.
- Local marketplace registry `Documentation samples` pointing to the repository’s `.docs-marketplace` directory.
- Audit records by creating/updating the training workflow and form through supported APIs.

Do not insert directly into application tables unless no supported API exists. Terminology and AMR fixtures validate existing seed state instead of duplicating licensed terminology or report data.

- [ ] **Step 3: Create a DHIS2-free docs marketplace bundle generator**

Create `scripts/make-docs-marketplace-bundle.ts`. It must:

- Read `reference-plugins/test-sink/manifest.json` and `plugin.wasm`.
- Convert the flat plugin manifest with `pluginManifestToArtifact`.
- Use a deterministic documentation publisher key stored under the already-gitignored `scripts/.marketplace-keys/`.
- Pack one signed bundle into `.docs-marketplace/bundles/test-sink`.
- Write the local registry index expected by `LocalRegistrySource`.
- Use the display summary `Training sink used by the OpenLDR web documentation`.
- Never import, build, name, or package the DHIS2 sink.

Add `.docs-marketplace/` to `.gitignore`.

- [ ] **Step 4: Add a docs-specific seed command**

Change root scripts to include:

```json
"make:docs-marketplace-bundle": "tsx scripts/make-docs-marketplace-bundle.ts",
"docs:seed": "pnpm make:whonet-sample && pnpm build:plugins && pnpm build:test-sink && pnpm make:docs-marketplace-bundle && pnpm openldr db reset && pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm && pnpm openldr plugin install reference-plugins/test-sink/plugin.wasm && pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite"
```

Keep `e2e:seed` unchanged.

Add this e2e package script:

```json
"docs:manifest": "tsx --test capture-docs/manifest.test.ts"
```

Add `tsx` to `@openldr/e2e` devDependencies using the same version range as the repository root.

- [ ] **Step 5: Make global setup project-aware**

In `global-setup.ts`, inspect `config.projects`. If `docs-capture` is selected:

- Validate `/api/reports` and AMR rows.
- Validate `test-sink` appears in `/api/connectors/sink-plugins`.
- Call `ensureDocsFixtures()`.
- Throw an actionable error containing `docker compose up -d` and `pnpm docs:seed` when prerequisites are missing.

For normal smoke runs, preserve the existing setup behavior.

- [ ] **Step 6: Typecheck the e2e package**

Run: `pnpm --filter @openldr/e2e typecheck`

Expected: PASS.

- [ ] **Step 7: Commit fixture preparation**

```bash
git add e2e/capture-docs/fixtures.ts e2e/global-setup.ts scripts/make-docs-marketplace-bundle.ts package.json e2e/package.json pnpm-lock.yaml .gitignore
git commit -m "test(docs): seed deterministic screenshot fixtures"
```

### Task 10: Refactor Playwright capture for interactions, crops, masks, and callouts

**Files:**

- Create: `e2e/capture-docs/capture-helpers.ts`
- Create: `e2e/capture-docs/capture-helpers.spec.ts`
- Modify: `e2e/capture-docs/docs-screenshots.spec.ts`

- [ ] **Step 1: Write a failing helper smoke test**

Create a temporary page with a button and assert `addCallouts()` adds:

- One overlay element with `data-doc-callout="1"`.
- Text `1`.
- `pointer-events: none`.
- No overlay remaining after `removeCallouts()`.

- [ ] **Step 2: Prepare the docs capture stack**

Run:

```powershell
docker compose up -d
pnpm docs:seed
```

Expected: seed completes and global setup can create the documentation fixtures.

- [ ] **Step 3: Run the helper test and confirm failure**

Run: `pnpm --filter @openldr/e2e exec playwright test --project=docs-capture capture-docs/capture-helpers.spec.ts`

Expected: FAIL because the helper module is not implemented.

- [ ] **Step 4: Implement capture helpers**

Export:

```ts
export async function preparePage(page: Page, theme: 'dark' | 'light'): Promise<void>;
export async function runCaptureSteps(page: Page, steps: CaptureStep[]): Promise<void>;
export async function waitUntilReady(page: Page, ready: ReadyTarget): Promise<void>;
export async function addCallouts(page: Page, callouts: Callout[]): Promise<void>;
export async function removeCallouts(page: Page): Promise<void>;
export function maskLocators(page: Page, selectors: string[]): Locator[];
```

`addCallouts()` injects circular steel-blue markers into `document.body`, positioned from target element bounding boxes plus optional offsets. The overlay uses a very high z-index and is removed after capture.

- [ ] **Step 5: Rewrite `docs-screenshots.spec.ts` to iterate the manifest**

For each shot:

1. Create a context at the manifest viewport.
2. Set English language and requested theme in localStorage.
3. Navigate to the resolved route.
4. Run interaction steps.
5. Wait for the ready target.
6. Disable animations/transitions.
7. Add callouts.
8. Screenshot either the page or the crop locator.
9. Pass `mask` locators to Playwright’s screenshot option.
10. Remove callouts and close the context.

Use `locator.screenshot()` for crop entries and `page.screenshot({ fullPage: false })` otherwise.

- [ ] **Step 6: Run capture helper and manifest tests**

Run:

```powershell
pnpm --filter @openldr/e2e docs:manifest
pnpm --filter @openldr/e2e exec playwright test --project=docs-capture capture-docs/capture-helpers.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit capture tooling**

```bash
git add e2e/capture-docs/capture-helpers.ts e2e/capture-docs/capture-helpers.spec.ts e2e/capture-docs/docs-screenshots.spec.ts
git commit -m "feat(docs): capture focused annotated screenshots"
```

### Task 11: Generate and visually verify all committed screenshots

**Files:**

- Replace: `apps/web/src/docs/0.1.0/screenshots/*.png`
- Modify only if capture corrections require it: `apps/web/src/docs/0.1.0/screenshot-manifest.json`
- Modify only if text/image placement corrections require it: `apps/web/src/docs/0.1.0/en/*.md`

- [ ] **Step 1: Prepare the local stack**

Run:

```powershell
docker compose up -d
pnpm docs:seed
```

Expected: database reset succeeds; WHONET and `test-sink` plugins install; sample ingest completes; marketplace sample bundle is generated.

- [ ] **Step 2: Generate screenshots with Playwright**

Run: `pnpm docs:screenshots`

Expected: 22 capture tests pass and 22 PNG files appear under `apps/web/src/docs/0.1.0/screenshots/`.

- [ ] **Step 3: Inspect every PNG**

Open each generated file and verify:

- Correct page and state.
- English UI.
- No DHIS2 text or UI.
- No credential/token/personal data.
- Callout numbers match the written steps.
- No clipped menus, dialogs, labels, or important results.
- Text remains readable in the docs thumbnail and lightbox.
- Consistent theme and viewport.

If a screenshot fails any check, change only its manifest interactions/crop/callouts or deterministic fixture, regenerate, and inspect again.

- [ ] **Step 4: Run docs integrity validation**

Add the real-corpus assertion:

```ts
expect(validateDocs(list('en'), DOC_GUIDES, screenshotManifest, Object.keys(SCREENSHOTS))).toEqual([]);
```

Run: `pnpm -C apps/web test validation screenshots`

Expected: PASS with no orphan manifest entries, unresolved references, missing alt text, duplicate names, or DHIS2 references.

- [ ] **Step 5: Commit the final screenshots**

```bash
git add apps/web/src/docs/0.1.0/screenshots apps/web/src/docs/0.1.0/screenshot-manifest.json apps/web/src/docs/0.1.0/en
git commit -m "docs(web): add step-by-step interface screenshots"
```

### Task 12: Update docs end-to-end coverage

**Files:**

- Modify: `e2e/tests/docs.spec.ts`

- [ ] **Step 1: Replace the old docs assertions**

Add tests for:

- Sidebar groups and `Start Here`.
- Search `create workflow` → Workflows.
- `/docs/workflows` shows metadata, a numbered procedure, and an Advanced web usage heading.
- Clicking a workflow screenshot opens the lightbox.
- `/docs/advanced-docs` visibly says the separate app does not exist yet.
- `/docs/dhis2` shows not found.
- Search `dhis2` produces no result.
- French app language on a new guide shows the English fallback notice.
- Download documentation remains reachable.

- [ ] **Step 2: Run docs e2e**

Run: `pnpm --filter @openldr/e2e exec playwright test --project=smoke tests/docs.spec.ts`

Expected: PASS.

- [ ] **Step 3: Commit e2e coverage**

```bash
git add e2e/tests/docs.spec.ts
git commit -m "test(e2e): cover expanded in-app documentation"
```

### Task 13: Final verification and documentation handoff

**Files:**

- Modify if needed: `DOCS-CHANGELOG.md`

- [ ] **Step 1: Record the documentation overhaul**

Add a dated `2026-06-25` entry to `DOCS-CHANGELOG.md` summarizing:

- Twelve-guide English-first web manual.
- Workflow/forms/users/audit/settings/connectors/marketplace coverage.
- Manifest-driven Playwright screenshots.
- English fallback for French/Portuguese.
- DHIS2 removal from active in-app docs.
- Advanced Docs coming-soon page.

- [ ] **Step 2: Run focused web verification**

Run:

```powershell
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run e2e package verification**

Run:

```powershell
pnpm --filter @openldr/e2e typecheck
pnpm --filter @openldr/e2e exec playwright test --project=smoke tests/docs.spec.ts
pnpm --filter @openldr/e2e docs:manifest
```

Expected: all commands exit 0.

- [ ] **Step 4: Run repository gates**

Run:

```powershell
pnpm turbo typecheck lint test build
pnpm depcruise
```

Expected: all commands exit 0. If an unrelated pre-existing failure appears, capture the exact command, package, and failure text without weakening docs verification.

- [ ] **Step 5: Confirm the working tree contains only intended changes**

Run:

```powershell
git status --short
git diff --check
```

Expected: no whitespace errors; only docs overhaul files are modified.

- [ ] **Step 6: Commit the changelog and any verification-only corrections**

```bash
git add DOCS-CHANGELOG.md
git commit -m "docs: record in-app manual overhaul"
```

## Plan self-review

### Spec coverage

- Complete web content map: Tasks 5–7.
- Progressive task template and advanced web usage: Tasks 5–7 plus Task 4 validation.
- Grouped navigation, metadata, previous/next, and related guides: Tasks 1–2.
- English-first fallback and stale translation removal: Task 1.
- Advanced Docs coming-soon placeholder: Tasks 2 and 7.
- DHIS2 exclusion from registry, content, search, links, manifest, and screenshots: Tasks 1, 3–8, 11–12.
- Realistic fixture-driven Playwright screenshots: Tasks 8–11.
- Focused crops, masks, and numbered callouts: Task 10.
- Broken-link, screenshot, alt-text, manifest-drift, and stale-locale checks: Task 4.
- E2E and full verification: Tasks 12–13.

### Type consistency

- `DocGuide`, `DocSection`, and metadata names are introduced in Task 1 and reused unchanged by Tasks 2–4.
- Screenshot manifest fields introduced in Task 4 match the typed loader and helpers in Tasks 8–10.
- Fixture names are fixed in Task 9 and referenced verbatim by Task 8 entries.
- Screenshot filenames are fixed in Tasks 5–8 and generated in Task 11.
