# Report Builder — Layout & Space — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim Report Builder horizontal space: a collapsible icon-rail block palette and a right pane that's never blank (Report settings when idle) and collapses on demand.

**Architecture:** Frontend-only in `apps/studio/src/reports-builder/`. A `usePersistedToggle` hook (localStorage) drives two collapse prefs. `BlockPalette` gains a collapsed icon-rail mode (drag-to-canvas preserved). A new `ReportSettings` replaces the blank inspector placeholder (page size/orientation/margins + Parameters). A new `InspectorPane` wraps the right pane with a collapse rail; selecting a block auto-expands it.

**Tech Stack:** React, TypeScript, Testing Library, vitest, Tailwind, lucide-react, react-i18next, dnd-kit.

**Design spec:** `docs/superpowers/specs/2026-07-06-report-builder-layout-space-design.md`

**Conventions (repo memory):**
- Work on a fresh branch `report-builder-layout-space` off `main` (tip `625e08aa`).
- Never pipe turbo through `tail`. Run studio tests from repo root, e.g. `pnpm --filter @openldr/studio exec vitest run src/reports-builder/BlockPalette.test.tsx`.
- `fr.ts`/`pt.ts` are typed `: EnShape` — new i18n keys must be added to all three (en/fr/pt) or tsc fails. Studio test i18n resolves `t()` to English, so English key values must match test query strings.
- Commit after every green step; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Current layout** ([ReportBuilderPage.tsx:121-146](apps/studio/src/reports-builder/ReportBuilderPage.tsx)):
```tsx
<div className="flex min-h-0 flex-1 overflow-hidden">
  <div className="w-40 shrink-0 border-r border-border overflow-y-auto"><BlockPalette onAdd={addBlock} /></div>
  <div className="min-w-0 flex-1 overflow-auto bg-muted/30" onClick={() => setSelected(null)}>
    <ReportCanvas ... />
  </div>
  <div className="w-64 shrink-0 border-l border-border overflow-y-auto">
    {selectedBlock && selected ? (
      <BlockInspector ... />
    ) : (
      <div className="p-4 text-xs text-muted-foreground">{t('reportBuilder.inspector.selectHint')}</div>
    )}
  </div>
</div>
```

---

## File Structure

**Create:** `usePersistedToggle.ts`, `ReportSettings.tsx`, `InspectorPane.tsx` (all under `apps/studio/src/reports-builder/`) + their `.test.tsx`/`.test.ts`.
**Modify:** `BlockPalette.tsx` (collapsed mode), `ReportBuilderPage.tsx` (wire all three), `apps/studio/src/i18n/{en,fr,pt}.ts` (new keys).

---

## Task 1: `usePersistedToggle` hook + collapsible block palette

**Files:**
- Create: `apps/studio/src/reports-builder/usePersistedToggle.ts`, `apps/studio/src/reports-builder/usePersistedToggle.test.ts`
- Modify: `apps/studio/src/reports-builder/BlockPalette.tsx`, `apps/studio/src/reports-builder/BlockPalette.test.tsx`, `apps/studio/src/reports-builder/ReportBuilderPage.tsx`, `apps/studio/src/i18n/{en,fr,pt}.ts`

- [ ] **Step 1: Write the failing hook test** — create `apps/studio/src/reports-builder/usePersistedToggle.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistedToggle } from './usePersistedToggle';

beforeEach(() => localStorage.clear());

describe('usePersistedToggle', () => {
  it('defaults, toggles, and persists to localStorage', () => {
    const { result } = renderHook(() => usePersistedToggle('k1', false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('k1')).toBe('true');
  });
  it('reads the persisted value on init', () => {
    localStorage.setItem('k2', 'true');
    const { result } = renderHook(() => usePersistedToggle('k2', false));
    expect(result.current[0]).toBe(true);
  });
  it('set() writes an explicit value', () => {
    const { result } = renderHook(() => usePersistedToggle('k3', true));
    act(() => result.current[2](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem('k3')).toBe('false');
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/usePersistedToggle.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the hook** — `apps/studio/src/reports-builder/usePersistedToggle.ts`:

```ts
import { useState } from 'react';

