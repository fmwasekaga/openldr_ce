# Visual-verification rubric

Run `pnpm verify:ui`, then Read each PNG in `e2e/artifacts/screenshots/` and check it
against the items below. Report PASS/notes per screen. This is agent judgment, not pixel diff.

## Global (every screen)
- Dark-native surfaces: page `#171717`, panels `#1a1a1a`/`#1e1e1e`. Light variant inverts to light surfaces.
- Accent is steelblue (`#4682B4` / `#5A9BD6`). Separation is via borders, not drop-shadows.
- Inter font, ~14px base. No raw error text, no stack traces, no broken layout.

## dashboard-dark / dashboard-light (1440x900, full page)
- Sidebar ~240px wide on the left: "OpenLDR" wordmark, Dashboard + Reports nav, disabled Forms/Users/Audit, an "operator/local" avatar block at the bottom.
- Topnav ~48px: "Dashboard" title left, theme toggle (sun/moon) right.
- Card grid of reports; each card has a title, a muted description, and a rendered chart (bar/line/pie) or stat - NOT a "Loading..." or error state.
- light variant: surfaces are light, text is dark, accent unchanged, contrast is readable.

## dashboard-narrow (768x1024)
- Same shell; the card grid reflows to fewer columns (1-2) with no horizontal overflow or clipped cards.

## report-amr-dark / report-amr-light (1440x900)
- Title reads "Report . amr-resistance" (or "Report").
- Param bar: two date inputs, a "Facility id" input, and an "Export CSV" button (pill/primary).
- A rendered bar chart of %R by antibiotic, then a data table with columns Antibiotic / Tested / R / I / S / %R, including an AMP row showing 100%.
- light variant: light surfaces, chart + table still legible.

## notfound-dark (1440x900)
- The app shell with a card containing "Page not found." - not a blank page or a server error.
