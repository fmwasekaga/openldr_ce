# Report Builder — Date-Range Lint + Canvas Param + Dark-Theme Fixes

**Date:** 2026-07-06
**Origin:** Surfaced by running the query-model Slice G `rt-amr-resistance` template in the live builder (see memory `query-model-expansion-workstream`). The seeded template renders correctly to PDF, but the live builder had three UX defects.
**Status:** Design approved — ready for implementation plan.

## Goal

Fix three defects in the Report Builder's live editing/preview experience, all
exposed by a published template that uses an optional `daterange` parameter (the
amr-resistance template). None affect the PDF render output (already correct);
all are about the in-builder experience.

## The three defects (root causes)

1. **Lint false-positives on `daterange` binding.** A `daterange` param populates
   fixed `from`/`to` value keys at runtime (`ParamValuesBar`), so a template's
   filters bind `{{param.from}}`/`{{param.to}}`. But `lintReportTemplate`
   (`packages/report-builder/src/lint.ts`) checks `{{param.<id>}}` refs against
   param **ids** (`dateRange`). So it reports `from`/`to` as `orphaned-param-ref`
   (2 errors) and `dateRange` as `unused-parameter` (1 warning) — all false. This
   also blocks the Publish button (lint-gated).
2. **Canvas table renders empty until a date is picked.** `useBlockData`
   (`apps/studio/src/reports-builder/useBlockData.ts`) has its own `resolve()`
   that substitutes `{{param.*}}` but does NOT drop blank-valued filters (unlike
   Slice G's `resolveQueryParams`). An unset date range → `effective_date_time
   <= ''` → the canvas table query returns 0 rows. The two `resolve` functions
   drifted, which is exactly this bug.
3. **White-on-white report text in dark mode.** The canvas "page"
   (`ReportCanvas.tsx`) is `bg-white`, but block text inherits the app foreground
   (`--text` = `#fafafa` in dark mode) → invisible. Affects title/text blocks,
   the data-widget tables, muted placeholders, and the page number. In light mode
   the foreground is dark, so it reads fine.

## Fixes

### Fix 1 — Lint understands `daterange` → `from`/`to` (`packages/report-builder/src/lint.ts`)

In `lintReportTemplate`:
- Compute the set of `daterange` param ids: `dateRangeParamIds = t.parameters
  .filter(p => p.type === 'daterange').map(p => p.id)`.
- Treat `from` and `to` as valid ref keys **iff** at least one `daterange` param
  exists (call this `providedKeys` = `{'from','to'}` when `dateRangeParamIds.length`).
- In `consumeRefs`: a ref `id` is valid when `definedSet.has(id) ||
  providedKeys.has(id)` — so `from`/`to` no longer produce `orphaned-param-ref`.
  When a referenced `id` is in `providedKeys`, mark every `daterange` param as
  used (add `dateRangeParamIds` to `usedParamIds`) — so no `unused-parameter`
  warning for the date param.
- Unchanged: a `{{param.from}}` reference with **no** `daterange` param defined is
  still an `orphaned-param-ref` error.

### Fix 2 — Canvas reuses the shared `resolveQueryParams` (dedupe + blank-drop)

- Export the render/run-template module from the pure barrel:
  `packages/report-builder/src/pure.ts` gains `export * from
  './render/run-template';`. (`run-template.ts` imports only types from
  `@openldr/dashboards`/`@openldr/reporting` plus schema/layout — no `pdfkit`,
  so it is pure-safe.)
- In `apps/studio/src/reports-builder/useBlockData.ts`: delete the local
  `resolve()`/`TOKEN` and import `resolveQueryParams` from
  `@openldr/report-builder/pure`; use it in place of `resolve(q, params)`. This
  substitutes `{{param.*}}` AND drops blank-valued filters, so an unset date
  range means "all dates" in the canvas (matching the PDF render path), and the
  two implementations can no longer drift.

### Fix 3 — Report page is a light-theme island (`ReportCanvas.tsx` + CSS)

The theme is driven by base CSS variables set per `:root[data-theme='…']`
(`--text`, `--text-muted`, `--bg`, `--card`, `--border`, `--border-2`,
`--table-head`), which the shadcn tokens map off (`--foreground: var(--text)`,
`--muted-foreground: var(--text-muted)`, etc.). To force the report page to render
light regardless of app theme, add a CSS class that re-declares the **light**
base-variable values locally, plus `color-scheme: light`:

```css
/* apps/studio/src/tokens.css (or a reports-builder stylesheet) */
.report-page-surface {
  --bg: #ffffff; --sidebar: #fafafa; --card: #ffffff;
  --border: #e4e4e7; --border-2: #d4d4d8; --rule: #e4e4e7;
  --text: #18181b; --text-muted: #71717a; --table-head: #f4f4f5;
  color-scheme: light;
  color: var(--text);
}
```

Apply it to the page container in `ReportCanvas.tsx` (the
`relative bg-white shadow-sm ring-1 ring-border` div → add `report-page-surface`).
All descendant content — title/text (inherit `--foreground`→`--text`), the data
widgets (use `--foreground`/`--muted-foreground`/`--border` tokens), muted
placeholders, and the page number — then resolves to light-theme colors on the
white page. `bg-white` stays (or becomes `bg-[var(--bg)]`, now white); the values
are copied verbatim from `:root[data-theme='light']`.

## Testing

- **Lint** (`packages/report-builder/src/lint.test.ts`): a template with a
  `daterange` param and filters referencing `{{param.from}}`/`{{param.to}}`
  produces **no** `orphaned-param-ref` and **no** `unused-parameter` for the date
  param; a template referencing `{{param.from}}` with **no** `daterange` param
  still reports `orphaned-param-ref`.
- **Canvas resolve**: the shared `resolveQueryParams` is already covered by
  `run-template.test.ts` (blank-drop + substitution). Add a focused
  `useBlockData` / resolve assertion that an unset param drops its filter so the
  query has no blank-valued filter. (If a hook test is impractical, a direct
  `resolveQueryParams` assertion mirroring the amr filters suffices.)
- **Theme**: a light DOM test asserts the `ReportCanvas` page container carries
  `report-page-surface`; the visual result (dark title text on the white page in
  dark mode) is confirmed live in the running builder.

## Gate

- Forced 31-package typecheck (`pnpm turbo run typecheck --force`) — the pure-barrel
  export + lint change are in the shared `@openldr/report-builder` package. Never
  pipe turbo through `tail`.
- Pre-existing unrelated flakes (studio `api.test.ts` vitest-dedupe;
  parallel-load timeouts that pass in isolation) are not regressions.

## Out of scope

- Reconsidering the `daterange` binding convention itself.
- Any change to the PDF render path (already correct).
- The query-model capability slices (C/D/E/F).