/** A boolean toggle persisted to localStorage under `key`. Returns [value, toggle, set]. */
export function usePersistedToggle(key: string, initial = false): [boolean, () => void, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try { const s = localStorage.getItem(key); return s == null ? initial : s === 'true'; } catch { return initial; }
  });
  const write = (v: boolean) => { try { localStorage.setItem(key, String(v)); } catch { /* ignore */ } return v; };
  const toggle = () => setValue((c) => write(!c));
  const set = (v: boolean) => setValue(() => write(v));
  return [value, toggle, set];
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/usePersistedToggle.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Add palette i18n keys**

In `apps/studio/src/i18n/en.ts`, inside the `reportBuilder.palette` object (which has `heading`, `kind`, etc.), add:
```ts
      collapse: 'Collapse palette',
      expand: 'Expand palette',
```
In `fr.ts` `reportBuilder.palette`:
```ts
      collapse: 'Réduire la palette',
      expand: 'Développer la palette',
```
In `pt.ts` `reportBuilder.palette`:
```ts
      collapse: 'Recolher paleta',
      expand: 'Expandir paleta',
```

- [ ] **Step 6: Write the failing palette test** — in `apps/studio/src/reports-builder/BlockPalette.test.tsx`, append (reuse the file's existing DndContext render wrapper — the existing tests render `<BlockPalette>` inside a `DndContext`; use that same wrapper, referred to here as `renderInDnd`):

```tsx
it('collapsed: icon-only items still add a block on click', () => {
  const onAdd = vi.fn();
  renderInDnd(<BlockPalette collapsed onToggle={() => {}} onAdd={onAdd} />);
  fireEvent.click(screen.getByRole('button', { name: /table/i }));
  expect(onAdd).toHaveBeenCalledWith('table');
});
it('the collapse toggle calls onToggle', () => {
  const onToggle = vi.fn();
  renderInDnd(<BlockPalette collapsed={false} onToggle={onToggle} onAdd={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /collapse palette/i }));
  expect(onToggle).toHaveBeenCalled();
});
```

- [ ] **Step 7: Run to confirm FAIL**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/BlockPalette.test.tsx`
Expected: FAIL — `collapsed`/`onToggle` props don't exist; no "Collapse palette" toggle.

- [ ] **Step 8: Rewrite `BlockPalette.tsx`** with collapsed mode + icons:

```tsx
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { Heading, Type, Gauge, BarChart3, Table, Image as ImageIcon, Minus, SeparatorHorizontal, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';
import type { BlockKind } from '@openldr/report-builder/pure';

const KINDS: BlockKind[] = ['title', 'text', 'kpi', 'chart', 'table', 'image', 'divider', 'pageBreak'];
const ICONS: Record<BlockKind, LucideIcon> = { title: Heading, text: Type, kpi: Gauge, chart: BarChart3, table: Table, image: ImageIcon, divider: Minus, pageBreak: SeparatorHorizontal };

function PaletteItem({ kind, collapsed, onAdd }: { kind: BlockKind; collapsed: boolean; onAdd: (k: BlockKind) => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${kind}`, data: { palette: kind } });
  const label = t(`reportBuilder.palette.kind.${kind}`);
  const Icon = ICONS[kind];
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onAdd(kind)}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={`flex w-full items-center rounded-md border border-border py-1.5 text-left text-xs hover:bg-accent ${collapsed ? 'justify-center px-0' : 'gap-2 px-2'} ${isDragging ? 'opacity-50' : ''}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{!collapsed && <span>{label}</span>}
    </button>
  );
}

export function BlockPalette({ collapsed = false, onToggle, onAdd }: { collapsed?: boolean; onToggle?: () => void; onAdd: (kind: BlockKind) => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 p-2">
      <button
        type="button"
        onClick={() => onToggle?.()}
        aria-label={collapsed ? t('reportBuilder.palette.expand') : t('reportBuilder.palette.collapse')}
        className="mb-1 flex items-center justify-between gap-1 rounded p-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-accent"
      >
        {!collapsed && <span>{t('reportBuilder.palette.heading')}</span>}
        {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </button>
      {KINDS.map((kind) => <PaletteItem key={kind} kind={kind} collapsed={collapsed} onAdd={onAdd} />)}
    </div>
  );
}
```

Note: `collapsed`/`onToggle` are optional (default false / noop) so the pre-existing `<BlockPalette onAdd={…} />` tests still compile. If any pre-existing BlockPalette test asserts the old `⋮⋮` glyph, update it to assert the block label (via `aria-label`/text) instead — the drag handle glyph is replaced by a per-kind icon.

- [ ] **Step 9: Run to confirm PASS**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/BlockPalette.test.tsx`
Expected: PASS (new cases + pre-existing palette tests).

- [ ] **Step 10: Wire the collapsible palette into `ReportBuilderPage.tsx`**

Add the imports near the other reports-builder imports:
```tsx
import { usePersistedToggle } from './usePersistedToggle';
```
Inside the component body (near the other `useState` hooks), add:
```tsx
  const [paletteCollapsed, togglePalette] = usePersistedToggle('openldr-rb-palette-collapsed');
```
Replace the palette wrapper div:
```tsx
            <div className="w-40 shrink-0 border-r border-border overflow-y-auto"><BlockPalette onAdd={addBlock} /></div>
```
with:
```tsx
            <div className={`${paletteCollapsed ? 'w-12' : 'w-40'} shrink-0 border-r border-border overflow-y-auto`}><BlockPalette collapsed={paletteCollapsed} onToggle={togglePalette} onAdd={addBlock} /></div>
```

- [ ] **Step 11: Typecheck + reports-builder suite**

Run: `pnpm --filter @openldr/studio exec tsc --noEmit` then `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ src/i18n/`
Expected: tsc clean (EnShape parity holds); reports-builder + i18n suites green.

- [ ] **Step 12: Commit**

```bash
git add apps/studio/src/reports-builder/usePersistedToggle.ts apps/studio/src/reports-builder/usePersistedToggle.test.ts apps/studio/src/reports-builder/BlockPalette.tsx apps/studio/src/reports-builder/BlockPalette.test.tsx apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): collapsible block palette (icon-rail) in the report builder"
```

---

## Task 2: `ReportSettings` panel (never-blank right pane)

**Files:**
- Create: `apps/studio/src/reports-builder/ReportSettings.tsx`, `apps/studio/src/reports-builder/ReportSettings.test.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`, `apps/studio/src/i18n/{en,fr,pt}.ts`

- [ ] **Step 1: Add settings i18n keys**

In `apps/studio/src/i18n/en.ts`, inside `reportBuilder` (as a sibling of `palette`, `inspector`, `settings` — add a NEW `settings` object; if `reportBuilder.settings` already exists from another feature, MERGE these keys in):
```ts
    settings: {
      heading: 'Report settings',
      pageSize: 'Page size',
      orientation: 'Orientation',
      portrait: 'Portrait',
      landscape: 'Landscape',
      margins: 'Margins',
      top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left',
      parameters: 'Parameters',
    },
```
`fr.ts` `reportBuilder.settings`:
```ts
    settings: {
      heading: 'Paramètres du rapport',
      pageSize: 'Taille de page', orientation: 'Orientation',
      portrait: 'Portrait', landscape: 'Paysage',
      margins: 'Marges', top: 'Haut', right: 'Droite', bottom: 'Bas', left: 'Gauche',
      parameters: 'Paramètres',
    },
```
`pt.ts` `reportBuilder.settings`:
```ts
    settings: {
      heading: 'Definições do relatório',
      pageSize: 'Tamanho da página', orientation: 'Orientação',
      portrait: 'Retrato', landscape: 'Paisagem',
      margins: 'Margens', top: 'Superior', right: 'Direita', bottom: 'Inferior', left: 'Esquerda',
      parameters: 'Parâmetros',
    },
```

- [ ] **Step 2: Write the failing test** — create `apps/studio/src/reports-builder/ReportSettings.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportSettings } from './ReportSettings';

const page = { size: 'A4' as const, orientation: 'portrait' as const, margins: { top: 40, right: 40, bottom: 40, left: 40 } };

describe('ReportSettings', () => {
  it('changes page size', () => {
    const onPatch = vi.fn();
    render(<ReportSettings page={page} onPatch={onPatch} onOpenParams={() => {}} />);
    fireEvent.change(screen.getByLabelText(/page size/i), { target: { value: 'Letter' } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ size: 'Letter' }));
  });
  it('toggles orientation to landscape', () => {
    const onPatch = vi.fn();
    render(<ReportSettings page={page} onPatch={onPatch} onOpenParams={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /landscape/i }));
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ orientation: 'landscape' }));
  });
  it('edits the top margin', () => {
    const onPatch = vi.fn();
    render(<ReportSettings page={page} onPatch={onPatch} onOpenParams={() => {}} />);
    fireEvent.change(screen.getByLabelText(/top/i), { target: { value: '20' } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ margins: expect.objectContaining({ top: 20 }) }));
  });
  it('opens parameters', () => {
    const onOpenParams = vi.fn();
    render(<ReportSettings page={page} onPatch={() => {}} onOpenParams={onOpenParams} />);
    fireEvent.click(screen.getByRole('button', { name: /parameters/i }));
    expect(onOpenParams).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to confirm FAIL**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportSettings.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Create `ReportSettings.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PageSpec } from '@openldr/report-builder/pure';

export function ReportSettings({ page, onPatch, onOpenParams }: { page: PageSpec; onPatch: (page: PageSpec) => void; onOpenParams: () => void }): JSX.Element {
  const { t } = useTranslation();
  const setMargin = (side: keyof PageSpec['margins'], v: number) => onPatch({ ...page, margins: { ...page.margins, [side]: v } });
  return (
    <div className="flex flex-col gap-3 p-4 text-xs">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportBuilder.settings.heading')}</div>
      <label className="flex flex-col gap-1">{t('reportBuilder.settings.pageSize')}
        <select aria-label={t('reportBuilder.settings.pageSize')} className="h-7 rounded border border-border bg-background text-xs"
          value={page.size} onChange={(e) => onPatch({ ...page, size: e.target.value as PageSpec['size'] })}>
          <option value="A4">A4</option>
          <option value="Letter">Letter</option>
        </select>
      </label>
      <div className="flex flex-col gap-1">{t('reportBuilder.settings.orientation')}
        <div className="flex gap-1">
          {(['portrait', 'landscape'] as const).map((o) => (
            <Button key={o} type="button" size="sm" variant={page.orientation === o ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onPatch({ ...page, orientation: o })}>{t(`reportBuilder.settings.${o}`)}</Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">{t('reportBuilder.settings.margins')}
        <div className="grid grid-cols-2 gap-1">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <label key={side} className="flex items-center gap-1 text-[11px] text-muted-foreground">{t(`reportBuilder.settings.${side}`)}
              <Input aria-label={t(`reportBuilder.settings.${side}`)} type="number" className="h-7 text-xs" value={page.margins[side]} onChange={(e) => setMargin(side, Number(e.target.value))} />
            </label>
          ))}
        </div>
      </div>
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={onOpenParams}>{t('reportBuilder.settings.parameters')}</Button>
    </div>
  );
}
```

- [ ] **Step 5: Run to confirm PASS**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportSettings.test.tsx`
Expected: PASS (4 cases).

- [ ] **Step 6: Wire `ReportSettings` into the idle right pane in `ReportBuilderPage.tsx`**

Add imports:
```tsx
import { ReportSettings } from './ReportSettings';
import type { PageSpec } from '@openldr/report-builder/pure';
```
Replace the placeholder else branch:
```tsx
              ) : (
                <div className="p-4 text-xs text-muted-foreground">{t('reportBuilder.inspector.selectHint')}</div>
              )}
```
with:
```tsx
              ) : (
                <ReportSettings page={template.page as PageSpec} onPatch={(page) => update({ ...template, page })} onOpenParams={() => setParamsOpen(true)} />
              )}
```
(`update` and `setParamsOpen` already exist in the component. The `reportBuilder.inspector.selectHint` i18n key is now unused but left in place — removing it is optional and out of scope.)

- [ ] **Step 7: Typecheck + suite**

Run: `pnpm --filter @openldr/studio exec tsc --noEmit` then `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ src/i18n/`
Expected: tsc clean; suites green.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/reports-builder/ReportSettings.tsx apps/studio/src/reports-builder/ReportSettings.test.tsx apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): report builder right pane shows Report settings when idle (never blank)"
```

---

## Task 3: `InspectorPane` (collapsible right pane) + auto-expand on select

**Files:**
- Create: `apps/studio/src/reports-builder/InspectorPane.tsx`, `apps/studio/src/reports-builder/InspectorPane.test.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`, `apps/studio/src/i18n/{en,fr,pt}.ts`

- [ ] **Step 1: Add inspector collapse i18n keys**

In `apps/studio/src/i18n/en.ts`, inside the existing `reportBuilder.inspector` object, add:
```ts
      collapse: 'Collapse panel',
      expand: 'Expand panel',
```
`fr.ts` `reportBuilder.inspector`:
```ts
      collapse: 'Réduire le panneau',
      expand: 'Développer le panneau',
```
`pt.ts` `reportBuilder.inspector`:
```ts
      collapse: 'Recolher painel',
      expand: 'Expandir painel',
```

- [ ] **Step 2: Write the failing test** — create `apps/studio/src/reports-builder/InspectorPane.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InspectorPane } from './InspectorPane';

