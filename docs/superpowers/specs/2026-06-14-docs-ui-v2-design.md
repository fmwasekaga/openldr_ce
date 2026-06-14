# Docs UI v2 — Design Spec (P2-DOCUI)

**Status:** Approved-pending-review
**Date:** 2026-06-14
**Sub-project:** Phase-2 sub-project 7 — In-app documentation UI v2 (corlix-style)
**Builds on:** Phase-2 sub-project 6 (P2-DOC, in-app docs) — already merged.

## Goal

Rework the existing in-app documentation UI in `apps/web` to match the **corlix** desktop app's docs experience, while staying a browser SPA. Four capabilities:

1. **Inner-sidebar layout** — a single docs surface with a persistent left doc-nav sidebar + content panel (corlix's two-panel model), replacing the current index-page/route-list split.
2. **shadcn/Radix UI** — adopt Tailwind v4 + Radix + shadcn/ui in `apps/web` (additively) so the language picker and menus are real shadcn components, not plain token-CSS `<select>`s.
3. **Image lightbox** — screenshots render as constrained thumbnails that open a click-to-zoom Radix Dialog lightbox, fixing the "scroll forever past a huge full-page image" problem.
4. **Download/export** — export the current page or all docs as Markdown, PDF, or Word (`.docx`), fully client-side.

## Decisions (locked with the user)

- **Real shadcn + Radix + Tailwind v4** adopted in `apps/web` (not a token-CSS look-alike).
- **Accent = steelblue** (`#4682B4` / `#5A9BD6`). Note: `apps/web` *already* uses this exact palette (`--brand`/`--link` in `tokens.css`), so shadcn's `--primary` bridges to the existing `--brand` with zero visual clash.
- **Download = all three formats (md/pdf/docx) × both scopes (current page / all docs)**, fully **client-side**, no server endpoint, export libs lazy-loaded.
- **One sub-project, four slices**, executed continuously via subagent-driven development (fresh implementer + two-stage spec/quality review per task).
- **Layout is single-page in feel but keeps `/docs` and `/docs/:slug` routes** rendering the same layout (deep-linking preserved; the existing e2e smoke keeps passing).

## Non-goals (YAGNI)

- No conversion of the rest of `apps/web` (Dashboard, Reports, AppShell) to Tailwind/shadcn — Tailwind is added additively and used **only** in the docs feature for now. Existing pages must render unchanged.
- No server-side export, no Chromium/Puppeteer (consistent with the project's deliberate "no-Chromium PDF" stance from P2-REP).
- No new doc content, no fr/pt translations (still en-only with fallback, unchanged from P2-DOC).
- No global preflight reset that would restyle existing pages.
- No docs authoring/editing UI.

---

## Architecture

```
apps/web/src/
  index.css or tokens.css       # + Tailwind layers (theme+utilities, NO global preflight) + shadcn token bridge
  lib/cn.ts                     # cn() = clsx + tailwind-merge
  components/ui/                # shadcn primitives (Radix-backed)
    button.tsx  select.tsx  dialog.tsx  dropdown-menu.tsx  scroll-area.tsx
  docs/
    registry.ts  search.ts  screenshots.ts  version.ts  useDocLocale.ts   # (existing, mostly unchanged)
    DocMarkdown.tsx             # MODIFIED: img -> thumbnail-button; opens lightbox via context/callback
    Lightbox.tsx               # NEW: Radix Dialog zoomable image viewer
    export/
      docModel.ts              # markdown -> intermediate block model (shared walk)
      toMarkdown.ts            # scope -> raw .md string (concat sections)
      toPdf.ts                 # block model -> jsPDF Blob (lazy-imported)
      toDocx.ts                # block model -> docx Blob (lazy-imported)
      download.ts              # blob -> browser download; orchestrates scope x format
  pages/
    Docs.tsx                   # MODIFIED: becomes the DocsLayout (sidebar + content + toolbar)
    DocPage.tsx                # MERGED INTO Docs layout (route still renders Docs with active slug)
```

### Slice A — Design-system foundation

**New deps (apps/web):** `tailwindcss@^4`, `@tailwindcss/vite@^4`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@radix-ui/react-select`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-scroll-area`, `@radix-ui/react-slot`.

**Tailwind wiring (no global preflight):**
- `vite.config.ts`: add `@tailwindcss/vite` to `plugins`. Add `resolve.alias` `@` → `/src`.
- CSS entry: import Tailwind **theme + utilities layers only**, skip preflight:
  ```css
  @layer theme, base, components, utilities;
  @import 'tailwindcss/theme.css' layer(theme);
  @import 'tailwindcss/utilities.css' layer(utilities);
  ```
  `box-sizing: border-box` is already global in `tokens.css`, so omitting preflight does not break layout. A **scoped** base block supplies the few resets shadcn assumes (default border color, button font reset) under the docs root and `components/ui` only — never globally.
- Dark variant bound to the existing attribute: `@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *))`.

**Token bridge** (added to `tokens.css`, referencing existing vars so they auto-switch by `data-theme`):
```css
:root {
  --background: var(--bg);        --foreground: var(--text);
  --card: var(--card);            --card-foreground: var(--text);   /* --card already exists; alias is identity */
  --popover: var(--card);         --popover-foreground: var(--text);
  --primary: var(--brand);        --primary-foreground: #fff;
  --secondary: var(--sidebar);    --secondary-foreground: var(--text);
  --muted: var(--sidebar);        --muted-foreground: var(--text-muted);
  --accent: var(--brand-wash);    --accent-foreground: var(--text);
  --destructive: var(--danger);   --destructive-foreground: #fff;
  --input: var(--border-2);       --ring: rgba(70,130,180,0.5);
  --radius: 0.375rem;
}
```
shadcn's `@theme inline` block maps these to Tailwind color utilities (`bg-background`, `text-muted-foreground`, `border-border`, etc.). `--border` already exists with a usable color, so it is reused directly.

**Utilities:** `lib/cn.ts` exports `cn(...)` = `twMerge(clsx(...))`.

**Components (`components/ui/*`)** — standard shadcn implementations over Radix, using `cn()` + cva, themed via the bridged tokens: `button`, `select`, `dialog`, `dropdown-menu`, `scroll-area`. Trimmed to what the docs UI uses (no unused variants).

**Test enablement:** `setupTests.ts` gains jsdom polyfills Radix needs — `Element.prototype.hasPointerCapture`, `setPointerCapture`, `releasePointerCapture`, `scrollIntoView` (no-ops) — so Select/Dialog/Dropdown are testable under vitest+jsdom.

**Regression gate:** existing `AppShell.test.tsx`, `Dashboard.test.tsx`, `ReportView.test.tsx` pass unchanged; the e2e `capture` visual smoke still renders the dashboard/report correctly. This proves additive Tailwind didn't restyle existing pages.

### Slice B — Inner-sidebar layout

- `Docs.tsx` becomes `DocsLayout`: a two-panel flex — left **doc-nav sidebar** (collapsible; section list with active highlight) + right **content panel** (scrollable). A toolbar row above the content holds the **language `Select`** (shadcn) and the **download `DropdownMenu`** (Slice D).
- **Search** moves into the sidebar header (an input that filters the section list; Fuse-powered via existing `search.ts`). When a query is active, the sidebar shows ranked hits; clearing restores the full ordered list.
- **Routing:** both `/docs` and `/docs/:slug` render `DocsLayout`. `:slug` selects the active section; `/docs` (no slug) defaults to `overview`. Selecting a section navigates (`useNavigate`/`Link` to `/docs/<slug>`) so URLs deep-link, but the layout shell persists (no full remount). The old standalone `DocPage.tsx` is folded into this layout (its not-found and "shown in English" notice move into the content panel).
- **i18n notice + locale picker** behavior preserved: switching to an untranslated locale still shows English content with the "Shown in English — not yet translated" note.
- The main `AppShell` chrome (outer app nav) still wraps the page; the docs sidebar is the **inner** sidebar, distinct from the app's outer nav.

### Slice C — Image lightbox

- `Lightbox.tsx`: a Radix `Dialog` showing one image at full size on a dark overlay, with a toolbar (zoom out / percentage / zoom in / close). Wheel-to-zoom (non-passive listener), click-image toggles 1×↔2×, scroll-to-pan when zoomed, Esc/overlay-click to close. Mirrors corlix's `ImageLightbox`.
- `DocMarkdown.tsx` `img` renderer: instead of a bare `<img>`, render a constrained **thumbnail button** (capped width, e.g. `max-w-2xl`, `cursor-zoom-in`, hover ring) with the alt as a caption; clicking calls an `onImageClick(url, alt)` callback. Unresolved images render a subtle "screenshot unavailable" placeholder span (corlix-style) and still DEV-warn.
- Wiring: `DocsLayout` owns lightbox state (`{url, alt} | null`) and passes `onImageClick` down to `DocMarkdown`; the `Lightbox` renders at the layout root.

### Slice D — Download / export

- **Trigger:** a shadcn `DropdownMenu` in the content toolbar: `Download ▸ {This page | All docs} ▸ {Markdown | PDF | Word}` (6 actions). Matches corlix's scope×format matrix.
- **Shared model:** `docModel.ts` parses a section's markdown into an ordered block list (heading/paragraph/list/code/blockquote/table/image) using the existing remark/mdast toolchain (`remark-parse` + `remark-gfm`, already transitively present via react-markdown's ecosystem; added explicitly if needed). Screenshots are resolved to data URLs (fetched from the bundled hashed asset) so exports are self-contained.
- **Emitters:**
  - `toMarkdown.ts` — raw markdown: a section is its own `.md`; "all docs" concatenates sections in `DOC_ORDER` with `---` separators. No model needed (uses raw content directly).
  - `toPdf.ts` — `jspdf`: walk the block model emitting headings/paragraphs/lists/code/images with pagination. **Lazy-imported** (`await import('jspdf')`) only on demand.
  - `toDocx.ts` — `docx` package (browser-friendly, `Packer.toBlob()`): walk the block model emitting `Paragraph`/`HeadingLevel`/`Table`/`ImageRun`. **Lazy-imported**.
- `download.ts` — given `(scope, format)`: builds the blob via the right emitter, then triggers a browser download (`URL.createObjectURL` + a transient `<a download>`; revokes the URL). Filenames: `openldr-<slug>.<ext>` (page) / `openldr-documentation.<ext>` (all).
- **Bundle discipline:** `jspdf` and `docx` are dynamically imported inside the emitters, so the docs route's initial bundle and the app's main bundle are unaffected until a user actually exports. `build:check`/`build` must stay green; note the lazy-chunk in the build output.

---

## Data flow

1. `DocsLayout` mounts → `useDocLocale()` gives locale → `list(locale)` gives ordered sections → sidebar renders nav; `:slug` (or `overview`) selects active → `resolve(locale, slug)` gives the active `DocSection`.
2. Search input → `searchDocs(buildIndex(sections), query)` → sidebar shows hits.
3. Content panel renders `<DocMarkdown content={section.content} onImageClick={...} />`. Image clicks set lightbox state → `<Lightbox image={...} />`.
4. Toolbar download → `download(scope, format)` → (lazy) emitter → blob → browser save.

## Error handling

- Unresolved screenshot → placeholder span (no crash), DEV warn (existing).
- Unknown slug → not-found panel inside the layout (sidebar still usable).
- Export of empty/whitespace content → no-op (guard).
- Export emitter failure (e.g., lazy import error) → caught; a non-blocking inline error message in the toolbar (no toast system exists; use an unobtrusive text/aria-live region).
- localStorage unavailable → locale falls back to `en` (existing hook behavior).

## Testing strategy

- **Unit/component (vitest+jsdom, wrapped in `<MemoryRouter>`):**
  - `cn()` merge behavior.
  - shadcn `Select` renders options and fires onValueChange (with the new jsdom polyfills).
  - `DocsLayout`: lists sections; search narrows; selecting a section shows its content; untranslated-locale notice; not-found slug.
  - `Lightbox`: opens on thumbnail click, shows the image, closes on Esc/close button.
  - `DocMarkdown`: renders thumbnail button for a resolved image and calls `onImageClick`; omits/places placeholder for unresolved.
  - `export/`: `toMarkdown` (section + all-docs concatenation); `docModel` block parsing; `toPdf`/`toDocx` return a non-empty Blob of the right MIME type (smoke — not pixel assertions); `download` wiring (mock `URL.createObjectURL`/anchor click).
- **e2e (Playwright smoke):** keep the existing `docs.spec.ts` green (sidebar shows "Getting Started", search narrows, `/docs/overview` h1). Add: clicking a screenshot opens the lightbox; the download menu is reachable. Screenshots/`docs-capture` project unchanged (may re-capture to reflect the new layout).
- **Regression:** full monorepo gates (`typecheck`, `test`, `depcruise`, `build:check`) green; existing non-docs web tests unchanged.

## Risks & mitigations

- **Tailwind preflight regressing existing pages** → include theme+utilities only, scope base resets to docs/ui; gate on existing AppShell/Dashboard/Report tests + visual capture.
- **Radix under jsdom** → pointer/scroll polyfills in setupTests; prefer `fireEvent`/`@testing-library/user-event` patterns proven to work with Radix.
- **Bundle bloat from jspdf/docx** → dynamic import; verify with build output; they must not enter the main/init chunk.
- **docx/jspdf browser compatibility** → both are browser-supported (`docx` Packer.toBlob; jspdf is browser-native). If `html-to-docx` (Node-only) were chosen it would fail — hence the `docx` package instead.
- **Existing docs tests (`Docs.test.tsx`, `DocPage.test.tsx`)** will be rewritten for the new layout; the e2e smoke is preserved by keeping the same accessible names/behaviors.

## Acceptance criteria

- Docs render in a two-panel inner-sidebar layout; sidebar nav switches sections; search filters the list; deep links to `/docs/:slug` work.
- The language picker is a shadcn `Select`; it and the menus are visually consistent with the steelblue theme in both dark and light.
- Screenshots show as constrained thumbnails; clicking opens a zoomable lightbox; no more giant inline images forcing long scrolls.
- A download menu exports the current page and all docs as `.md`, `.pdf`, and `.docx`; files are self-contained (screenshots embedded) and open correctly.
- Existing pages (Dashboard/Reports/shell) are visually unchanged; all four monorepo gates green; e2e smoke (incl. docs) passes.
- jspdf/docx are lazy-loaded (absent from the initial bundle).

## Slice → spec-item mapping

- **P2-DOCUI-1** Design-system foundation (Tailwind v4 + shadcn/Radix bridge, no-preflight, token map, test polyfills) → Slice A.
- **P2-DOCUI-2** Inner-sidebar single-page layout + shadcn language Select + sidebar search → Slice B.
- **P2-DOCUI-3** Image lightbox (Radix Dialog, thumbnail→zoom) → Slice C.
- **P2-DOCUI-4** Client-side md/pdf/docx export × page/all-docs (lazy-loaded) → Slice D.
