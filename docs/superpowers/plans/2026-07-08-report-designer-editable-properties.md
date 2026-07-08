# Report Designer — Editable Properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Properties tab a real editor and add element styling — editable geometry, text/line/rect/image styles, table columns, and page paper/orientation/margins — all on the in-memory template through the existing undo history.

**Architecture:** Extend the flat `DesignElement`/`ReportTemplate` model with optional `style`/`src`/`margins` + a pure `updateElement` transform. The canvas renderer (`ElementContent`) applies style with sane defaults; `PageSurface` draws a non-printing margin guide. `PropertiesTab` becomes an editor emitting `onPatchElement`/`onPatchPage` callbacks, which `ReportDesignerPage` routes to `updateTemplate` (coalesced) or `pushTemplate` (discrete). A small `ColorField` (swatch + hex + preset popover) is reused for color inputs.

**Tech Stack:** React + TS, Tailwind/shadcn (`Input`, `Select`, `Textarea`, `Button`, `Popover`, `Switch`), Vitest + @testing-library/react (jsdom; `setupTests.ts` has the PointerEvent polyfill + i18n).

**Reference spec:** `docs/superpowers/specs/2026-07-08-report-designer-editable-properties-design.md`

---

## File Structure

Under `apps/studio/src/report-designer/`:

| File | Change |
|------|--------|
| `types.ts` | Add `TextAlign`, `ElementStyle`, `Margins`; extend `DesignElement` (`style?`, `src?`), `ReportTemplate` (`margins?`). |
| `model.ts` | Add `updateElement`. |
| `mockTemplates.ts` | Add `MOCK_REPORTS` (bound-report options). |
| `PageCanvas.tsx` | `ElementContent` applies style (takes `zoom`); `PageSurface` draws margin guide. |
| `ColorField.tsx` | New — swatch + hex Input + preset popover. |
| `PropertiesTab.tsx` | Rewritten editor (geometry + page in Task 5; per-kind controls in Task 6). |
| `InspectorTabs.tsx` | Thread `onPatchElement`/`onPatchPage`. |
| `ReportDesignerPage.tsx` | Implement `patchElement`/`patchPage` on history; pass down. |
| `i18n/{en,fr,pt}.ts` | New `reportDesigner.*` keys. |

Tests colocated. **Command:** `pnpm --filter @openldr/studio exec vitest run <path>`; typecheck `pnpm --filter @openldr/studio typecheck`.

---

## Task 1: Model — style/margins types + `updateElement`

**Files:** `types.ts`, `model.ts`, `model.test.ts`

- [ ] **Step 1: Failing tests** — append inside `describe('report-designer model', …)` in `model.test.ts`:

```ts
  it('updateElement merges a shallow patch immutably', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    const next = updateElement(tpl, id, { text: 'Hi' });
    expect(next.pages[0].elements[0].text).toBe('Hi');
    expect(tpl.pages[0].elements[0].text).not.toBe('Hi');
  });

  it('updateElement shallow-merges the style object', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    const a = updateElement(tpl, id, { style: { bold: true } });
    const b = updateElement(a, id, { style: { fontSize: 18 } });
    const el = b.pages[0].elements.find((e) => e.id === id)!;
    expect(el.style).toEqual({ bold: true, fontSize: 18 });
  });
```

Add `updateElement` to the model import at the top of `model.test.ts`.

- [ ] **Step 2: Run — FAIL** (`updateElement` not exported)

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/model.test.ts`

- [ ] **Step 3: Extend `types.ts`** — add after `Rect`:

```ts
export type TextAlign = 'left' | 'center' | 'right';

export interface ElementStyle {
  fontSize?: number;
  bold?: boolean;
  align?: TextAlign;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fill?: string;
}

export interface Margins { top: number; right: number; bottom: number; left: number; }
```

Extend `DesignElement` (add after `boundReport?`):

```ts
  /** presentational style (text/line/rect) */
  style?: ElementStyle;
  /** image source (URL or data: URI) */
  src?: string;
