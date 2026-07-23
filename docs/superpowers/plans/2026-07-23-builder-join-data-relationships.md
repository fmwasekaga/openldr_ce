# Join data (Multiple Curated Relationships) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the shipped single-column "Join column" escape hatch into a Metabase-style "Join data" experience — relationship-first cards, multi-column selection, and more than one admin-declared relationship active per widget — without touching the persisted query schema or the SQL compiler.

**Architecture:** The persisted `adhocDimensions` array and the compiler (`effectiveModel` + `collectUsedJoins` → `leftJoin`) already support N relationships × M columns; each selected column is one `AdhocDimension` carrying its own admin-declared `join` alias. So this is a **UI + registry-content** change plus **new pure state helpers**: (1) expose the admin-declared join keys to the client for read-only display, (2) declare additional `optional` joins so multiple relationships are exercisable, (3) add reconcile/remove helpers, (4) replace the one-column picker with a relationship-first multi-column picker and render active relationships as per-relationship cards. One compiler *test* (no code) locks in the "no compiler change" claim.

**Tech Stack:** TypeScript, Zod, Kysely (Postgres/MySQL/SQLite), React + shadcn/Radix, Vitest + Testing Library.

---

## Curation / safety stance (unchanged)

Both join keys (`ModelJoin.left`/`right`) and the set of joinable tables stay **admin-declared**. The user only picks *which* declared relationship to activate and *which* denylist-filtered columns to surface. `modelsForClient` still strips raw `joins`/`denyColumns`; `effectiveModel()` still rejects any hand-edited widget referencing a non-optional join or a denied column. This plan adds **no new server trust surface**. Join keys (`left`/`right`) become visible to the client only for read-only display — they are FK column names, not data.

## File Structure

**Modify:**
- `packages/dashboards/src/models/registry.ts` — add `left`/`right` to `ClientOptionalJoin` + `modelsForClient`; declare two `optional` joins (`js` specimens, `jr` lab_requests) on the `observations` model.
- `apps/studio/src/api.ts` — mirror `left`/`right` onto the client `ClientOptionalJoin` interface.
- `apps/studio/src/dashboard/editor/builderForm.model.ts` — move `adhocKey`/`inferKind`/`humanize` here (pure); add `makeAdhocDimension`, `setRelationshipColumnsPatch`, `removeRelationshipPatch`, and a private `clearDimensionRefs`; refactor `removeAdhocDimensionPatch` onto it.
- `apps/studio/src/dashboard/editor/BuilderForm.tsx` — render active relationships as per-relationship cards; rename the tile to "Join data"; wire the new picker.
- Test files: `registry.test.ts`, `compile.test.ts`, `builderForm.model.test.ts`, `BuilderForm.test.tsx`.

**Create:**
- `apps/studio/src/dashboard/editor/JoinDataPicker.tsx` (+ `.test.tsx`) — relationship-first, multi-column picker.

**Delete (superseded):**
- `apps/studio/src/dashboard/editor/JoinColumnPicker.tsx` + `JoinColumnPicker.test.tsx`.

**Behavioral simplification (deliberate):** the bulk multi-column flow auto-derives each column's label/kind (via `makeAdhocDimension`); the old per-column custom label/kind override in `JoinColumnPicker` is dropped. Individual columns remain removable; per-column relabel is a future item.

---

### Task 1: Expose admin-declared join keys to the client (`left`/`right`)

**Files:**
- Modify: `packages/dashboards/src/models/registry.ts:116` (`ClientOptionalJoin`) and `:129` (`modelsForClient` map)
- Modify: `apps/studio/src/api.ts:290` (`ClientOptionalJoin`)
- Test: `packages/dashboards/src/models/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('modelsForClient', …)` block in `registry.test.ts`:

```ts
it('includes the admin-declared join keys (left/right) for read-only display', () => {
  const m = modelsForClient().find((x) => x.id === 'service_requests')!;
  const oj = m.optionalJoins!.find((x) => x.alias === 'jp')!;
  expect(oj.left).toBe('patient_id');
  expect(oj.right).toBe('id');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts -t "join keys"`
