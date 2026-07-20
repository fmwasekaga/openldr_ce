# Screenshot-led Web Site Refresh - Design

**Date:** 2026-07-20
**Status:** Approved (brainstorm)
**Approach:** Screenshot-led, minimal marketing; public docs stay focused on setup and administration.

## Background

`apps/web` is the public OpenLDR front door. It currently has a minimal landing
page, a one-line installer block, feature cards, and Markdown-based public docs.
That restraint is valuable: the site should not become a generic marketing page
full of decorative copy.

The studio app already has the material the web site needs: a mature dark/light
token set, compact UI patterns, and a versioned screenshot library under
`apps/studio/src/docs/0.1.0/screenshots`. The refresh should use those real
screenshots to explain what OpenLDR does, while keeping `/docs` reserved for
install, deployment, environment, CLI, and developer information.

## Goals

- Make the public landing page feel like OpenLDR Studio: compact, product-first,
  dark by default, thin borders, small-radius controls, and restrained copy.
- Explain the product through real studio screenshots, not illustrations,
  synthetic dashboards, or inflated feature grids.
- Keep the site easy to scan: one clear hero, one install path, and a short set
  of screenshot-led feature sections.
- Improve the public docs page so it feels professional: readable article
  column, sticky navigation on desktop, sane mobile flow, and clean Markdown
  rendering.
- Reuse existing app assets and dependencies. Avoid a new design system or new
  visual libraries.

## Non-goals

- Moving the full in-app user documentation into `apps/web`. User guides remain
  inside Studio, where role-aware and product-contextual documentation belongs.
- Creating pricing, roadmap, FAQ, comparison tables, testimonials, or other
  product-marketing sections.
- Generating new screenshots or AI imagery for the first pass. The site should
  use the committed studio screenshots.
- Extracting a shared package for screenshots or UI tokens. Direct import/copy
  is acceptable at this scale.
- Changing installer behavior beyond visual polish and placement.

## Approach

Use `apps/web` as a static public site with two distinct jobs:

1. **Landing page:** explain OpenLDR through curated screenshots and concise
   feature text.
2. **Docs page:** help people install, configure, deploy, and develop OpenLDR.

The landing should borrow the spirit of `https://www.dbpro.app/`: product
screenshots first, short paragraphs, and a professional docs link. It should not
copy the page density, promotional blocks, or visual ornamentation.

## Landing Page Structure

### Header

- Keep the existing simple header: OpenLDR, Docs, Studio, GitHub.
- Make it sticky only if it does not create layout complexity on mobile.
- Use the existing token palette and border styling.

### Hero

- Headline: `OpenLDR`.
- Supporting copy should describe the actual product in one sentence:
  self-hosted laboratory data ingestion, workflows, forms, reports, and sync.
- Primary CTA: install/get started, linking to `#install`.
- Secondary CTA: docs, linking to `/docs`.
- Include one prominent real studio screenshot near the hero. Preferred image:
  `dashboard-overview.png`, because it shows the shared app shell and gives the
  broadest first impression of the product.

### Screenshot-led Feature Sections

Use 4-5 focused feature rows or bands. Each item pairs a screenshot with concise
copy. Recommended set:

- **Workflows:** `workflow-builder.png`; visual builder for data pipelines.
- **Reports:** `reports-run-result.png`; run, review, and export lab reports.
- **Forms:** `form-builder.png` or `form-capture.png`; build and use structured
  FHIR-backed forms.
- **Query and report design:** `query-workbench.png` plus
  `report-designer-canvas.png` if layout allows; connect data exploration to
  templates.
- **Sync and administration:** `sync-settings-card.png` or
  `marketplace-browse.png`; show operational setup without overselling.

Each section should have a short title, one paragraph, and at most three terse
capability points. Avoid large nested cards and decorative callouts. Screenshots
should use stable aspect ratios, borders, and `loading="lazy"` below the hero.

### Install Block

- Keep the existing OS-tabbed command block and copy button behavior.
- Polish spacing and alignment so it belongs visually with the screenshot-led
  sections.
- Keep explanatory text short. Do not turn this into an installer manual.

### Footer

- Keep footer practical: GitHub, docs, and license.
- Avoid extra navigation categories unless real content exists.

## Screenshot Sourcing

Add a small screenshot resolver in `apps/web` using Vite `import.meta.glob` to
import PNGs from `apps/studio/src/docs/0.1.0/screenshots`. Use bare filenames in
landing content so sections stay readable and asset paths stay centralized.

If Vite cannot import outside `apps/web/src` cleanly under the current config,
copy the selected PNGs into `apps/web/src/assets/screenshots` and document that
they are curated public-site copies. The first choice is direct reuse; the
fallback is explicit duplication of only the selected images.

## Docs Page

The public docs remain versioned Markdown loaded from `apps/web/src/docs`.
Improve the presentation without expanding scope:

- Desktop layout: sticky left sidebar, version selector, and article content
  with a comfortable max width.
- Mobile layout: navigation stacks above content or collapses into a compact
  list without trapping the reader.
- Markdown rendering: preserve tables, code blocks, headings, links, and inline
  code with studio-style tokens.
- Internal docs links should continue using React Router links so HashRouter
  routing works.
- Empty or missing version pages should show a quiet, useful fallback message.

Do not import the studio docs registry into `apps/web`; that would blur the
public-docs/in-app-docs boundary.

## Components and Boundaries

Keep changes within `apps/web` plus this design document.

Likely component boundaries:

- `Hero`: headline, CTAs, and primary screenshot.
- `ScreenshotFrame`: reusable screenshot wrapper with stable dimensions,
  border, caption support, and lazy loading.
- `FeatureWalkthrough`: owns curated landing sections.
- `InstallBlock`: existing command tabs, lightly restyled only as needed.
- `DocsPage`: improved docs layout and Markdown presentation.
- `docs/screenshots.ts` or `landing/screenshots.ts`: filename-to-URL resolver.

Avoid moving web content into shared packages unless later duplication proves it
is worth the cost.

## Visual Rules

- No generated images, gradient blobs, decorative orbs, stock photos, or fake UI.
- No oversized marketing cards inside cards.
- No one-note purple/blue gradient palette. Use the existing OpenLDR steel-blue
  accents against neutral surfaces.
- Text must fit on mobile and desktop, especially CTAs, nav links, screenshot
  captions, and code commands.
- Screenshots should be inspectable: avoid dark overlays, heavy blur, tiny
  thumbnails, and unnecessary cropping.

## Testing and Verification

- Run `pnpm --filter @openldr/web typecheck`.
- Run `pnpm --filter @openldr/web test`.
- Run `pnpm --filter @openldr/web build`.
- Start the Vite dev server and inspect the landing page and docs page at
  desktop and mobile widths.
- Confirm screenshot assets render, no console-visible missing image placeholders
  are present, and docs links route correctly under HashRouter.

## Implementation Decisions

- Use `dashboard-overview.png` as the hero screenshot.
- Attempt direct Vite imports from `apps/studio/src/docs/0.1.0/screenshots`
  first. If the build rejects cross-app asset imports, copy only the curated
  public-site screenshots into `apps/web/src/assets/screenshots` and wire the
  resolver to that folder.