```

Extend `ReportTemplate` (add after `parameters`):

```ts
  margins?: Margins;
```

- [ ] **Step 4: Add `updateElement` to `model.ts`**:

```ts
export function updateElement(tpl: ReportTemplate, id: string, patch: Partial<DesignElement>): ReportTemplate {
  return {
    ...tpl,
    pages: tpl.pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) => {
        if (e.id !== id) return e;
        const merged: DesignElement = { ...e, ...patch };
        if (patch.style) merged.style = { ...e.style, ...patch.style };
        return merged;
      }),
    })),
  };
}
```

- [ ] **Step 5: Run — PASS** (12 tests)
- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/report-designer/types.ts apps/studio/src/report-designer/model.ts apps/studio/src/report-designer/model.test.ts
git commit -m "feat(report-designer): element style/src + page margins model + updateElement"
```

---

## Task 2: i18n keys

**Files:** `i18n/en.ts`, `i18n/fr.ts`, `i18n/pt.ts`

- [ ] **Step 1: Add to the `reportDesigner` namespace in `en.ts`** (place after `columns:`):

```ts
    content: 'Content',
    fontSize: 'Size',
    bold: 'Bold',
    alignLeft: 'Align left',
    alignCenter: 'Align center',
    alignRight: 'Align right',
    color: 'Color',
    strokeColor: 'Stroke color',
    strokeWidth: 'Stroke width',
    fill: 'Fill',
    source: 'Source',
    positionSize: 'Position and size',
    margins: 'Margins',
    addColumn: 'Add column',
    removeColumn: 'Remove column',
    none: 'None',
```

- [ ] **Step 2: `fr.ts`** (same position):

```ts
    content: 'Contenu',
    fontSize: 'Taille',
    bold: 'Gras',
    alignLeft: 'Aligner à gauche',
    alignCenter: 'Centrer',
    alignRight: 'Aligner à droite',
    color: 'Couleur',
    strokeColor: 'Couleur du trait',
    strokeWidth: 'Épaisseur du trait',
    fill: 'Remplissage',
    source: 'Source',
    positionSize: 'Position et taille',
    margins: 'Marges',
    addColumn: 'Ajouter une colonne',
    removeColumn: 'Supprimer la colonne',
    none: 'Aucun',
```

- [ ] **Step 3: `pt.ts`** (same position):

```ts
    content: 'Conteúdo',
    fontSize: 'Tamanho',
    bold: 'Negrito',
    alignLeft: 'Alinhar à esquerda',
    alignCenter: 'Centrar',
    alignRight: 'Alinhar à direita',
    color: 'Cor',
    strokeColor: 'Cor do traço',
    strokeWidth: 'Espessura do traço',
    fill: 'Preenchimento',
    source: 'Origem',
    positionSize: 'Posição e tamanho',
    margins: 'Margens',
    addColumn: 'Adicionar coluna',
    removeColumn: 'Remover coluna',
    none: 'Nenhum',
```

- [ ] **Step 4: Verify parity + typecheck**

Run: `pnpm --filter @openldr/studio exec vitest run src/i18n/parity.test.ts` (PASS)
Run: `pnpm --filter @openldr/studio typecheck` (clean — proves fr/pt satisfy `EnShape`)

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(report-designer): i18n keys for the property editor"
```

---

## Task 3: Renderer — apply style + margin guide

**Files:** `PageCanvas.tsx`, `PageCanvas.test.tsx`

- [ ] **Step 1: Failing tests** — append to `PageCanvas.test.tsx`:

```ts
import type { ReportTemplate } from './types';

function tplWith(el: Partial<import('./types').DesignElement> & { id: string; kind: import('./types').ElementKind }, margins?: import('./types').Margins): ReportTemplate {
  return { id: 't', name: 't', paper: 'A4', orientation: 'portrait', parameters: [], margins,
    pages: [{ id: 'p1', elements: [{ name: el.id, rect: { x: 10, y: 10, w: 100, h: 40 }, ...el }] }] };
}

