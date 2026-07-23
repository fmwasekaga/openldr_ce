# Widget Builder — "Custom column" (Row-level Computed Dimension)

**Date:** 2026-07-23
**Status:** Approved (brainstorm) — pending implementation plan
**Related:** [dynamic-builder-adhoc-joins](2026-07-23-dynamic-builder-adhoc-joins-design.md) (shipped; the `adhocDimensions` fold pattern this mirrors), [builder-minimal-core-sections](2026-07-23-builder-minimal-core-sections-design.md) (shipped; the `+ Add` menu this hangs off)

## Problem

Metabase's "Custom column" lets a user derive a **row-level** column from existing fields — e.g. `concat(firstname, ' ', surname)`, or `value / 1000` — usable as a group-by. The openldr builder has no way to compute a column: dimensions are fixed to a single physical (or admin-computed age-band) column, and the only user-authored compute is `DerivedRatio`, which is **post-aggregation** (numerator/denominator over aggregate results) and produces a *measure*, not a group-by dimension.

The goal is a **row-level computed dimension**: a new group-by key derived per row from existing curated columns, added from the builder's `+ Add` menu, and thereafter usable in Group by / Breakdown / Filter like any dimension.

## Decisions (from brainstorm)

- **Flavor: row-level computed dimension** (not a post-aggregation measure — that is the existing `DerivedRatio`). It compiles into the pre-aggregation SELECT / GROUP BY, the way the admin age-band computed dimension already does.
- **Surface: structured, no parser.** A custom column is a **structured descriptor** (a discriminated union), authored through dropdowns, not a free-text expression language. There is no parser and no free-form text-as-code anywhere. This is the core safety decision and it mirrors `DerivedRatioSchema`'s structured shape.
- **v1 operator catalog:** `concat` (join N operands into a string) and `arithmetic` (a single binary `+ − × ÷`). Nothing else.
- **Operands are curated.** Each operand is **either a reference to an existing curated dimension** (a base or join column the user could already group by) **or a bound literal** (string/number). No operand can name a raw physical column that is not already an exposed dimension.

## Safety / curation stance (explicit)

The feature preserves the curation promise because **a custom column can only recombine columns that are already exposed**:

- **No parser, no injection surface.** The expression is a validated data structure. A field operand is a **dimension key**; a literal operand is a **bound parameter**. No user-supplied text is ever concatenated into SQL as code.
- **Field references are validated against the curated (effective) model.** Resolution goes through the existing `colName()`, which throws on an unknown dimension — so a hand-edited widget JSON naming a non-exposed/PII column is rejected server-side, exactly as `effectiveModel()` rejects a denied ad-hoc join column today. A new fold/validate step (`effectiveModelWithCustomColumns`, below) performs this before compilation.
- **The only fixed trust surface is the operator catalog** (`concat`, `+ − × ÷`), which lives in code and cannot be extended from a widget.
- **Consequence:** a custom column cannot reach any data the user could not already group by. It adds expressiveness, not reach.

## Architecture

Four layers. Existing paths (no custom columns present) are byte-for-byte unchanged, so recognizer/compile/builder suites stay green.

### 1. Schema (`packages/dashboards/src/types.ts`)

A new **query-level** field on the builder branch, sibling to `adhocDimensions` (query-authored, not registry):

```ts
// Operand: a reference to an existing dimension, or a bound literal.
OperandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('field'),  dimension: z.string() }), // effective-model dimension key
  z.object({ type: z.literal('string'), value: z.string() }),
  z.object({ type: z.literal('number'), value: z.number() }),
])

ExprSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('concat'),     parts: z.array(OperandSchema).min(1) }),          // → string
  z.object({ kind: z.literal('arithmetic'), op: z.enum(['+','-','*','/']),
             left: OperandSchema, right: OperandSchema }),                                    // → number
])

CustomColumnSchema = z.object({ key: z.string(), label: z.string(), expr: ExprSchema })

// added to the builder WidgetQuerySchema:
customColumns: z.array(CustomColumnSchema).optional(),
```

The result **`DimensionKind` is derived** from `expr.kind` (`concat → 'string'`, `arithmetic → 'number'`) — no separate stored `kind` to drift out of sync.

### 2. Compiler (`packages/dashboards/src/compile.ts`)

- **Fold step.** `effectiveModelWithCustomColumns(model, q)` (runs after / alongside the existing `effectiveModel` ad-hoc fold) appends each custom column to `model.dimensions` as `{ key, label, kind: derived, compute: { kind: 'expr', expr } }`. Extend the `ModelDimension.compute` union (today only `AgeBandCompute`) with an `ExprCompute { kind: 'expr'; expr }`. Validation here rejects any custom column whose `key` collides with a real dimension (trusted dimension wins, as with ad-hoc dims) and — defense in depth — any field operand not resolvable in the effective model.
- **Expression builder.** `exprToSql(model, expr, qualify): RawBuilder` produces the Kysely `sql` fragment:
  - **field** operand → `sql.ref(colName(model, dimension, qualify))` — reuses the base-vs-join qualification logic **and** the unknown-dimension guard for free.
  - **string / number** literal → a **bound** value (`sql${value}`), never inlined.
  - `concat` → operands joined by the dialect-appropriate concat (see dialect note); `arithmetic` → `left <op> right`, with `/` compiled as `left / nullif(right, 0)` so div-by-zero yields NULL rather than an engine error.