Expected: FAIL — `oj.left` is `undefined`.

- [ ] **Step 3: Add `left`/`right` to the type and the projection**

In `registry.ts`, extend the interface (`:116`):

```ts
export interface ClientOptionalJoin { alias: string; label: string; left: string; right: string; exposableColumns: string[] }
```

In `modelsForClient` (`:129`), add the keys to the mapped object:

```ts
      .map((j) => ({ alias: j.alias, label: j.label ?? j.table, left: j.left, right: j.right, exposableColumns: exposableColumns(m, j.alias) }))
```

- [ ] **Step 4: Mirror the fields on the studio client type**

In `apps/studio/src/api.ts:290`:

```ts
export interface ClientOptionalJoin { alias: string; label: string; left: string; right: string; exposableColumns: string[] }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts`
Expected: PASS. Then `pnpm --filter @openldr/studio typecheck` (or the repo's typecheck script) — Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/models/registry.ts packages/dashboards/src/models/registry.test.ts apps/studio/src/api.ts
git commit -m "feat(dashboards): expose optional-join keys (left/right) to the client for read-only display"
```

---

### Task 2: Declare two optional relationships on the `observations` model

**Files:**
- Modify: `packages/dashboards/src/models/registry.ts` (the `observations` model, currently `:46-57`)
- Test: `packages/dashboards/src/models/registry.test.ts`

Rationale: `lab_results` (the `observations` table) has `patient_id`, `specimen_id`, and `request_id`, so it can offer two **user-pickable** relationships (specimens, requests) alongside its existing non-optional `patients` join — making "multiple relationships in one widget" real and exercisable. Each optional join ships a **non-empty** `denyColumns` (fail-safe: without one, the join is omitted client-side).

- [ ] **Step 1: Write the failing test**

Add a new block to `registry.test.ts`:

```ts
describe('observations optional relationships', () => {
  it('offers specimens (js) and lab_requests (jr) as optional relationships, denylist-filtered', () => {
    const m = modelsForClient().find((x) => x.id === 'observations')!;
    const aliases = (m.optionalJoins ?? []).map((j) => j.alias).sort();
    expect(aliases).toEqual(['jr', 'js']);
    const js = m.optionalJoins!.find((j) => j.alias === 'js')!;
    expect(js).toMatchObject({ label: 'Specimen', left: 'specimen_id', right: 'id' });
    expect(js.exposableColumns).toEqual(['received_time', 'status', 'type_code', 'type_text', 'origin', 'created_at']);
    expect(js.exposableColumns).not.toContain('patient_id'); // denied
    const jr = m.optionalJoins!.find((j) => j.alias === 'jr')!;
    expect(jr).toMatchObject({ label: 'Request', left: 'request_id', right: 'request_id' });
    expect(jr.exposableColumns).toContain('panel_desc');
    expect(jr.exposableColumns).not.toContain('patient_id'); // denied
  });

  it('does not expose the non-optional patients join (jp) as user-pickable', () => {
    const m = modelsForClient().find((x) => x.id === 'observations')!;
    expect((m.optionalJoins ?? []).some((j) => j.alias === 'jp')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts -t "observations optional relationships"`
Expected: FAIL — `m.optionalJoins` is `undefined` (observations has no optional joins yet).

- [ ] **Step 3: Add the two optional joins**

In `registry.ts`, replace the `observations` model's `joins:` array (currently `joins: [{ table: 'patients', alias: 'jp', left: 'patient_id', right: 'id' }],`) with:

```ts
    joins: [
      { table: 'patients', alias: 'jp', left: 'patient_id', right: 'id' },
      { table: 'specimens', alias: 'js', left: 'specimen_id', right: 'id', optional: true, label: 'Specimen',
        denyColumns: ['id', 'patient_id', 'accession', 'source_system', 'plugin_id', 'plugin_version', 'batch_id'] },
      { table: 'lab_requests', alias: 'jr', left: 'request_id', right: 'request_id', optional: true, label: 'Request',
        denyColumns: ['id', 'request_id', 'patient_id', 'source_system', 'plugin_id', 'plugin_version', 'batch_id'] },
    ],
```

(Leave the model's `dimensions:` and `metrics:` untouched — the existing `facility` dimension still uses `jp`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts`
Expected: PASS (new block green; existing `observations facility join` test still green — `jp` is unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/models/registry.ts packages/dashboards/src/models/registry.test.ts
git commit -m "feat(dashboards): declare specimens + requests as optional relationships on observations"
```

---

### Task 3: Compiler regression test — two simultaneous optional joins (no code change)

**Files:**
- Test only: `packages/dashboards/src/compile.test.ts`

Locks in the design claim that multiple relationships need no compiler change. The two ad-hoc dims must pass `effectiveModel` validation (both columns are exposable) and fire two `leftJoin`s.

- [ ] **Step 1: Write the test**

Append to `compile.test.ts`:

```ts
describe('compileBuilderQuery multiple optional joins', () => {
  it('emits a leftJoin per distinct optional join referenced, with qualified refs', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'count', agg: 'count' },
      adhocDimensions: [
        { key: 'js__status', label: 'Specimen Status', join: 'js', column: 'status', kind: 'string' },
        { key: 'jr__priority', label: 'Request Priority', join: 'jr', column: 'priority', kind: 'string' },
      ],
      dimension: { key: 'js__status' },
      filters: [{ dimension: 'jr__priority', op: 'eq', value: 'high' }],
    } as any).compile();
    expect(sql).toMatch(/left join "specimens" as "js"/i);
    expect(sql).toMatch(/left join "lab_requests" as "jr"/i);
    expect(sql).toMatch(/"js"\."status" as "label"/i);
    expect(sql).not.toMatch(/as "jp"/i); // the non-optional patients join is not referenced → not emitted
  });

  it('rejects an ad-hoc column that the denylist excludes', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'count', agg: 'count' },
      adhocDimensions: [{ key: 'js__patient_id', label: 'x', join: 'js', column: 'patient_id', kind: 'string' }],
      dimension: { key: 'js__patient_id' }, filters: [],
    } as any)).toThrow(/not exposable/i);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (no code change)**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts -t "multiple optional joins"`
Expected: PASS immediately — the machinery already handles this. (If it fails, STOP: the "no compiler change" claim is wrong and the design must be revisited before continuing.)

- [ ] **Step 3: Commit**

```bash
git add packages/dashboards/src/compile.test.ts
git commit -m "test(dashboards): lock in multi-optional-join compilation (no code change)"
```

---

### Task 4: Pure helpers — move join helpers to the model + add reconcile/remove-relationship

**Files:**
- Modify: `apps/studio/src/dashboard/editor/builderForm.model.ts`
- Modify: `apps/studio/src/dashboard/editor/JoinColumnPicker.tsx` (re-point its imports; deleted later in Task 7)
- Modify: `apps/studio/src/dashboard/editor/JoinColumnPicker.test.tsx` (re-point `adhocKey` import)
- Test: `apps/studio/src/dashboard/editor/builderForm.model.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `builderForm.model.test.ts` (extend the import on line 2 to also pull `adhocKey, makeAdhocDimension, setRelationshipColumnsPatch, removeRelationshipPatch`):

```ts
describe('join relationship patches', () => {
  const q0 = () => ({ mode: 'builder' as const, model: 'observations', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] });

  it('adhocKey builds a stable join__column key', () => {
    expect(adhocKey('js', 'status')).toBe('js__status');
  });

  it('makeAdhocDimension derives key/label/kind for a column', () => {
    expect(makeAdhocDimension('js', 'Specimen', 'received_time')).toEqual({
      key: 'js__received_time', label: 'Specimen → Received Time', join: 'js', column: 'received_time', kind: 'date',
    });
  });

  it('setRelationshipColumnsPatch adds the selected columns for one relationship', () => {
    const next = setRelationshipColumnsPatch(q0(), 'js', 'Specimen', ['status', 'origin']);
    expect(next.adhocDimensions).toEqual([
      { key: 'js__status', label: 'Specimen → Status', join: 'js', column: 'status', kind: 'string' },
      { key: 'js__origin', label: 'Specimen → Origin', join: 'js', column: 'origin', kind: 'string' },
    ]);
  });

  it('setRelationshipColumnsPatch leaves other relationships untouched', () => {
    let q = setRelationshipColumnsPatch(q0(), 'js', 'Specimen', ['status']);
    q = setRelationshipColumnsPatch(q, 'jr', 'Request', ['priority']);
    expect((q.adhocDimensions ?? []).map((d) => d.key)).toEqual(['js__status', 'jr__priority']);
  });

  it('setRelationshipColumnsPatch drops a deselected column and orphan-cleans its group-by', () => {
    let q = setRelationshipColumnsPatch(q0(), 'js', 'Specimen', ['status', 'origin']);
    q = setDimensionPatch(q, 'js__origin');
    const next = setRelationshipColumnsPatch(q, 'js', 'Specimen', ['status']); // drop origin
    expect((next.adhocDimensions ?? []).map((d) => d.key)).toEqual(['js__status']);
    expect(next.dimension).toBeUndefined(); // orphan cleanup
  });

  it('removeRelationshipPatch removes every column for the alias and orphan-cleans references', () => {
    let q = setRelationshipColumnsPatch(q0(), 'js', 'Specimen', ['status']);
    q = setRelationshipColumnsPatch(q, 'jr', 'Request', ['priority']);
    q = setDimensionPatch(q, 'js__status');
    q = { ...q, breakdown: { key: 'jr__priority' } };
    const next = removeRelationshipPatch(q, 'js');
    expect((next.adhocDimensions ?? []).map((d) => d.key)).toEqual(['jr__priority']); // jr kept
    expect(next.dimension).toBeUndefined();                 // js group-by cleaned
    expect(next.breakdown).toEqual({ key: 'jr__priority' }); // jr breakdown kept
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/studio test -- builderForm.model.test.ts -t "join relationship patches"`
Expected: FAIL — `adhocKey`, `makeAdhocDimension`, `setRelationshipColumnsPatch`, `removeRelationshipPatch` are not exported from `builderForm.model`.

- [ ] **Step 3: Add the helpers to `builderForm.model.ts`**

Append to `builderForm.model.ts`:

```ts
// --- "Join data" helpers (moved here from JoinColumnPicker so they're pure + unit-testable) ---

/** Query-local key for an ad-hoc join column. */
export function adhocKey(join: string, column: string): string {
  return `${join}__${column}`;
}

/** Columns that look like dates/numbers get a better default kind; everything else is a string. */
export function inferKind(column: string): AdhocDimension['kind'] {
  if (/(_at|_time|date|timestamp|issued|authored|received|effective)/i.test(column)) return 'date';
  if (/(count|value|amount|age|number|_id$)/i.test(column)) return 'number';
  return 'string';
}

/** Title-case a snake_case column name for a default label. */
export function humanize(column: string): string {
  return column.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build an ad-hoc dimension for one join column, with a derived key/label/kind. */
export function makeAdhocDimension(joinAlias: string, joinLabel: string, column: string): AdhocDimension {
  return { key: adhocKey(joinAlias, column), label: `${joinLabel} → ${humanize(column)}`, join: joinAlias, column, kind: inferKind(column) };
}

/** Clear every reference (group-by, breakdown, flat filters, filterTree) to any key in `keys`. */
function clearDimensionRefs(next: BuilderQuery, keys: Set<string>): BuilderQuery {
  if (next.dimension && keys.has(next.dimension.key)) next.dimension = undefined;
  if (next.breakdown && keys.has(next.breakdown.key)) next.breakdown = undefined;
  if (next.filters?.length) next.filters = next.filters.filter((f) => !keys.has(f.dimension));
  if (next.filterTree) next.filterTree = pruneDimensions(next.filterTree as TreeGroup, keys) as BuilderQuery['filterTree'];
  return next;
}

/**
 * Reconcile the ad-hoc columns for ONE relationship (join alias) to exactly `columns`: keep every
 * ad-hoc dimension from OTHER relationships, replace this alias's set with freshly-derived dims, and
 * orphan-clean any group-by/breakdown/filter reference to a column that was dropped. The derived key
 * is stable, so an unchanged column keeps its key (and its references) across a reconcile.
 */
export function setRelationshipColumnsPatch(value: BuilderQuery, joinAlias: string, joinLabel: string, columns: string[]): BuilderQuery {
  const others = (value.adhocDimensions ?? []).filter((d) => d.join !== joinAlias);
  const desired = columns.map((c) => makeAdhocDimension(joinAlias, joinLabel, c));
  const desiredKeys = new Set(desired.map((d) => d.key));
  const removedKeys = new Set(
    (value.adhocDimensions ?? []).filter((d) => d.join === joinAlias && !desiredKeys.has(d.key)).map((d) => d.key),
  );
  const next = { ...value, adhocDimensions: [...others, ...desired] };
  return clearDimensionRefs(next, removedKeys);
}

/** Remove an entire relationship (all ad-hoc dims for `joinAlias`) and orphan-clean their references. */
export function removeRelationshipPatch(value: BuilderQuery, joinAlias: string): BuilderQuery {
  const removedKeys = new Set((value.adhocDimensions ?? []).filter((d) => d.join === joinAlias).map((d) => d.key));
  const next = { ...value, adhocDimensions: (value.adhocDimensions ?? []).filter((d) => d.join !== joinAlias) };
  return clearDimensionRefs(next, removedKeys);
}
```

Then refactor the existing `removeAdhocDimensionPatch` (lines 137-146) to reuse `clearDimensionRefs` (behavior identical):

```ts
export function removeAdhocDimensionPatch(value: BuilderQuery, key: string): BuilderQuery {
  const list = (value.adhocDimensions ?? []).filter((d) => d.key !== key);
  const next = { ...value, adhocDimensions: list };
  return clearDimensionRefs(next, new Set([key]));
}
```

- [ ] **Step 4: Re-point the old picker's imports (keep it compiling until Task 7)**

In `JoinColumnPicker.tsx`, delete the local `adhocKey`, `inferKind`, and `humanize` definitions (lines 8-21) and import them instead:

```ts
import { adhocKey, inferKind, humanize, type AdhocDimension } from './builderForm.model';
```

(Remove the now-duplicate `import type { AdhocDimension }` line.) In `JoinColumnPicker.test.tsx`, change line 3 to import `adhocKey` from the model:

```ts
import { JoinColumnPicker } from './JoinColumnPicker';
import { adhocKey } from './builderForm.model';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- builderForm.model.test.ts JoinColumnPicker.test.tsx`
Expected: PASS (new helper tests green; the existing `adhoc dimension patches` block still green; `JoinColumnPicker` still works via re-pointed imports).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/dashboard/editor/builderForm.model.ts apps/studio/src/dashboard/editor/builderForm.model.test.ts apps/studio/src/dashboard/editor/JoinColumnPicker.tsx apps/studio/src/dashboard/editor/JoinColumnPicker.test.tsx
git commit -m "feat(studio): add relationship reconcile/remove helpers; move join helpers to builderForm.model"
```

---

### Task 5: `JoinDataPicker` — relationship-first, multi-column picker

**Files:**
- Create: `apps/studio/src/dashboard/editor/JoinDataPicker.tsx`
- Test: `apps/studio/src/dashboard/editor/JoinDataPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `JoinDataPicker.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { JoinDataPicker } from './JoinDataPicker';

const optionalJoins = [
  { alias: 'js', label: 'Specimen', left: 'specimen_id', right: 'id', exposableColumns: ['status', 'origin'] },
];

describe('JoinDataPicker', () => {
  it('shows the read-only join keys for the selected relationship', () => {
    render(<JoinDataPicker optionalJoins={optionalJoins} adhoc={[]} onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('on specimen_id = id')).toBeInTheDocument();
  });

  it('applies the checked columns for the selected relationship', () => {
    const onApply = vi.fn();
    render(<JoinDataPicker optionalJoins={optionalJoins} adhoc={[]} onApply={onApply} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText('status')); // check the column
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith('js', 'Specimen', ['status']);
  });

  it('pre-checks columns already present for the relationship', () => {
    const adhoc = [{ key: 'js__origin', label: 'Specimen → Origin', join: 'js', column: 'origin', kind: 'string' as const }];
    render(<JoinDataPicker optionalJoins={optionalJoins} adhoc={adhoc} onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText('origin')).toBeChecked();
    expect(screen.getByLabelText('status')).not.toBeChecked();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- JoinDataPicker.test.tsx`
Expected: FAIL — module `./JoinDataPicker` does not exist.

- [ ] **Step 3: Implement `JoinDataPicker.tsx`**

```tsx
import { useState } from 'react';
import type { ClientOptionalJoin } from '../../api';
import type { AdhocDimension } from './builderForm.model';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

const columnsForAlias = (adhoc: AdhocDimension[], alias: string) =>
  adhoc.filter((d) => d.join === alias).map((d) => d.column);

/**
 * Relationship-first, multi-column picker for admin-declared optional joins. Picking a relationship
 * shows its (curated) columns as checkboxes, pre-checked from what the widget already uses; Apply
 * reconciles that relationship's columns via setRelationshipColumnsPatch. Join keys are shown
 * read-only — the user never chooses them.
 */
export function JoinDataPicker({ optionalJoins, adhoc, onApply, onCancel }: {
  optionalJoins: ClientOptionalJoin[];
  adhoc: AdhocDimension[];
  onApply: (alias: string, joinLabel: string, columns: string[]) => void;
  onCancel: () => void;
}) {
  const [alias, setAlias] = useState(optionalJoins[0]?.alias ?? '');
  const [checked, setChecked] = useState<string[]>(() => columnsForAlias(adhoc, optionalJoins[0]?.alias ?? ''));
  const join = optionalJoins.find((j) => j.alias === alias);

  const selectAlias = (a: string) => { setAlias(a); setChecked(columnsForAlias(adhoc, a)); };
  const toggle = (c: string) => setChecked((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
      <label>
        Related data
        <Select value={alias} onValueChange={selectAlias}>
          <SelectTrigger aria-label="Related data" className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {optionalJoins.map((j) => (
              <SelectItem key={j.alias} value={j.alias}>{j.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {join && <p className="text-xs text-muted-foreground">on {join.left} = {join.right}</p>}

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs text-muted-foreground">Columns</legend>
        {(join?.exposableColumns ?? []).map((c) => (
          <label key={c} className="flex items-center gap-2 text-xs">
            <input type="checkbox" aria-label={c} checked={checked.includes(c)} onChange={() => toggle(c)} />
            {c}
          </label>
        ))}
      </fieldset>

      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!alias} onClick={() => onApply(alias, join?.label ?? alias, checked)}>
          Apply
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- JoinDataPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/JoinDataPicker.tsx apps/studio/src/dashboard/editor/JoinDataPicker.test.tsx
git commit -m "feat(studio): add JoinDataPicker (relationship-first, multi-column, read-only keys)"
```

---

### Task 6: Wire `BuilderForm` to per-relationship cards + the new picker

**Files:**
- Modify: `apps/studio/src/dashboard/editor/BuilderForm.tsx`
- Test: `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`

- [ ] **Step 1: Update the join-flow tests (they will fail against the current UI)**

In `BuilderForm.test.tsx`:

(a) Add `left`/`right` to the `modelsWithJoin` optional join (line ~85) so the picker can render keys:

```ts
  optionalJoins: [{ alias: 'jp', label: 'Patient', left: 'patient_id', right: 'id', exposableColumns: ['sex', 'managing_organization'] }],
```

(b) Rename the tile test (line ~90):

```ts
  it('offers a "Join data" tile when the model has optional joins', () => {
    render(<BuilderForm models={modelsWithJoin} value={builderValue} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /join data/i })).toBeInTheDocument();
  });
```

(c) Replace the "clears ALL join columns" test (line ~95) — the card is now per-relationship ("Join: Patient"):

```ts
  it('the relationship card × removes every column for that relationship', () => {
    const onChange = vi.fn();
    const value = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [],
      adhocDimensions: [
        { key: 'jp__sex', label: 'Patient → Sex', join: 'jp', column: 'sex', kind: 'string' },
        { key: 'jp__managing_organization', label: 'Patient → Managing Organization', join: 'jp', column: 'managing_organization', kind: 'string' },
      ],
    } as never;
    render(<BuilderForm models={modelsWithJoin} value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove join: patient/i }));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.adhocDimensions ?? []).toHaveLength(0);
  });
```

(d) Replace the "adds an adhoc dimension through the picker" test (line ~132):

```ts
  it('adds join columns through the Join data picker and emits them on change', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={modelsWithJoin} value={builderValue} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /join data/i }));
    fireEvent.click(screen.getByLabelText('sex'));       // check the column
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      adhocDimensions: [expect.objectContaining({ key: 'jp__sex', column: 'sex' })],
    }));
  });
```

(Leave the "lists an added adhoc dimension as a Filter field option" and "renders a Grain control for an adhoc date column" tests unchanged — they exercise `dimOptions`, which is not changing.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/studio test -- BuilderForm.test.tsx`
Expected: FAIL — no "Join data" button; the picker still uses the old Column-select flow.

- [ ] **Step 3: Update imports in `BuilderForm.tsx`**

Replace line 9 (`import { JoinColumnPicker } …`) with:

```ts
import { JoinDataPicker } from './JoinDataPicker';
```

In the `builderForm.model` import block (lines 11-23), drop `addAdhocDimensionPatch` and add the relationship helpers:

```ts
  removeAdhocDimensionPatch,
  removeRelationshipPatch,
  setRelationshipColumnsPatch,
  type BuilderQuery,
```

- [ ] **Step 4: Render active relationships as per-relationship cards**

Replace the second half of `visibleBlocks` (the `...(adhoc.length > 0 ? [ <SectionCard … "Join columns" … > ] : [])` block, lines ~198-211) with a per-alias grouping:

```tsx
    ...[...new Set(adhoc.map((a) => a.join))].map((alias) => {
      const meta = model?.optionalJoins?.find((j) => j.alias === alias);
      const cols = adhoc.filter((a) => a.join === alias);
      const label = meta?.label ?? alias;
      return (
        <SectionCard key={`__join_${alias}__`} label={`Join: ${label}`} onRemove={() => onChange(removeRelationshipPatch(value, alias))}>
          {meta && <p className="mb-2 text-xs text-muted-foreground">on {meta.left} = {meta.right}</p>}
          <div className="flex flex-wrap gap-1">
            {cols.map((a) => (
              <span key={a.key} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                {a.label}
                <button type="button" aria-label={`Remove ${a.label}`} onClick={() => onChange(removeAdhocDimensionPatch(value, a.key))}>×</button>
              </span>
            ))}
          </div>
        </SectionCard>
      );
    }),
```

- [ ] **Step 5: Swap the picker and rename the tile**

In the `addBlock` definition (lines ~218-254): replace the `<JoinColumnPicker … />` usage with:

```tsx
        <JoinDataPicker
          optionalJoins={model.optionalJoins}
          adhoc={adhoc}
          onApply={(alias, joinLabel, columns) => { onChange(setRelationshipColumnsPatch(value, alias, joinLabel, columns)); setShowPicker(false); }}
          onCancel={() => setShowPicker(false)}
        />
```

And rename the tile text (line ~250) from `Join column` to `Join data`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- BuilderForm.test.tsx`
Expected: PASS (all four updated join tests green; the untouched dimOptions tests still green).

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/dashboard/editor/BuilderForm.tsx apps/studio/src/dashboard/editor/BuilderForm.test.tsx
git commit -m "feat(studio): relationship-first Join data section with per-relationship cards + multi-column picker"
```

---

### Task 7: Delete the superseded `JoinColumnPicker`

**Files:**
- Delete: `apps/studio/src/dashboard/editor/JoinColumnPicker.tsx`
- Delete: `apps/studio/src/dashboard/editor/JoinColumnPicker.test.tsx`

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "JoinColumnPicker" apps/studio/src`
Expected: no matches (BuilderForm now imports `JoinDataPicker`; `adhocKey` now comes from `builderForm.model`).

- [ ] **Step 2: Delete the files**

```bash
git rm apps/studio/src/dashboard/editor/JoinColumnPicker.tsx apps/studio/src/dashboard/editor/JoinColumnPicker.test.tsx
```

- [ ] **Step 3: Run the studio editor suite + typecheck**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor` and `pnpm --filter @openldr/studio typecheck`
Expected: PASS, no dangling references.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(studio): remove JoinColumnPicker superseded by JoinDataPicker"
```

---

### Task 8: Full-suite verification

- [ ] **Step 1: Run the affected package suites**

Run: `pnpm --filter @openldr/dashboards test && pnpm --filter @openldr/studio test`
Expected: all green.

- [ ] **Step 2: Typecheck + lint the touched packages**

Run: the repo's typecheck/lint scripts for `@openldr/dashboards` and `@openldr/studio`.
Expected: clean.

- [ ] **Step 3 (manual smoke, optional):** Launch studio, open the widget builder on the **Results** source, click **Join data**, pick **Specimen**, check two columns, **Apply**; add a second **Request** relationship; confirm both cards render with read-only keys, both columns appear in Group by, and removing a card clears its columns and any orphaned group-by.

---

## Self-Review

**Spec coverage:**
- "No schema/compiler change" → Task 3 (compiler test only) confirms it; the only server change is exposing `left`/`right` for display (Task 1), which the spec calls out under Open questions.
- "Relationship-first, multi-column, multiple relationships" → Task 6 (per-relationship cards) + Task 5 (multi-column picker) + Task 2 (two optional relationships).
- "Read-only join keys for transparency" → Task 1 (client keys) + Tasks 5/6 (render `on left = right`).
- "Registry declares ≥1 additional optional join with non-empty denyColumns" → Task 2 (two joins, both with denylists).
- "Orphan-clean on removal, mirroring existing cleanup" → Task 4 (`clearDimensionRefs`, `setRelationshipColumnsPatch`, `removeRelationshipPatch`) + tests.
- "PII/curation unchanged; no new server trust surface" → no change to `exposableColumns`/`effectiveModel`; Task 3's denied-column rejection test proves the guard still holds.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `ClientOptionalJoin` gains `left`/`right` in both `registry.ts` and `api.ts` (Task 1); `setRelationshipColumnsPatch(value, alias, joinLabel, columns)` and `removeRelationshipPatch(value, alias)` signatures match between Task 4's definitions and Task 6's call sites; `JoinDataPicker` props (`optionalJoins`, `adhoc`, `onApply`, `onCancel`) match between Task 5 and Task 6.

**Notes / assumptions to verify at execution time:**
- Test/typecheck commands assume `pnpm --filter <pkg> test`. If the repo uses a different runner, adapt the commands — the test *content* is unaffected.
- `pruneDimensions` accepts `(tree, Set<string>)` (confirmed via existing `removeAdhocDimensionPatch`); `clearDimensionRefs` relies on that.