describe('PageCanvas style rendering', () => {
  it('renders a bold, colored, sized text element', () => {
    render(<PageCanvas template={tplWith({ id: 'tx', kind: 'text', text: 'Hi', style: { bold: true, fontSize: 20, color: '#ff0000', align: 'center' } })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    const box = screen.getByText('Hi');
    expect(box).toHaveStyle({ fontWeight: '600', textAlign: 'center' });
  });

  it('renders an image element with a src', () => {
    render(<PageCanvas template={tplWith({ id: 'im', kind: 'image', src: 'http://x/y.png' })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://x/y.png');
  });

  it('renders a page margin guide when margins are set', () => {
    render(<PageCanvas template={tplWith({ id: 'tx', kind: 'text', text: 'Hi' }, { top: 20, right: 20, bottom: 20, left: 20 })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByTestId('margin-guide')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/PageCanvas.test.tsx`

- [ ] **Step 3: Edit `PageCanvas.tsx`**

Thread `margins` into `PageSurface`. In `PageCanvas`, pass it:

```tsx
          <PageSurface page={page} zoom={zoom} pageSize={size} margins={template.margins}
            selectedIds={selectedIds} onSelect={onSelect} onCommitRects={onCommitRects} />
```

Update `PageSurface`'s signature + add the guide. Change the destructure to include `margins`:

```tsx
function PageSurface({ page, zoom, pageSize, margins, selectedIds, onSelect, onCommitRects }: {
  page: DesignPage; zoom: number; pageSize: { w: number; h: number }; margins?: Margins;
  selectedIds: string[]; onSelect(ids: string[]): void; onCommitRects(rects: Map<string, Rect>): void;
}): JSX.Element {
```

Import `Margins`: change the types import to `import type { DesignElement, DesignPage, Margins, Rect, ReportTemplate } from './types';`.

Add the guide just before the closing `</div>` of the surface (after the marquee block):

```tsx
      {margins && (margins.top || margins.right || margins.bottom || margins.left) ? (
        <span aria-hidden data-testid="margin-guide" className="pointer-events-none absolute border border-dashed border-neutral-300"
          style={{ left: margins.left * zoom, top: margins.top * zoom, right: margins.right * zoom, bottom: margins.bottom * zoom }} />
      ) : null}
```

Pass `zoom` to `ElementContent`: in `ElementBox`, change `<ElementContent el={el} />` to `<ElementContent el={el} zoom={zoom} />`.

Replace `ElementContent` with the style-aware version:

```tsx
function ElementContent({ el, zoom }: { el: DesignElement; zoom: number }): JSX.Element {
  const s = el.style ?? {};
  switch (el.kind) {
    case 'text':
    case 'datetime':
      return (
        <div className="h-full w-full overflow-hidden leading-tight"
          style={{ fontSize: (s.fontSize ?? 11) * zoom, fontWeight: s.bold ? 600 : 400, textAlign: s.align ?? 'left', color: s.color ?? '#262626' }}>
          {el.text}
        </div>
      );
    case 'line':
      return <div className="w-full" style={{ height: (s.strokeWidth ?? 1) * zoom, background: s.strokeColor ?? '#a3a3a3' }} />;
    case 'rect':
      return <div className="h-full w-full" style={{ border: `${(s.strokeWidth ?? 1) * zoom}px solid ${s.strokeColor ?? '#d4d4d4'}`, background: s.fill && s.fill !== 'none' ? s.fill : 'transparent' }} />;
    case 'image':
      return el.src
        ? <img src={el.src} alt={el.name} className="h-full w-full object-contain" />
        : (
          <div className="flex h-full w-full items-center justify-center border border-dashed border-neutral-300 text-neutral-400">
            <ImageIcon className="h-4 w-4" />
          </div>
        );
    case 'table':
      return (
        <table className="h-full w-full border-collapse text-[8px] text-neutral-700">
          <thead>
            <tr>{(el.columns ?? []).map((c) => (
              <th key={c} className="border border-neutral-300 bg-neutral-100 px-1 py-0.5 text-left font-medium">{c}</th>
            ))}</tr>
          </thead>
          <tbody>
            {(el.rows ?? []).map((r, ri) => (
              <tr key={ri}>{r.map((cell, ci) => (
                <td key={ci} className="border border-neutral-200 px-1 py-0.5">{cell}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>
      );
  }
}
```

- [ ] **Step 4: Run — PASS** (existing PageCanvas tests + 3 new)
- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/PageCanvas.tsx apps/studio/src/report-designer/PageCanvas.test.tsx
git commit -m "feat(report-designer): render element style and page margin guide"
```

---

## Task 4: `ColorField`

**Files:** `ColorField.tsx`, `ColorField.test.tsx`

- [ ] **Step 1: Failing test** — `ColorField.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorField } from './ColorField';

describe('ColorField', () => {
  it('emits a typed hex value', () => {
    const onChange = vi.fn();
    render(<ColorField value="#000000" onChange={onChange} aria-label="Text color" />);
    fireEvent.change(screen.getByLabelText('Text color hex'), { target: { value: '#ff0000' } });
    expect(onChange).toHaveBeenCalledWith('#ff0000');
  });

  it('emits a preset when a swatch is chosen', () => {
    const onChange = vi.fn();
    render(<ColorField value="#000000" onChange={onChange} aria-label="Text color" />);
    const trigger = screen.getByRole('button', { name: 'Text color' });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    if (!screen.queryByRole('button', { name: '#ef4444' })) fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '#ef4444' }));
    expect(onChange).toHaveBeenCalledWith('#ef4444');
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Write `ColorField.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

const PRESETS = ['#000000', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

interface Props {
  value: string;
  onChange(v: string): void;
  allowNone?: boolean;
  'aria-label'?: string;
}

export function ColorField({ value, onChange, allowNone, 'aria-label': ariaLabel }: Props): JSX.Element {
  const { t } = useTranslation();
  const label = ariaLabel ?? t('reportDesigner.color');
  const isNone = !value || value === 'none';
  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={label}
            className={cn('h-7 w-7 shrink-0 rounded-md border border-border', isNone && 'bg-muted')}
            style={isNone ? undefined : { background: value }} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-40 p-2">
          <div className="grid grid-cols-6 gap-1">
            {PRESETS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => onChange(c)}
                className="h-5 w-5 rounded border border-border" style={{ background: c }} />
            ))}
          </div>
          {allowNone && (
            <button type="button" onClick={() => onChange('none')}
              className="mt-2 w-full rounded border border-border py-1 text-xs text-muted-foreground hover:bg-muted">
              {t('reportDesigner.none')}
            </button>
          )}
        </PopoverContent>
      </Popover>
      <Input aria-label={`${label} hex`} value={isNone ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={allowNone ? t('reportDesigner.none') : '#000000'}
        className="h-7 font-mono text-xs" />
    </div>
  );
}
```

- [ ] **Step 4: Run — PASS.** If the preset test can't open the popover in jsdom, mirror the repo's Radix-open pattern (pointerDown, fallback click/Enter) already used in `dropdown-menu.test.tsx`/`select.test.tsx`; the hex-input test must pass regardless.
- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/ColorField.tsx apps/studio/src/report-designer/ColorField.test.tsx
git commit -m "feat(report-designer): ColorField (swatch + hex + preset popover)"
```

---

## Task 5: Editable geometry + page settings (wiring)

Rewrite `PropertiesTab` for editable geometry (single element) and page settings (nothing selected); thread `onPatchElement`/`onPatchPage` through `InspectorTabs`; implement them in `ReportDesignerPage`. Per-kind style controls come in Task 6.

**Files:** `PropertiesTab.tsx`, `PropertiesTab.test.tsx` (new), `InspectorTabs.tsx`, `ReportDesignerPage.tsx`, `ReportDesignerPage.test.tsx`

- [ ] **Step 1: Failing test** — `PropertiesTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertiesTab } from './PropertiesTab';
import { MOCK_TEMPLATES } from './mockTemplates';

const tpl = MOCK_TEMPLATES[0];
function setup(overrides = {}) {
  const props = { template: tpl, selectedIds: [] as string[], onPatchElement: vi.fn(), onPatchPage: vi.fn(), ...overrides };
  render(<PropertiesTab {...props} />);
  return props;
}

describe('PropertiesTab editing', () => {
  it('shows page settings and edits a margin when nothing is selected', () => {
    const props = setup({ selectedIds: [] });
    expect(screen.getByText('Page settings')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Margin top'), { target: { value: '12' } });
    expect(props.onPatchPage).toHaveBeenCalledWith(expect.objectContaining({ margins: expect.objectContaining({ top: 12 }) }), undefined);
  });

  it('edits X of a selected element (clamped, coalesced)', () => {
    const props = setup({ selectedIds: ['amr-title'] });
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '100' } });
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-title', expect.objectContaining({ rect: expect.objectContaining({ x: 100 }) }), undefined);
  });

  it('shows the count for a multi-selection', () => {
    setup({ selectedIds: ['amr-title', 'amr-table'] });
    expect(screen.getByText('2 elements selected')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — FAIL** (props/labels don't exist yet)

- [ ] **Step 3: Rewrite `PropertiesTab.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { Margins, Orientation, Paper, Rect, ReportTemplate } from './types';
import { findElement, paperSize } from './model';
import { clampRectToPage } from './geometry';

export interface PatchOpts { discrete?: boolean }

interface Props {
  template: ReportTemplate;
  selectedIds: string[];
  onPatchElement(id: string, patch: Partial<import('./types').DesignElement>, opts?: PatchOpts): void;
  onPatchPage(patch: Partial<ReportTemplate>, opts?: PatchOpts): void;
}

function NumberField({ label, value, onChange, min }: { label: string; value: number; onChange(n: number): void; min?: number }): JSX.Element {
  return (
    <div className="flex-1">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <Input type="number" aria-label={label} value={value} min={min}
        onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n) && e.target.value !== '') onChange(n); }}
        className="h-8 text-xs" />
    </div>
  );
}

export function PropertiesTab({ template, selectedIds, onPatchElement, onPatchPage }: Props): JSX.Element {
  const { t } = useTranslation();
  const selected = selectedIds.length === 1 ? findElement(template, selectedIds[0]) : null;
  const size = paperSize(template.paper, template.orientation);

  if (selectedIds.length > 1) {
    return <div className="p-3 text-xs text-muted-foreground">{t('reportDesigner.selectedCount', { count: selectedIds.length })}</div>;
  }

  if (!selected) {
    const m: Margins = template.margins ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const setMargin = (patch: Partial<Margins>) => onPatchPage({ margins: { ...m, ...patch } });
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.pageSettings')}</div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.paper')}</div>
          <Select value={template.paper} onValueChange={(v) => onPatchPage({ paper: v as Paper }, { discrete: true })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="A4">A4</SelectItem><SelectItem value="Letter">Letter</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.orientation')}</div>
          <Select value={template.orientation} onValueChange={(v) => onPatchPage({ orientation: v as Orientation }, { discrete: true })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="portrait">portrait</SelectItem><SelectItem value="landscape">landscape</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.margins')}</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Margin top" value={m.top} onChange={(top) => setMargin({ top })} min={0} />
            <NumberField label="Margin right" value={m.right} onChange={(right) => setMargin({ right })} min={0} />
            <NumberField label="Margin bottom" value={m.bottom} onChange={(bottom) => setMargin({ bottom })} min={0} />
            <NumberField label="Margin left" value={m.left} onChange={(left) => setMargin({ left })} min={0} />
          </div>
        </div>
      </div>
    );
  }

  const setRect = (patch: Partial<Rect>) => onPatchElement(selected.id, { rect: clampRectToPage({ ...selected.rect, ...patch }, size) });
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t('reportDesigner.elementLabel')} · {t(`reportDesigner.element.${selected.kind}`)}
      </div>
      {/* KIND CONTROLS INSERTION POINT (Task 6) */}
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.positionSize')}</div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={selected.rect.x} onChange={(x) => setRect({ x })} />
          <NumberField label="Y" value={selected.rect.y} onChange={(y) => setRect({ y })} />
          <NumberField label="W" value={selected.rect.w} onChange={(w) => setRect({ w })} min={8} />
          <NumberField label="H" value={selected.rect.h} onChange={(h) => setRect({ h })} min={8} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Thread through `InspectorTabs.tsx`** — add to `Props`:

```tsx
  onPatchElement(id: string, patch: Partial<import('./types').DesignElement>, opts?: { discrete?: boolean }): void;
  onPatchPage(patch: Partial<ReportTemplate>, opts?: { discrete?: boolean }): void;
```

Destructure them and pass to `PropertiesTab`:

```tsx
export function InspectorTabs({ template, selectedIds, onSelect, onPatchElement, onPatchPage }: Props): JSX.Element {
```
```tsx
        {tab === 'properties' && <PropertiesTab template={template} selectedIds={selectedIds} onPatchElement={onPatchElement} onPatchPage={onPatchPage} />}
```

- [ ] **Step 5: Implement in `ReportDesignerPage.tsx`** — add `updateElement` to the `./model` import, then add handlers after `nudge`:

```tsx
  const patchElement = (id: string, patch: Partial<import('./types').DesignElement>, opts?: { discrete?: boolean }) => {
    if (!template) return;
    const next = updateElement(template, id, patch);
    if (opts?.discrete) pushTemplate(next); else updateTemplate(next);
  };
  const patchPage = (patch: Partial<ReportTemplate>, opts?: { discrete?: boolean }) => {
    if (!template) return;
    const next = { ...template, ...patch };
    if (opts?.discrete) pushTemplate(next); else updateTemplate(next);
  };
```

Pass to `InspectorTabs`:

```tsx
              <InspectorTabs template={template} selectedIds={selectedIds} onSelect={setSelectedIds}
                onPatchElement={patchElement} onPatchPage={patchPage} />
```

- [ ] **Step 6: Add an integration test** — append to `ReportDesignerPage.test.tsx`:

```tsx
  it('edits a selected element geometry and undo restores it', () => {
    renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    fireEvent.change(within(inspector()).getByLabelText('X'), { target: { value: '200' } });
    expect(within(inspector()).getByLabelText('X')).toHaveValue(200);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48);
  });
```

- [ ] **Step 7: Run + typecheck** — `pnpm --filter @openldr/studio exec vitest run src/report-designer` (PASS), `pnpm --filter @openldr/studio typecheck` (clean).
- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/report-designer/PropertiesTab.tsx apps/studio/src/report-designer/PropertiesTab.test.tsx apps/studio/src/report-designer/InspectorTabs.tsx apps/studio/src/report-designer/ReportDesignerPage.tsx apps/studio/src/report-designer/ReportDesignerPage.test.tsx
git commit -m "feat(report-designer): editable geometry and page settings"
```

---

## Task 6: Per-kind style + content controls

Add the per-kind editor block at the "KIND CONTROLS INSERTION POINT" in `PropertiesTab.tsx`, using `ColorField`.

**Files:** `PropertiesTab.tsx`, `PropertiesTab.test.tsx`, `mockTemplates.ts`

- [ ] **Step 1: Add `MOCK_REPORTS` to `mockTemplates.ts`** (top-level export):

```ts
export const MOCK_REPORTS = ['AMR resistance', 'Caseload by test', 'TAT by analyte'];
```

- [ ] **Step 2: Failing tests** — append to `PropertiesTab.test.tsx`:

```tsx
  it('edits text content (coalesced) and toggles bold (discrete)', () => {
    const props = setup({ selectedIds: ['amr-title'] });
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'New title' } });
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-title', { text: 'New title' }, undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-title', { style: { bold: true } }, { discrete: true });
  });

  it('adds a table column (discrete)', () => {
    const props = setup({ selectedIds: ['amr-table'] });
    fireEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-table', expect.objectContaining({ columns: expect.any(Array) }), { discrete: true });
  });
```

- [ ] **Step 3: Run — FAIL**

- [ ] **Step 4: Add imports to `PropertiesTab.tsx`**:

```tsx
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { AlignLeft, AlignCenter, AlignRight, X } from 'lucide-react';
import { ColorField } from './ColorField';
import { MOCK_REPORTS } from './mockTemplates';
import type { TextAlign } from './types';
```

- [ ] **Step 5: Add a `KindControls` component** (below `NumberField`):

```tsx
function KindControls({ el, onPatch }: {
  el: import('./types').DesignElement;
  onPatch(patch: Partial<import('./types').DesignElement>, opts?: PatchOpts): void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const s = el.style ?? {};
  const style = (patch: Partial<import('./types').ElementStyle>, discrete?: boolean) => onPatch({ style: patch }, discrete ? { discrete: true } : undefined);

  if (el.kind === 'text' || el.kind === 'datetime') {
    const aligns: { v: TextAlign; icon: typeof AlignLeft; label: string }[] = [
      { v: 'left', icon: AlignLeft, label: t('reportDesigner.alignLeft') },
      { v: 'center', icon: AlignCenter, label: t('reportDesigner.alignCenter') },
      { v: 'right', icon: AlignRight, label: t('reportDesigner.alignRight') },
    ];
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.content')}</div>
          <Textarea aria-label={t('reportDesigner.content')} value={el.text ?? ''} onChange={(e) => onPatch({ text: e.target.value })} className="min-h-[44px] text-xs" />
        </div>
        <div className="flex items-end gap-2">
          <NumberField label={t('reportDesigner.fontSize')} value={s.fontSize ?? 11} onChange={(n) => style({ fontSize: n })} min={4} />
          <Button type="button" variant={s.bold ? 'default' : 'outline'} size="icon" className="h-8 w-8 font-bold"
            aria-label={t('reportDesigner.bold')} onClick={() => style({ bold: !s.bold }, true)}>B</Button>
          <div className="flex h-8 rounded-md border border-border">
            {aligns.map(({ v, icon: Icon, label }) => (
              <button key={v} type="button" aria-label={label} onClick={() => style({ align: v }, true)}
                className={cn('flex w-8 items-center justify-center', (s.align ?? 'left') === v ? 'text-foreground' : 'text-muted-foreground')}>
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.color')}</div>
          <ColorField value={s.color ?? '#000000'} onChange={(c) => style({ color: c }, true)} aria-label={t('reportDesigner.color')} />
        </div>
      </div>
    );
  }

  if (el.kind === 'line' || el.kind === 'rect') {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.strokeColor')}</div>
          <ColorField value={s.strokeColor ?? '#9ca3af'} onChange={(c) => style({ strokeColor: c }, true)} aria-label={t('reportDesigner.strokeColor')} />
        </div>
        <NumberField label={t('reportDesigner.strokeWidth')} value={s.strokeWidth ?? 1} onChange={(n) => style({ strokeWidth: n })} min={1} />
        {el.kind === 'rect' && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.fill')}</div>
            <ColorField value={s.fill ?? 'none'} onChange={(c) => style({ fill: c }, true)} allowNone aria-label={t('reportDesigner.fill')} />
          </div>
        )}
      </div>
    );
  }

  if (el.kind === 'image') {
    return (
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.source')}</div>
        <Input aria-label={t('reportDesigner.source')} value={el.src ?? ''} onChange={(e) => onPatch({ src: e.target.value })} placeholder="https://…" className="h-8 text-xs" />
      </div>
    );
  }

  if (el.kind === 'table') {
    const cols = el.columns ?? [];
    const setCols = (next: string[], discrete?: boolean) => onPatch({ columns: next }, discrete ? { discrete: true } : undefined);
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.boundReport')}</div>
          <Select value={el.boundReport || ''} onValueChange={(v) => onPatch({ boundReport: v }, { discrete: true })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{MOCK_REPORTS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.columns')}</div>
          <div className="flex flex-col gap-1">
            {cols.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input aria-label={`Column ${i + 1}`} value={c} onChange={(e) => setCols(cols.map((x, j) => (j === i ? e.target.value : x)))} className="h-7 text-xs" />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  aria-label={t('reportDesigner.removeColumn')} onClick={() => setCols(cols.filter((_, j) => j !== i), true)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-start"
              onClick={() => setCols([...cols, `Column ${cols.length + 1}`], true)}>{t('reportDesigner.addColumn')}</Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 6: Render `KindControls`** at the insertion point in the element branch:

```tsx
      {/* KIND CONTROLS INSERTION POINT (Task 6) */}
      <KindControls el={selected} onPatch={(patch, opts) => onPatchElement(selected.id, patch, opts)} />
```

- [ ] **Step 7: Run — PASS** (all PropertiesTab tests) + typecheck.
- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/report-designer/PropertiesTab.tsx apps/studio/src/report-designer/PropertiesTab.test.tsx apps/studio/src/report-designer/mockTemplates.ts
git commit -m "feat(report-designer): per-kind style, content, and table-column editors"
```

---

## Task 7: Full-suite gate + manual smoke

- [ ] **Step 1: Whole studio suite** — `pnpm --filter @openldr/studio test` (PASS except the known `api.test.ts` flake).
- [ ] **Step 2: Typecheck** — `pnpm --filter @openldr/studio typecheck` (clean).
- [ ] **Step 3: Manual smoke** — start studio, open `/report-designer`, select a text element: change content/size/bold/align/color and see the canvas update; select a rect: set stroke + fill; select an image: paste an image URL; select a table: change bound report + add/rename/remove a column; deselect: change paper/orientation and set margins (dashed guide appears); confirm each edit is undoable and typing coalesces into one undo step.

---

## Self-Review

**Spec coverage:** §2 model → Task 1. §3 renderer (style + margin guide) → Task 3. §4 editor (geometry, per-kind, page) → Tasks 5 (+6). §5 wiring/coalesce-vs-discrete → Task 5. §6 ColorField → Task 4. §8 out-of-scope respected (single-selection editing — multi shows count; panel-only; no table cell styling; margins visual-only). §9 tests → each task. i18n parity → Task 2. ✓

**Placeholder scan:** none — every step has complete code or an exact command. The "KIND CONTROLS INSERTION POINT" comment is a real anchor filled in Task 6, not a gap.

**Type consistency:** `ElementStyle`/`Margins`/`TextAlign` names match across `types.ts`, renderer, and editor. `updateElement(tpl, id, patch)` and the `onPatchElement(id, patch, opts?)` / `onPatchPage(patch, opts?)` signatures are identical across `PropertiesTab`, `InspectorTabs`, and `ReportDesignerPage`. `PatchOpts.discrete` drives `pushTemplate` vs `updateTemplate` consistently. Geometry edits go through `updateElement` (patch `{rect}`), clamped in `PropertiesTab` via `clampRectToPage`.