- **Dimension SELECT / GROUP BY.** The existing dimension path branches on `d.compute`; add an `expr` arm alongside the age-band arm: `SELECT exprToSql(...).as('label')`, `GROUP BY` the same expression, `ORDER BY` it. (Grouping **must** happen in SQL — see dialect note — so the expression is emitted as SQL, a deliberate, localized departure from the repo's usual math-in-JS convention, which is only viable for post-fetch transforms like grain bucketing and ratios.)
- **`collectUsedJoins` change.** When a *used* dimension is an `expr`-compute column, recurse into its **field operands** and add each operand dimension's `join`. Without this, a custom column built on a join column would not fire that `leftJoin`. This is the one change to existing compiler logic; it is additive and inert when no custom columns are present.

#### Dialect note (the one cross-cutting decision)

The external reporting DB may be **Postgres, MySQL, or SQLite** (`engine` is already known at the `runBuilderQuery` / `compileBuilderQuery` call site in `packages/bootstrap/src/index.ts`, destructured from `selectTargetStore(cfg)`).

- **Arithmetic** `+ − × ÷` and `nullif` are portable across all three — no dialect branch.
- **String concat is not portable:** `||` is concat on Postgres/SQLite but **logical OR on MySQL**; `CONCAT()` exists on MySQL/Postgres but not on older SQLite. **Recommendation:** thread `engine` into `runBuilderQuery`/`compileBuilderQuery` and emit dialect-aware concat — `||` (with numeric operands `CAST` to text) for Postgres/SQLite, `CONCAT(...)` for MySQL. This adds a small `engine` parameter to two exported functions; both call sites already have `engine` in scope.

### 3. Studio UI (`apps/studio/src/dashboard/editor/`)

- **`+ Add → Custom column`** menu entry (peer of "Join column"), opening a new **`CustomColumnEditor`**:
  - Operation select: **Concatenate** | **Arithmetic**.
  - *Concatenate:* an ordered list of parts, each a dimension-vs-literal toggle (dimension → the existing `dimOptions` Select; literal → a text `Input`), with `+ add part` / remove.
  - *Arithmetic:* left operand, operator select (`+ − × ÷`), right operand — each operand a dimension-vs-number toggle.
  - Label `Input`, auto-derived by default (e.g. `Facility + Status`, `Value ÷ 1000`), user-overridable.
  - On confirm, append a `CustomColumn` (unique `key` via a `uniqueKey`-style helper) through a pure patch helper. The result is a first-class dimension: it appears in `dimOptions` for Group by / Breakdown / Filter.
- **Rendering:** active custom columns render as chips/rows in a "Custom columns" section card, each removable.
- **Pure helpers (new, in a `customColumns.model.ts`, matching `measures.model.ts` style — React/DOM-free):** `addCustomColumn`, `updateCustomColumn`, `removeCustomColumn`, and on removal **orphan-clean** any Group by / Breakdown / Filter referencing the removed key (mirroring `removeMeasure`'s derived-ref cleanup).
- `dimOptions` construction (model dims + ad-hoc dims) extends to also include custom-column keys, so downstream selects need no bespoke wiring.

### 4. Renderer

No change expected: a custom column resolves to an ordinary `label` column in `ReportResultData` with `kind` `'string'` or `'number'`. Confirm during planning that the table/chart renderers need nothing special for a computed group-by (they key off `ReportColumn.kind`, which is populated normally).

## Testing & safety

- **Schema tests:** `CustomColumnSchema` round-trips; `concat` requires ≥1 part; `arithmetic` requires both operands; derived `kind` mapping.
- **Compiler tests:** `exprToSql` for concat (field + literal mix) and each arithmetic op; `/` emits `nullif`; literals are **bound parameters** (assert on `.compile().parameters`, not inlined SQL); `effectiveModelWithCustomColumns` fold; **rejection** of an unknown field operand; `collectUsedJoins` picks up a join referenced only through a custom column's operand; group-by on a custom column emits matching SELECT/GROUP BY/ORDER BY.
- **Dialect tests:** concat emission per `engine` (Postgres/SQLite `||` + cast, MySQL `CONCAT`); arithmetic identical across engines.
- **Studio helper tests:** add/update/remove; unique-key generation; orphan cleanup of group-by/breakdown/filter on removal.
- **UI tests:** Concatenate and Arithmetic authoring produce the expected `CustomColumn`; the new column is selectable in Group by; removing it clears orphaned references.
- **Regression:** all existing recognizer/compile/builder suites stay green when `customColumns` is absent (the fold and `collectUsedJoins` recursion are inert).
- **Safety assertions (explicit tests):** a field operand naming a non-exposed column is rejected by the fold; a literal never appears as inlined SQL text; the operator set is closed (no path emits an operator outside the catalog).

## Scope / non-goals (v1)

- Operands are **curated dimensions or literals only**. Arithmetic's usefulness scales with the number of numeric dimensions in the registry; adding numeric dimensions is ordinary registry content, out of scope here.
- **No nesting:** a custom column cannot reference another custom column (avoids dependency graphs, topological ordering, and cycles).
- **No conditionals / CASE:** the admin age-band already covers the curated CASE need; user-authored CASE is a future item.
- **No functions** beyond `concat` and a single binary arithmetic op; no unary ops, no multi-term arithmetic chains (compose is a future item).
- No change to SQL mode, the measures/formula editor, the filter-tree editor, or the join-column flow.

## Open questions for the plan

- **Concat dialect emission:** finalize the exact `||`-with-cast vs `CONCAT` forms and numeric→text casting per `engine`; decide whether v1 ships **arithmetic-only** if the concat dialect seam proves larger than budgeted (a fallback, not the preference — concat is the headline example).
- Where the fold lives: extend `effectiveModel` to also fold custom columns, or a dedicated `effectiveModelWithCustomColumns` that composes with it (ordering matters — custom columns may reference ad-hoc join dims, so the ad-hoc fold must run first).
- Auto-derived label format for arithmetic/concat (operator glyph vs word).
- Confirm the renderer needs no computed-column special-casing (layer 4).