describe('InspectorPane', () => {
  it('renders children when expanded', () => {
    render(<InspectorPane collapsed={false} onToggle={() => {}}><div>PANE BODY</div></InspectorPane>);
    expect(screen.getByText('PANE BODY')).toBeInTheDocument();
  });
  it('hides children and shows an expand control when collapsed', () => {
    render(<InspectorPane collapsed onToggle={() => {}}><div>PANE BODY</div></InspectorPane>);
    expect(screen.queryByText('PANE BODY')).toBeNull();
    expect(screen.getByRole('button', { name: /expand panel/i })).toBeInTheDocument();
  });
  it('the toggle calls onToggle', () => {
    const onToggle = vi.fn();
    render(<InspectorPane collapsed onToggle={onToggle}><div>x</div></InspectorPane>);
    fireEvent.click(screen.getByRole('button', { name: /expand panel/i }));
    expect(onToggle).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to confirm FAIL**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/InspectorPane.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Create `InspectorPane.tsx`**

```tsx
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

export function InspectorPane({ collapsed, onToggle, children }: { collapsed: boolean; onToggle: () => void; children: ReactNode }): JSX.Element {
  const { t } = useTranslation();
  if (collapsed) {
    return (
      <div className="w-8 shrink-0 border-l border-border">
        <button type="button" onClick={onToggle} aria-label={t('reportBuilder.inspector.expand')} className="flex w-full items-center justify-center p-2 text-muted-foreground hover:bg-accent">
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex w-64 shrink-0 flex-col overflow-hidden border-l border-border">
      <div className="flex shrink-0 justify-end border-b border-border p-1">
        <button type="button" onClick={onToggle} aria-label={t('reportBuilder.inspector.collapse')} className="rounded p-1 text-muted-foreground hover:bg-accent">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: Run to confirm PASS**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/InspectorPane.test.tsx`
Expected: PASS (3 cases).

- [ ] **Step 6: Wire `InspectorPane` into `ReportBuilderPage.tsx` + auto-expand**

Add the import:
```tsx
import { InspectorPane } from './InspectorPane';
```
Ensure `useEffect` is imported from `react` (add it to the existing react import if missing).
Add the inspector-collapse pref next to the palette one (use the 3-arg form for the setter):
```tsx
  const [inspectorCollapsed, toggleInspector, setInspectorCollapsed] = usePersistedToggle('openldr-rb-inspector-collapsed');
```
Auto-expand when a block is selected (add near the other effects):
```tsx
  // Selecting a block auto-expands the (possibly collapsed) inspector so it can be edited.
  useEffect(() => { if (selected) setInspectorCollapsed(false); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
```
Replace the right-pane wrapper div (the whole `<div className="w-64 shrink-0 border-l border-border overflow-y-auto"> … </div>` block) so `InspectorPane` owns the width/border/scroll and wraps the existing content:
```tsx
            <InspectorPane collapsed={inspectorCollapsed} onToggle={toggleInspector}>
              {selectedBlock && selected ? (
                <BlockInspector
                  block={selectedBlock}
                  parameters={template.parameters}
                  sqlEnabled={sqlEnabled}
                  colSpan={template.rows[selected.row].cells[selected.cell].colSpan}
                  onPatchBlock={(patch) => update(updateBlockAt(template, selected.row, selected.cell, patch))}
                  onSetColSpan={(n) => update(setColSpan(template, selected.row, selected.cell, n))}
                  canMoveUp={selected.row > 0}
                  canMoveDown={selected.row < template.rows.length - 1}
                  onMoveUp={() => { pushUpdate(moveRow(template, selected.row, selected.row - 1)); setSelected({ row: selected.row - 1, cell: selected.cell }); }}
                  onMoveDown={() => { pushUpdate(moveRow(template, selected.row, selected.row + 1)); setSelected({ row: selected.row + 1, cell: selected.cell }); }}
                  repeat={template.rows[selected.row].repeat}
                  onSetRepeat={(v) => pushUpdate(setRepeat(template, selected.row, v))}
                  onDuplicate={() => { pushUpdate(duplicateRow(template, selected.row)); setSelected({ row: selected.row + 1, cell: selected.cell }); }}
                  onDelete={() => { pushUpdate(removeCell(template, selected.row, selected.cell)); setSelected(null); }}
                />
              ) : (
                <ReportSettings page={template.page as PageSpec} onPatch={(page) => update({ ...template, page })} onOpenParams={() => setParamsOpen(true)} />
              )}
            </InspectorPane>
```
(This preserves every existing `BlockInspector` prop verbatim — only the wrapping `<div>` is replaced by `<InspectorPane>`. The `InspectorPane` now provides the border/width/scroll the old div had.)

- [ ] **Step 7: Typecheck + reports-builder + i18n suites**

Run: `pnpm --filter @openldr/studio exec tsc --noEmit` then `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ src/i18n/`
Expected: tsc clean; all reports-builder suites green (including the pre-existing `ReportBuilderPage.test.tsx` — the `InspectorPane` wrapper preserves the inspector content it asserts).

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/reports-builder/InspectorPane.tsx apps/studio/src/reports-builder/InspectorPane.test.tsx apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): collapsible report-builder inspector pane (auto-expands on block select)"
```

---

## Task 4: Full-workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Forced typecheck across all packages**

Run: `pnpm turbo run typecheck --force`
Expected: 31/31 packages PASS. Do NOT pipe through `tail`. (Studio-only change, but the i18n `EnShape` typing is enforced.)

- [ ] **Step 2: Forced full test run**

Run: `pnpm turbo run test --force`
Expected: PASS. Two pre-existing flakes are NOT regressions: `apps/studio/src/api.test.ts > "includes server error messages…"` (vitest-dedupe, red on `main` identically) and packages timing out under the 30-package parallel run (re-run any failing file with `pnpm --filter <pkg> exec vitest run <file>` to confirm it passes in isolation). Any OTHER failure must be fixed.

- [ ] **Step 3: Confirm the studio reports-builder suite is clean**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ src/i18n/`
Expected: all green.

- [ ] **Step 4: Final commit (only if a gate fixup was needed)**

```bash
git add -A
git commit -m "chore(report-builder): layout/space gate — forced typecheck + full test green"
```

If Steps 1–3 required no fixups, skip this commit.

---

## Done criteria

- The block palette collapses to an icon-rail (drag-to-canvas + click-to-add preserved) and the state persists.
- The right pane is never blank: it shows Report settings (page size/orientation/margins + Parameters) when nothing is selected, and `BlockInspector` when a block is; page-setting edits patch the template.
- The right pane collapses to a thin rail on demand (persisted) and auto-expands when a block is selected.
- Forced 31-package typecheck + full test green (modulo the two documented pre-existing flakes).

## Manual verification (post-merge)

In the running builder (dark + light): collapse/expand the palette (icons still add blocks); with nothing selected the right pane shows Report settings; collapse the right pane (canvas widens); select a block → the pane auto-expands to the inspector.

## Follow-ups (later slices, per the agreed sequence)

- Starter-template gallery + wider report chart types (reuse dashboards renderers).
- Visual/nested query builder (adopt react-awesome-query-builder; query-model flat-filters → condition tree).
