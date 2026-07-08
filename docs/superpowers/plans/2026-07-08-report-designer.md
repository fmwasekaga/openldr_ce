# Report Designer (looks-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new top-level **Report Designer** page — the visual shell of a free-form, absolute-positioning printable-report designer — with mock data and real interaction chrome, but no backend/persistence/export wiring.

**Architecture:** A self-contained `apps/studio/src/report-designer/` module mirroring the `query/` folder layout. A pure model layer (`types.ts`, `model.ts`, `mockTemplates.ts`) drives four presentational React units (TemplatesExplorer, CanvasHeader, PageCanvas, InspectorTabs) composed by `ReportDesignerPage`. All template state is local React state seeded from mock data; selection, zoom, collapse, insert, and new-template are live in-memory interactions. Data fetch, drag/resize, real PDF/Excel export, legibility lint, and persistence are explicitly deferred (see spec §8).

**Tech Stack:** React + TypeScript, react-router-dom, react-i18next (en/fr/pt with `EnShape` parity), Tailwind + shadcn/ui primitives (`Button`, `Input`, `DropdownMenu`), lucide-react icons, Vitest + @testing-library/react (jsdom, `setupTests.ts` already imports `@/i18n` so `t()` returns English in tests and polyfills Radix pointer-capture).

**Reference spec:** `docs/superpowers/specs/2026-07-08-report-designer-design.md`
**Paradigm to port later:** `D:\Projects\Repositories\database_reporter\apps\web\src\pages\DesignerPage.tsx`

---

## File Structure

All new files under `apps/studio/src/report-designer/` unless noted.

| File | Responsibility |
|------|----------------|
| `types.ts` | Domain types: `ElementKind`, `Rect`, `DesignElement`, `DesignPage`, `Paper`, `Orientation`, `ReportTemplate`. |
| `model.ts` | Pure helpers: `PAPER_PX`, `paperSize`, `ELEMENT_KINDS`, `newElement`, `addElement`, `reportsOnPage`, `findElement`. No React. |
| `mockTemplates.ts` | Seed `MOCK_TEMPLATES` so the shell reads correctly with no backend. |
| `TemplatesExplorer.tsx` | Left pane: search + New + flat template card list (+ collapse trigger). |
| `CanvasHeader.tsx` | Canvas header: name input, `Insert ▾` menu, zoom stepper, Preview, `⋯` kebab menu. |
| `PageCanvas.tsx` | Center: neutral backdrop, printable page(s), absolutely-positioned elements, selection outline + handles. |
| `InspectorTabs.tsx` | Right pane tab container (Properties / Layers / Data). |
| `PropertiesTab.tsx` | Selected-element fields, or page settings when nothing selected. |
| `LayersTab.tsx` | z-ordered element list, click-to-select. |
| `DataTab.tsx` | Reports bound on the page + their parameters. |
| `ReportDesignerPage.tsx` | Top-level shell: AppShell + 3-column layout, owns template/selection/zoom/collapse state. |
| Modify `apps/studio/src/App.tsx` | Register `/report-designer` route. |
| Modify `apps/studio/src/shell/AppShell.tsx` | Add nav item. |
| Modify `apps/studio/src/i18n/{en,fr,pt}.ts` | `nav.reportDesigner` + `reportDesigner` namespace. |

Tests colocated: `model.test.ts`, `TemplatesExplorer.test.tsx`, `CanvasHeader.test.tsx`, `PageCanvas.test.tsx`, `InspectorTabs.test.tsx`, `ReportDesignerPage.test.tsx`.

**Test command convention:** `pnpm --filter @openldr/studio exec vitest run <path>` for one file; `pnpm --filter @openldr/studio typecheck` for types.

---

## Task 1: Domain model, mock data, and i18n

**Files:**
- Create: `apps/studio/src/report-designer/types.ts`
- Create: `apps/studio/src/report-designer/model.ts`
- Create: `apps/studio/src/report-designer/mockTemplates.ts`
- Test: `apps/studio/src/report-designer/model.test.ts`
- Modify: `apps/studio/src/i18n/en.ts`, `apps/studio/src/i18n/fr.ts`, `apps/studio/src/i18n/pt.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/report-designer/model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newElement, addElement, reportsOnPage, paperSize, findElement } from './model';
import { MOCK_TEMPLATES } from './mockTemplates';
import type { ReportTemplate } from './types';

describe('report-designer model', () => {
  it('newElement produces a text element with default content', () => {
    const el = newElement('text');
    expect(el.kind).toBe('text');
    expect(el.text).toBe('Text');
    expect(el.rect).toEqual({ x: 48, y: 48, w: 200, h: 80 });
  });

  it('newElement produces a table with columns and sample rows', () => {
    const el = newElement('table');
    expect(el.kind).toBe('table');
    expect(el.columns?.length).toBe(2);
    expect((el.rows ?? []).length).toBeGreaterThan(0);
  });

  it('addElement appends to the given page immutably', () => {
    const tpl: ReportTemplate = { id: 't', name: 'x', paper: 'A4', orientation: 'portrait', pages: [{ id: 'p1', elements: [] }], parameters: [] };
    const next = addElement(tpl, 0, newElement('text'));
    expect(next.pages[0].elements).toHaveLength(1);
    expect(tpl.pages[0].elements).toHaveLength(0);
  });

  it('reportsOnPage returns distinct bound reports from table elements', () => {
    const tpl = MOCK_TEMPLATES[0];
    const reports = reportsOnPage(tpl.pages[0]);
    expect(reports).toContain('AMR resistance');
    expect(new Set(reports).size).toBe(reports.length);
  });

  it('paperSize swaps width/height for landscape', () => {
    const p = paperSize('A4', 'portrait');
    const l = paperSize('A4', 'landscape');
    expect(l.w).toBe(p.h);
    expect(l.h).toBe(p.w);
  });

  it('findElement locates an element by id across pages', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    expect(findElement(tpl, id)?.id).toBe(id);
    expect(findElement(tpl, 'nope')).toBeNull();
  });

  it('MOCK_TEMPLATES seeds at least three templates', () => {
    expect(MOCK_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(MOCK_TEMPLATES[0].pages.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/model.test.ts`
Expected: FAIL — cannot resolve `./model` / `./mockTemplates`.

- [ ] **Step 3: Write `types.ts`**

```ts
export type ElementKind = 'text' | 'table' | 'image' | 'line' | 'rect' | 'datetime';
export type Paper = 'A4' | 'Letter';
export type Orientation = 'portrait' | 'landscape';

export interface Rect { x: number; y: number; w: number; h: number; }

export interface DesignElement {
  id: string;
  kind: ElementKind;
  name: string;
  rect: Rect;
  /** text/datetime content */
  text?: string;
  /** table column headers */
  columns?: string[];
  /** table sample rows (looks-only) */
  rows?: string[][];
  /** table binding label, e.g. "AMR resistance" */
  boundReport?: string;
}

export interface DesignPage { id: string; elements: DesignElement[]; }

export interface TemplateParam { key: string; label: string; value: string; }

export interface ReportTemplate {
  id: string;
  name: string;
  paper: Paper;
  orientation: Orientation;
  pages: DesignPage[];
  parameters: TemplateParam[];
}
```

- [ ] **Step 4: Write `model.ts`**

```ts
import type { DesignElement, DesignPage, ElementKind, Orientation, Paper, ReportTemplate } from './types';

/** Paper sizes in CSS px at 96dpi, portrait. */
export const PAPER_PX: Record<Paper, { w: number; h: number }> = {
  A4: { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
};

export function paperSize(paper: Paper, orientation: Orientation): { w: number; h: number } {
  const b = PAPER_PX[paper];
  return orientation === 'landscape' ? { w: b.h, h: b.w } : b;
}

/** Insertable element kinds, in menu order. */
export const ELEMENT_KINDS: ElementKind[] = ['text', 'table', 'image', 'line', 'rect', 'datetime'];

let seq = 0;
export function newElementId(): string { seq += 1; return `el-${Date.now()}-${seq}`; }

const DEFAULT_NAME: Record<ElementKind, string> = {
  text: 'Text', table: 'Table', image: 'Image', line: 'Line', rect: 'Rectangle', datetime: 'Date/time',
};

export function newElement(kind: ElementKind): DesignElement {
  const id = newElementId();
  const name = DEFAULT_NAME[kind];
  if (kind === 'text') return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 80 }, text: 'Text' };
  if (kind === 'datetime') return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 80 }, text: '{{date}}' };
  if (kind === 'line') return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 2 } };
  if (kind === 'table') return {
    id, kind, name, rect: { x: 48, y: 48, w: 480, h: 160 },
    boundReport: '', columns: ['Column A', 'Column B'], rows: [['—', '—'], ['—', '—']],
  };
  return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 80 } };
}

export function addElement(tpl: ReportTemplate, pageIndex: number, el: DesignElement): ReportTemplate {
  const pages = tpl.pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, el] } : p));
  return { ...tpl, pages };
}

export function reportsOnPage(page: DesignPage): string[] {
  const set = new Set<string>();
  for (const el of page.elements) if (el.kind === 'table' && el.boundReport) set.add(el.boundReport);
  return [...set];
}

export function findElement(tpl: ReportTemplate, id: string | null): DesignElement | null {
  if (!id) return null;
  for (const p of tpl.pages) {
    const e = p.elements.find((x) => x.id === id);
    if (e) return e;
  }
  return null;
}
```

- [ ] **Step 5: Write `mockTemplates.ts`**

```ts
import type { ReportTemplate } from './types';

export const MOCK_TEMPLATES: ReportTemplate[] = [
  {
    id: 'rt-amr-summary',
    name: 'AMR summary',
    paper: 'A4',
    orientation: 'portrait',
    parameters: [
      { key: 'facility', label: 'Facility', value: 'Ndola' },
      { key: 'period', label: 'Period', value: 'Q2 2026' },
    ],
    pages: [
      {
        id: 'rt-amr-summary-p1',
        elements: [
          { id: 'amr-title', kind: 'text', name: 'Title', rect: { x: 48, y: 40, w: 500, h: 28 }, text: 'Antimicrobial resistance summary' },
          { id: 'amr-subtitle', kind: 'text', name: 'Subtitle', rect: { x: 48, y: 74, w: 500, h: 20 }, text: 'Q2 2026 · Ndola reference lab' },
          {
            id: 'amr-table', kind: 'table', name: 'Resistance table', rect: { x: 48, y: 120, w: 560, h: 200 },
            boundReport: 'AMR resistance', columns: ['Organism', '%R', 'n'],
            rows: [['E. coli', '62%', '418'], ['K. pneumoniae', '54%', '203'], ['S. aureus', '31%', '156']],
          },
          { id: 'amr-footer', kind: 'datetime', name: 'Footer date', rect: { x: 48, y: 1060, w: 300, h: 18 }, text: 'Generated {{date}} · Page 1 of 2' },
        ],
      },
      { id: 'rt-amr-summary-p2', elements: [
        { id: 'amr-p2-note', kind: 'text', name: 'Notes', rect: { x: 48, y: 40, w: 500, h: 40 }, text: 'Appendix: methodology' },
      ] },
    ],
  },
  {
    id: 'rt-monthly-caseload',
    name: 'Monthly caseload',
    paper: 'A4',
    orientation: 'portrait',
    parameters: [{ key: 'month', label: 'Month', value: 'June 2026' }],
    pages: [
      { id: 'rt-monthly-caseload-p1', elements: [
        { id: 'cl-title', kind: 'text', name: 'Title', rect: { x: 48, y: 40, w: 500, h: 28 }, text: 'Monthly caseload' },
        { id: 'cl-table', kind: 'table', name: 'Caseload table', rect: { x: 48, y: 100, w: 560, h: 160 }, boundReport: 'Caseload by test', columns: ['Test', 'Count'], rows: [['HIV VL', '1,204'], ['TB', '842']] },
      ] },
    ],
  },
  {
    id: 'rt-lab-tat',
    name: 'Lab TAT',
    paper: 'Letter',
    orientation: 'landscape',
    parameters: [],
    pages: [
      { id: 'rt-lab-tat-p1', elements: [
        { id: 'tat-title', kind: 'text', name: 'Title', rect: { x: 48, y: 40, w: 600, h: 28 }, text: 'Turnaround time' },
        { id: 'tat-table', kind: 'table', name: 'TAT table', rect: { x: 48, y: 100, w: 900, h: 160 }, boundReport: 'TAT by analyte', columns: ['Analyte', 'Median hrs', 'p90'], rows: [['CD4', '18', '42'], ['Chemistry', '6', '20']] },
      ] },
    ],
  },
];
```

- [ ] **Step 6: Add i18n keys — `en.ts`**

In `apps/studio/src/i18n/en.ts`, add to the `nav` object (after `query: 'Query',`):

```ts
    reportDesigner: 'Report Designer',
```

Then add a new top-level `reportDesigner` namespace (place it right after the closing `},` of the `query:` namespace, before `a11y:`):

```ts
  reportDesigner: {
    title: 'Report Designer',
    templates: 'Templates',
    search: 'Search',
    newTemplate: 'New template',
    noTemplates: 'No templates match your search.',
    collapseExplorer: 'Collapse explorer',
    expandExplorer: 'Expand explorer',
    reportName: 'Report name',
    insert: 'Insert',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    preview: 'Preview',
    moreActions: 'More actions',
    save: 'Save',
    exportPdf: 'Export PDF',
    exportExcel: 'Export Excel',
    check: 'Check',
    duplicate: 'Duplicate',
    delete: 'Delete',
    properties: 'Properties',
    layers: 'Layers',
    data: 'Data',
    elementLabel: 'Element',
    pageSettings: 'Page settings',
    paper: 'Paper',
    orientation: 'Orientation',
    boundReport: 'Bound report',
    columns: 'Columns',
    noElements: 'No elements yet.',
    reportsOnPage: 'Reports on this page',
    noReports: 'No reports bound on this page.',
    parameters: 'Parameters',
    noParameters: 'No parameters.',
    ready: 'ready',
    pageOf: 'Page {{n}} of {{total}}',
    emptyTitle: 'Select or create a template',
    emptyBody: 'A template arranges text, images, and report tables on printable pages — then exports to PDF or Excel.',
    element: {
      text: 'Text', table: 'Table', image: 'Image', line: 'Line', rect: 'Rectangle', datetime: 'Date/time',
    },
  },
```

- [ ] **Step 7: Add matching keys — `fr.ts`**

In `apps/studio/src/i18n/fr.ts`, add to `nav` (after `query: ...,`):

```ts
    reportDesigner: 'Concepteur de rapports',
```

And the `reportDesigner` namespace (same position as en):

```ts
  reportDesigner: {
    title: 'Concepteur de rapports',
    templates: 'Modèles',
    search: 'Rechercher',
    newTemplate: 'Nouveau modèle',
    noTemplates: 'Aucun modèle ne correspond à votre recherche.',
    collapseExplorer: 'Réduire l’explorateur',
    expandExplorer: 'Développer l’explorateur',
    reportName: 'Nom du rapport',
    insert: 'Insérer',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    preview: 'Aperçu',
    moreActions: 'Plus d’actions',
    save: 'Enregistrer',
    exportPdf: 'Exporter en PDF',
    exportExcel: 'Exporter en Excel',
    check: 'Vérifier',
    duplicate: 'Dupliquer',
    delete: 'Supprimer',
    properties: 'Propriétés',
    layers: 'Calques',
    data: 'Données',
    elementLabel: 'Élément',
    pageSettings: 'Paramètres de page',
    paper: 'Papier',
    orientation: 'Orientation',
    boundReport: 'Rapport lié',
    columns: 'Colonnes',
    noElements: 'Aucun élément pour l’instant.',
    reportsOnPage: 'Rapports sur cette page',
    noReports: 'Aucun rapport lié sur cette page.',
    parameters: 'Paramètres',
    noParameters: 'Aucun paramètre.',
    ready: 'prêt',
    pageOf: 'Page {{n}} sur {{total}}',
    emptyTitle: 'Sélectionnez ou créez un modèle',
    emptyBody: 'Un modèle organise du texte, des images et des tableaux de rapport sur des pages imprimables, puis les exporte en PDF ou Excel.',
    element: {
      text: 'Texte', table: 'Tableau', image: 'Image', line: 'Ligne', rect: 'Rectangle', datetime: 'Date/heure',
    },
  },
```

- [ ] **Step 8: Add matching keys — `pt.ts`**

In `apps/studio/src/i18n/pt.ts`, add to `nav` (after `query: ...,`):

```ts
    reportDesigner: 'Designer de relatórios',
```

And the namespace:

```ts
  reportDesigner: {
    title: 'Designer de relatórios',
    templates: 'Modelos',
    search: 'Pesquisar',
    newTemplate: 'Novo modelo',
    noTemplates: 'Nenhum modelo corresponde à sua pesquisa.',
    collapseExplorer: 'Recolher explorador',
    expandExplorer: 'Expandir explorador',
    reportName: 'Nome do relatório',
    insert: 'Inserir',
    zoomIn: 'Ampliar',
    zoomOut: 'Reduzir',
    preview: 'Pré-visualizar',
    moreActions: 'Mais ações',
    save: 'Guardar',
    exportPdf: 'Exportar PDF',
    exportExcel: 'Exportar Excel',
    check: 'Verificar',
    duplicate: 'Duplicar',
    delete: 'Eliminar',
    properties: 'Propriedades',
    layers: 'Camadas',
    data: 'Dados',
    elementLabel: 'Elemento',
    pageSettings: 'Configurações da página',
    paper: 'Papel',
    orientation: 'Orientação',
    boundReport: 'Relatório associado',
    columns: 'Colunas',
    noElements: 'Ainda não há elementos.',
    reportsOnPage: 'Relatórios nesta página',
    noReports: 'Nenhum relatório associado a esta página.',
    parameters: 'Parâmetros',
    noParameters: 'Sem parâmetros.',
    ready: 'pronto',
    pageOf: 'Página {{n}} de {{total}}',
    emptyTitle: 'Selecione ou crie um modelo',
    emptyBody: 'Um modelo organiza texto, imagens e tabelas de relatório em páginas imprimíveis — e depois exporta para PDF ou Excel.',
    element: {
      text: 'Texto', table: 'Tabela', image: 'Imagem', line: 'Linha', rect: 'Retângulo', datetime: 'Data/hora',
    },
  },
```

- [ ] **Step 9: Run tests + typecheck to verify pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/model.test.ts`
Expected: PASS (7 tests).

Run: `pnpm --filter @openldr/studio typecheck`
Expected: PASS — proves `fr.ts`/`pt.ts` satisfy `EnShape` (no missing keys). Also run the i18n parity test:
Run: `pnpm --filter @openldr/studio exec vitest run src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/studio/src/report-designer/types.ts apps/studio/src/report-designer/model.ts apps/studio/src/report-designer/mockTemplates.ts apps/studio/src/report-designer/model.test.ts apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(report-designer): domain model, mock templates, and i18n"
```

---

## Task 2: TemplatesExplorer

**Files:**
- Create: `apps/studio/src/report-designer/TemplatesExplorer.tsx`
- Test: `apps/studio/src/report-designer/TemplatesExplorer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplatesExplorer } from './TemplatesExplorer';
import { MOCK_TEMPLATES } from './mockTemplates';

function setup(overrides = {}) {
  const props = { templates: MOCK_TEMPLATES, selectedId: MOCK_TEMPLATES[0].id, onSelect: vi.fn(), onNew: vi.fn(), onCollapse: vi.fn(), ...overrides };
  render(<TemplatesExplorer {...props} />);
  return props;
}

describe('TemplatesExplorer', () => {
  it('renders the header label and every template name', () => {
    setup();
    expect(screen.getByText('Templates')).toBeInTheDocument();
    expect(screen.getByText('AMR summary')).toBeInTheDocument();
    expect(screen.getByText('Monthly caseload')).toBeInTheDocument();
    expect(screen.getByText('Lab TAT')).toBeInTheDocument();
  });

  it('filters the list by the search query', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'caseload' } });
    expect(screen.getByText('Monthly caseload')).toBeInTheDocument();
    expect(screen.queryByText('AMR summary')).not.toBeInTheDocument();
  });

  it('calls onSelect with the template id when a card is clicked', () => {
    const props = setup();
    fireEvent.click(screen.getByText('Lab TAT'));
    expect(props.onSelect).toHaveBeenCalledWith('rt-lab-tat');
  });

  it('calls onNew and onCollapse from their controls', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /new template/i }));
    expect(props.onNew).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /collapse explorer/i }));
    expect(props.onCollapse).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/TemplatesExplorer.test.tsx`
Expected: FAIL — cannot resolve `./TemplatesExplorer`.

- [ ] **Step 3: Write `TemplatesExplorer.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Plus, PanelLeftClose } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { ReportTemplate } from './types';

interface Props {
  templates: ReportTemplate[];
  selectedId: string | null;
  onSelect(id: string): void;
  onNew(): void;
  onCollapse(): void;
}

export function TemplatesExplorer({ templates, selectedId, onSelect, onNew, onCollapse }: Props): JSX.Element {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const filtered = templates.filter((tpl) => tpl.name.toLowerCase().includes(needle));

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('reportDesigner.templates')}</span>
        <button onClick={onCollapse} className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label={t('reportDesigner.collapseExplorer')} title={t('reportDesigner.collapseExplorer')}>
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('reportDesigner.search')}
            aria-label={t('reportDesigner.search')} className="h-8 pl-7 text-sm" />
        </div>
        <Button size="sm" variant="outline" className="w-full justify-start gap-1.5" onClick={onNew}>
          <Plus className="h-4 w-4" /> {t('reportDesigner.newTemplate')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <div className="flex flex-col gap-1.5">
          {filtered.map((tpl) => {
            const active = tpl.id === selectedId;
            return (
              <button key={tpl.id} onClick={() => onSelect(tpl.id)}
                className={'rounded-md border px-3 py-2 text-left text-sm transition-colors ' +
                  (active ? 'border-primary/40 bg-accent text-accent-foreground' : 'hover:bg-muted')}>
                <div className="font-medium">{tpl.name}</div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {tpl.paper} · {tpl.orientation} · {tpl.pages.length}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-1 py-4 text-xs text-muted-foreground">{t('reportDesigner.noTemplates')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/TemplatesExplorer.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/TemplatesExplorer.tsx apps/studio/src/report-designer/TemplatesExplorer.test.tsx
git commit -m "feat(report-designer): templates explorer (search + flat list)"
```

---

## Task 3: CanvasHeader

**Files:**
- Create: `apps/studio/src/report-designer/CanvasHeader.tsx`
- Test: `apps/studio/src/report-designer/CanvasHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasHeader } from './CanvasHeader';

function setup(overrides = {}) {
  const props = {
    name: 'AMR summary', zoom: 0.75,
    onNameChange: vi.fn(), onInsert: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn(),
    onPreview: vi.fn(), onSave: vi.fn(), onExportPdf: vi.fn(), onExportExcel: vi.fn(),
    onCheck: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), ...overrides,
  };
  render(<CanvasHeader {...props} />);
  return props;
}

describe('CanvasHeader', () => {
  it('shows the report name and zoom percentage', () => {
    setup();
    expect(screen.getByLabelText('Report name')).toHaveValue('AMR summary');
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('inserts a Text element from the Insert menu', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /insert/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    expect(props.onInsert).toHaveBeenCalledWith('text');
  });

  it('fires Save from the kebab menu', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' }));
    expect(props.onSave).toHaveBeenCalled();
  });

  it('steps zoom and previews', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(props.onZoomIn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    expect(props.onPreview).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/CanvasHeader.test.tsx`
Expected: FAIL — cannot resolve `./CanvasHeader`.

- [ ] **Step 3: Write `CanvasHeader.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import {
  Plus, ChevronDown, Minus, Eye, MoreHorizontal,
  Type, Table2, Image as ImageIcon, Square, CalendarClock,
  Save, FileText, FileSpreadsheet, ShieldCheck, Copy, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { ElementKind } from './types';
import { ELEMENT_KINDS } from './model';

const KIND_ICON: Record<ElementKind, typeof Type> = {
  text: Type, table: Table2, image: ImageIcon, line: Minus, rect: Square, datetime: CalendarClock,
};

interface Props {
  name: string;
  zoom: number;
  onNameChange(name: string): void;
  onInsert(kind: ElementKind): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onPreview(): void;
  onSave(): void;
  onExportPdf(): void;
  onExportExcel(): void;
  onCheck(): void;
  onDuplicate(): void;
  onDelete(): void;
}

export function CanvasHeader(props: Props): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <Input value={props.name} onChange={(e) => props.onNameChange(e.target.value)}
        aria-label={t('reportDesigner.reportName')} className="h-8 max-w-xs text-sm font-medium" />

      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1">
              <Plus className="h-4 w-4" /> {t('reportDesigner.insert')} <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {ELEMENT_KINDS.map((kind) => {
              const Icon = KIND_ICON[kind];
              return (
                <DropdownMenuItem key={kind} onSelect={() => props.onInsert(kind)}>
                  <Icon className="mr-2 h-4 w-4" /> {t(`reportDesigner.element.${kind}`)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center rounded-md border border-border">
          <button onClick={props.onZoomOut} aria-label={t('reportDesigner.zoomOut')}
            className="rounded-l-md p-1 text-muted-foreground hover:bg-accent">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground">{Math.round(props.zoom * 100)}%</span>
          <button onClick={props.onZoomIn} aria-label={t('reportDesigner.zoomIn')}
            className="rounded-r-md p-1 text-muted-foreground hover:bg-accent">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <Button size="sm" variant="outline" className="gap-1" onClick={props.onPreview}>
          <Eye className="h-4 w-4" /> {t('reportDesigner.preview')}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" aria-label={t('reportDesigner.moreActions')}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={props.onSave}><Save className="mr-2 h-4 w-4" /> {t('reportDesigner.save')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onExportPdf}><FileText className="mr-2 h-4 w-4" /> {t('reportDesigner.exportPdf')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onExportExcel}><FileSpreadsheet className="mr-2 h-4 w-4" /> {t('reportDesigner.exportExcel')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onCheck}><ShieldCheck className="mr-2 h-4 w-4" /> {t('reportDesigner.check')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onDuplicate}><Copy className="mr-2 h-4 w-4" /> {t('reportDesigner.duplicate')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={props.onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> {t('reportDesigner.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/CanvasHeader.test.tsx`
Expected: PASS (4 tests). (Radix menus open in jsdom because `setupTests.ts` polyfills pointer-capture and `scrollIntoView`.)

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/CanvasHeader.tsx apps/studio/src/report-designer/CanvasHeader.test.tsx
git commit -m "feat(report-designer): canvas header with Insert menu, zoom, and kebab actions"
```

---

## Task 4: PageCanvas

**Files:**
- Create: `apps/studio/src/report-designer/PageCanvas.tsx`
- Test: `apps/studio/src/report-designer/PageCanvas.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PageCanvas } from './PageCanvas';
import { MOCK_TEMPLATES } from './mockTemplates';

describe('PageCanvas', () => {
  it('renders every element on the page and the table columns', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedElementId={null} onSelectElement={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Resistance table' })).toBeInTheDocument();
    expect(screen.getByText('Organism')).toBeInTheDocument();
    expect(screen.getByText('E. coli')).toBeInTheDocument();
  });

  it('selects an element on click and deselects on backdrop click', () => {
    const onSelectElement = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedElementId={null} onSelectElement={onSelectElement} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resistance table' }));
    expect(onSelectElement).toHaveBeenCalledWith('amr-table');
    fireEvent.click(screen.getByTestId('page-canvas'));
    expect(onSelectElement).toHaveBeenLastCalledWith(null);
  });

  it('draws four selection handles on the selected element', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedElementId="amr-table" onSelectElement={vi.fn()} />);
    const el = screen.getByTestId('el-amr-table');
    expect(within(el).getAllByTestId('handle')).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/PageCanvas.test.tsx`
Expected: FAIL — cannot resolve `./PageCanvas`.

- [ ] **Step 3: Write `PageCanvas.tsx`**

```tsx
import type { MouseEvent, CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon } from 'lucide-react';
import type { DesignElement, ReportTemplate } from './types';
import { paperSize } from './model';

interface Props {
  template: ReportTemplate;
  zoom: number;
  selectedElementId: string | null;
  onSelectElement(id: string | null): void;
}

export function PageCanvas({ template, zoom, selectedElementId, onSelectElement }: Props): JSX.Element {
  const { t } = useTranslation();
  const size = paperSize(template.paper, template.orientation);
  return (
    <div data-testid="page-canvas" onClick={() => onSelectElement(null)}
      className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto bg-muted/30 p-6">
      {template.pages.map((page, i) => (
        <div key={page.id} className="flex flex-col items-center gap-1.5">
          <div className="relative bg-white shadow-md ring-1 ring-border"
            style={{ width: size.w * zoom, height: size.h * zoom }}>
            {page.elements.map((el) => (
              <ElementBox key={el.id} el={el} zoom={zoom} selected={el.id === selectedElementId}
                onSelect={(e) => { e.stopPropagation(); onSelectElement(el.id); }} />
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {t('reportDesigner.pageOf', { n: i + 1, total: template.pages.length })}
          </span>
        </div>
      ))}
    </div>
  );
}

function ElementBox({ el, zoom, selected, onSelect }: {
  el: DesignElement; zoom: number; selected: boolean; onSelect(e: MouseEvent): void;
}): JSX.Element {
  const style: CSSProperties = { left: el.rect.x * zoom, top: el.rect.y * zoom, width: el.rect.w * zoom, height: el.rect.h * zoom };
  return (
    <div role="button" tabIndex={0} aria-label={el.name} onClick={onSelect} data-testid={`el-${el.id}`}
      className={'absolute cursor-pointer ' + (selected ? 'outline outline-2 outline-offset-2 outline-primary' : '')}
      style={style}>
      <ElementContent el={el} />
      {selected && <Handles />}
    </div>
  );
}

function Handles(): JSX.Element {
  const positions = ['-left-1 -top-1', '-right-1 -top-1', '-left-1 -bottom-1', '-right-1 -bottom-1'];
  return (
    <>
      {positions.map((p) => (
        <span key={p} data-testid="handle" className={`absolute ${p} h-2 w-2 border border-primary bg-white`} />
      ))}
    </>
  );
}

function ElementContent({ el }: { el: DesignElement }): JSX.Element {
  switch (el.kind) {
    case 'text':
    case 'datetime':
      return <div className="h-full w-full overflow-hidden text-[11px] leading-tight text-neutral-800">{el.text}</div>;
    case 'line':
      return <div className="h-px w-full bg-neutral-400" />;
    case 'rect':
      return <div className="h-full w-full border border-neutral-300" />;
    case 'image':
      return (
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

> Note: the printable page deliberately uses fixed `neutral`/`white` colors (it represents paper, not app chrome), so it stays white in dark mode — matching how a real report preview looks.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/PageCanvas.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/PageCanvas.tsx apps/studio/src/report-designer/PageCanvas.test.tsx
git commit -m "feat(report-designer): page canvas with absolute elements and selection handles"
```

---

## Task 5: Inspector tabs (Properties / Layers / Data)

**Files:**
- Create: `apps/studio/src/report-designer/PropertiesTab.tsx`
- Create: `apps/studio/src/report-designer/LayersTab.tsx`
- Create: `apps/studio/src/report-designer/DataTab.tsx`
- Create: `apps/studio/src/report-designer/InspectorTabs.tsx`
- Test: `apps/studio/src/report-designer/InspectorTabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InspectorTabs } from './InspectorTabs';
import { MOCK_TEMPLATES } from './mockTemplates';

const tpl = MOCK_TEMPLATES[0];

describe('InspectorTabs', () => {
  it('shows page settings in Properties when nothing is selected', () => {
    render(<InspectorTabs template={tpl} selectedElementId={null} onSelectElement={vi.fn()} />);
    expect(screen.getByText('Page settings')).toBeInTheDocument();
    expect(screen.getByText('A4')).toBeInTheDocument();
  });

  it('shows element props in Properties when an element is selected', () => {
    render(<InspectorTabs template={tpl} selectedElementId="amr-table" onSelectElement={vi.fn()} />);
    expect(screen.getByText('Bound report')).toBeInTheDocument();
    expect(screen.getByText('AMR resistance')).toBeInTheDocument();
  });

  it('lists elements in Layers and selects one on click', () => {
    const onSelectElement = vi.fn();
    render(<InspectorTabs template={tpl} selectedElementId={null} onSelectElement={onSelectElement} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByRole('button', { name: /Resistance table/ }));
    expect(onSelectElement).toHaveBeenCalledWith('amr-table');
  });

  it('shows bound reports and parameters in Data', () => {
    render(<InspectorTabs template={tpl} selectedElementId={null} onSelectElement={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect(screen.getByText('AMR resistance')).toBeInTheDocument();
    expect(screen.getByText('Facility')).toBeInTheDocument();
    expect(screen.getByText('Ndola')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/InspectorTabs.test.tsx`
Expected: FAIL — cannot resolve `./InspectorTabs`.

- [ ] **Step 3: Write `PropertiesTab.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { GripVertical } from 'lucide-react';
import type { DesignElement, ReportTemplate } from './types';

interface Props { template: ReportTemplate; selected: DesignElement | null; }

function Field({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="flex-1">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex h-8 items-center rounded-md border border-border bg-muted/30 px-2 text-xs">{value}</div>
    </div>
  );
}

export function PropertiesTab({ template, selected }: Props): JSX.Element {
  const { t } = useTranslation();

  if (!selected) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.pageSettings')}</div>
        <Field label={t('reportDesigner.paper')} value={template.paper} />
        <Field label={t('reportDesigner.orientation')} value={template.orientation} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t('reportDesigner.elementLabel')} · {t(`reportDesigner.element.${selected.kind}`)}
      </div>
      <div className="flex gap-2">
        <Field label="X" value={selected.rect.x} />
        <Field label="Y" value={selected.rect.y} />
      </div>
      <div className="flex gap-2">
        <Field label="W" value={selected.rect.w} />
        <Field label="H" value={selected.rect.h} />
      </div>
      {selected.kind === 'table' && (
        <>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.boundReport')}</div>
            <div className="flex h-8 items-center rounded-md border border-border bg-muted/30 px-2 text-xs">{selected.boundReport || '—'}</div>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.columns')}</div>
            <div className="flex flex-col gap-1">
              {(selected.columns ?? []).map((c) => (
                <div key={c} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <GripVertical className="h-3 w-3" /> {c}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `LayersTab.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { Type, Table2, Image as ImageIcon, Minus, Square, CalendarClock } from 'lucide-react';
import type { ElementKind, ReportTemplate } from './types';

const KIND_ICON: Record<ElementKind, typeof Type> = {
  text: Type, table: Table2, image: ImageIcon, line: Minus, rect: Square, datetime: CalendarClock,
};

interface Props {
  template: ReportTemplate;
  selectedElementId: string | null;
  onSelectElement(id: string): void;
}

export function LayersTab({ template, selectedElementId, onSelectElement }: Props): JSX.Element {
  const { t } = useTranslation();
  // topmost (last-painted) element first
  const elements = template.pages.flatMap((p) => p.elements).slice().reverse();
  return (
    <div className="flex flex-col gap-1 p-2">
      {elements.length === 0 && <p className="px-1 py-3 text-xs text-muted-foreground">{t('reportDesigner.noElements')}</p>}
      {elements.map((el) => {
        const Icon = KIND_ICON[el.kind];
        const active = el.id === selectedElementId;
        return (
          <button key={el.id} onClick={() => onSelectElement(el.id)}
            className={'flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs ' +
              (active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}>
            <Icon className="h-3.5 w-3.5" /> <span className="truncate">{el.name}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Write `DataTab.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { Table2, CheckCircle2 } from 'lucide-react';
import type { ReportTemplate } from './types';
import { reportsOnPage } from './model';

interface Props { template: ReportTemplate; }

export function DataTab({ template }: Props): JSX.Element {
  const { t } = useTranslation();
  const reports = [...new Set(template.pages.flatMap((p) => reportsOnPage(p)))];
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.reportsOnPage')}</div>
      {reports.length === 0 && <p className="text-xs text-muted-foreground">{t('reportDesigner.noReports')}</p>}
      {reports.map((r) => (
        <div key={r} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-xs">
          <span className="flex items-center gap-1.5"><Table2 className="h-3.5 w-3.5 text-muted-foreground" /> {r}</span>
          <span className="flex items-center gap-1 text-[10px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {t('reportDesigner.ready')}</span>
        </div>
      ))}

      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.parameters')}</div>
      {template.parameters.length === 0 && <p className="text-xs text-muted-foreground">{t('reportDesigner.noParameters')}</p>}
      {template.parameters.map((pm) => (
        <div key={pm.key}>
          <div className="mb-1 text-[10px] text-muted-foreground">{pm.label}</div>
          <div className="flex h-8 items-center rounded-md border border-border bg-muted/30 px-2 text-xs">{pm.value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Write `InspectorTabs.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesignElement, ReportTemplate } from './types';
import { findElement } from './model';
import { PropertiesTab } from './PropertiesTab';
import { LayersTab } from './LayersTab';
import { DataTab } from './DataTab';

type TabKey = 'properties' | 'layers' | 'data';

interface Props {
  template: ReportTemplate;
  selectedElementId: string | null;
  onSelectElement(id: string | null): void;
}

export function InspectorTabs({ template, selectedElementId, onSelectElement }: Props): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('properties');
  const selected: DesignElement | null = findElement(template, selectedElementId);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'properties', label: t('reportDesigner.properties') },
    { key: 'layers', label: t('reportDesigner.layers') },
    { key: 'data', label: t('reportDesigner.data') },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 border-b border-border bg-muted/40">
        {tabs.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={'flex flex-1 items-center justify-center text-[11px] font-medium uppercase tracking-wide ' +
              (tab === tb.key ? 'border-b-2 border-foreground text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {tb.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'properties' && <PropertiesTab template={template} selected={selected} />}
        {tab === 'layers' && <LayersTab template={template} selectedElementId={selectedElementId} onSelectElement={onSelectElement} />}
        {tab === 'data' && <DataTab template={template} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/InspectorTabs.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/report-designer/PropertiesTab.tsx apps/studio/src/report-designer/LayersTab.tsx apps/studio/src/report-designer/DataTab.tsx apps/studio/src/report-designer/InspectorTabs.tsx apps/studio/src/report-designer/InspectorTabs.test.tsx
git commit -m "feat(report-designer): inspector tabs (properties, layers, data)"
```

---

## Task 6: ReportDesignerPage shell

**Files:**
- Create: `apps/studio/src/report-designer/ReportDesignerPage.tsx`
- Test: `apps/studio/src/report-designer/ReportDesignerPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportDesignerPage } from './ReportDesignerPage';

function renderPage() {
  return render(<MemoryRouter><ReportDesignerPage /></MemoryRouter>);
}

describe('ReportDesignerPage', () => {
  it('renders explorer, canvas header for the first template, and inspector', () => {
    renderPage();
    expect(screen.getByTestId('templates-explorer')).toBeInTheDocument();
    expect(screen.getByLabelText('Report name')).toHaveValue('AMR summary');
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
  });

  it('collapses the explorer to a rail', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /collapse explorer/i }));
    expect(screen.queryByTestId('templates-explorer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand explorer/i })).toBeInTheDocument();
  });

  it('switches the open template when another card is selected', () => {
    renderPage();
    fireEvent.click(screen.getByText('Lab TAT'));
    expect(screen.getByLabelText('Report name')).toHaveValue('Lab TAT');
  });

  it('inserts a Text element which then appears in the Layers list', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /insert/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    fireEvent.click(within(screen.getByTestId('inspector')).getByRole('button', { name: 'Layers' }));
    // mock AMR page 1 already has a "Title" text element; inserting adds another "Text" layer
    expect(within(screen.getByTestId('inspector')).getByRole('button', { name: /^Text$/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/ReportDesignerPage.test.tsx`
Expected: FAIL — cannot resolve `./ReportDesignerPage`.

- [ ] **Step 3: Write `ReportDesignerPage.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Frame, PanelLeftOpen } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { TemplatesExplorer } from './TemplatesExplorer';
import { CanvasHeader } from './CanvasHeader';
import { PageCanvas } from './PageCanvas';
import { InspectorTabs } from './InspectorTabs';
import { MOCK_TEMPLATES } from './mockTemplates';
import { addElement, newElement } from './model';
import type { ElementKind, ReportTemplate } from './types';

const ZOOMS = [0.5, 0.75, 1, 1.25];

function noop(): void { /* wired to real actions in a later port */ }

export function ReportDesignerPage(): JSX.Element {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<ReportTemplate[]>(MOCK_TEMPLATES);
  const [selectedId, setSelectedId] = useState<string | null>(MOCK_TEMPLATES[0]?.id ?? null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.75);
  const [collapsed, setCollapsed] = useState(false);

  const template = templates.find((tpl) => tpl.id === selectedId) ?? null;
  const patchTemplate = (next: ReportTemplate) =>
    setTemplates((ts) => ts.map((tpl) => (tpl.id === next.id ? next : tpl)));

  const zoomStep = (dir: 1 | -1) => {
    const idx = ZOOMS.indexOf(zoom);
    const base = idx < 0 ? 1 : idx;
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, base + dir))]);
  };

  const insert = (kind: ElementKind) => {
    if (!template) return;
    const el = newElement(kind);
    patchTemplate(addElement(template, 0, el));
    setSelectedElementId(el.id);
  };

  const newTemplate = () => {
    const id = `rt-${Date.now()}`;
    const tpl: ReportTemplate = {
      id, name: 'Untitled template', paper: 'A4', orientation: 'portrait',
      pages: [{ id: `${id}-p1`, elements: [] }], parameters: [],
    };
    setTemplates((ts) => [tpl, ...ts]);
    setSelectedId(id);
    setSelectedElementId(null);
  };

  return (
    <AppShell title={t('reportDesigner.title')} fullBleed>
      <div className="flex h-full min-h-0">
        {collapsed ? (
          <div className="flex w-8 shrink-0 flex-col items-center border-r border-border py-2">
            <button onClick={() => setCollapsed(false)} className="rounded p-1 text-muted-foreground hover:bg-accent"
              aria-label={t('reportDesigner.expandExplorer')} title={t('reportDesigner.expandExplorer')}>
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex w-60 shrink-0 flex-col border-r border-border" data-testid="templates-explorer">
            <TemplatesExplorer templates={templates} selectedId={selectedId}
              onSelect={(id) => { setSelectedId(id); setSelectedElementId(null); }}
              onNew={newTemplate} onCollapse={() => setCollapsed(true)} />
          </div>
        )}

        {template ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <CanvasHeader name={template.name} zoom={zoom}
              onNameChange={(name) => patchTemplate({ ...template, name })}
              onInsert={insert} onZoomIn={() => zoomStep(1)} onZoomOut={() => zoomStep(-1)}
              onPreview={noop} onSave={noop} onExportPdf={noop} onExportExcel={noop}
              onCheck={noop} onDuplicate={noop} onDelete={noop} />
            <div className="flex min-h-0 flex-1">
              <PageCanvas template={template} zoom={zoom}
                selectedElementId={selectedElementId} onSelectElement={setSelectedElementId} />
              <div className="w-64 shrink-0 border-l border-border" data-testid="inspector">
                <InspectorTabs template={template} selectedElementId={selectedElementId} onSelectElement={setSelectedElementId} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-muted/30 text-center">
            <Frame className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">{t('reportDesigner.emptyTitle')}</p>
            <p className="max-w-sm text-xs text-muted-foreground">{t('reportDesigner.emptyBody')}</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/ReportDesignerPage.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/ReportDesignerPage.tsx apps/studio/src/report-designer/ReportDesignerPage.test.tsx
git commit -m "feat(report-designer): compose the page shell with live selection, zoom, and insert"
```

---

## Task 7: Wire route + nav

**Files:**
- Modify: `apps/studio/src/App.tsx`
- Modify: `apps/studio/src/shell/AppShell.tsx`

- [ ] **Step 1: Add the route in `App.tsx`**

Add the import alongside the other page imports (near the `ReportBuilderPage` import at line ~17):

```tsx
import { ReportDesignerPage } from './report-designer/ReportDesignerPage';
```

Add the route inside `<Routes>` (place it right after the existing `/reports/builder/:id` route):

```tsx
      <Route path="/report-designer" element={<RequireRole roles={['lab_admin', 'lab_manager']}><ReportDesignerPage /></RequireRole>} />
```

- [ ] **Step 2: Add the nav item in `AppShell.tsx`**

Add `PencilRuler` to the existing `lucide-react` import block (top of file, the multi-line import that already brings in `LayoutDashboard`, `FileText`, etc.):

```tsx
  PencilRuler,
```

Add an entry to the `NAV` array (place it right after the `/reports` entry):

```ts
  { to: '/report-designer', labelKey: 'nav.reportDesigner', end: false, icon: PencilRuler, roles: ['lab_admin', 'lab_manager'] },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: PASS.

- [ ] **Step 4: Run the full report-designer suite + i18n parity**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer src/i18n/parity.test.ts`
Expected: PASS (all report-designer specs + parity).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/App.tsx apps/studio/src/shell/AppShell.tsx
git commit -m "feat(report-designer): register /report-designer route and top-level nav item"
```

---

## Task 8: Full-suite gate + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole studio suite**

Run: `pnpm --filter @openldr/studio test`
Expected: PASS. (Ignore the pre-existing `api.test.ts > "includes server error messages…"` vitest-dedupe flake noted in project memory.)

- [ ] **Step 2: Typecheck the package**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke (dev)**

Start the studio dev server (`pnpm --filter @openldr/studio dev`), sign in as a `lab_admin`/`lab_manager` (dev bypass = dev-admin), and confirm:
- "Report Designer" appears in the left nav and routes to `/report-designer`.
- Templates list shows the three seeds; search filters; "New template" adds an empty one and selects it.
- Collapsing/expanding the explorer works like `/query`.
- `Insert ▾` adds each element kind to the page; the new element is selected and shows corner handles; clicking the backdrop deselects.
- Right panel: Properties reflects selection (page settings when none), Layers lists elements and selects on click, Data shows bound reports + parameters.
- The `⋯` kebab opens with Save / Export PDF / Export Excel / Check / Duplicate / Delete (actions are intentionally no-ops this pass).

- [ ] **Step 4: (Optional) merge to local `main`**

Per project convention, integrate the finished slice into local `main` with `--no-ff` (do not push unless a fresh-install test is wanted):

```bash
git checkout main
git merge --no-ff -m "feat(report-designer): looks-first free-form page designer page" <feature-branch>
```

---

## Self-Review

**Spec coverage:**
- §2 route/nav/shell → Tasks 6 (shell), 7 (route + nav). ✓
- §3 Templates flat-list + search + collapse → Task 2 + Task 6 rail. ✓
- §4 canvas header (name, Insert ▾, zoom, Preview, ⋯ kebab) + page/elements/selection → Tasks 3, 4. ✓
- §5 three inspector tabs (Properties w/ page-settings fallback, Layers, Data) → Task 5. ✓
- §6 empty state → Task 6; loading/error deferred per spec (no fetch). ✓
- §7 component decomposition mirrors the file table exactly. ✓
- §8 out-of-scope (persistence, drag/resize, real export, lint, convergence) → actions are `noop`, no API imports, drag not implemented. ✓
- i18n en/fr/pt parity (EnShape) → Task 1 steps 6–8 + typecheck/parity gates. ✓

**Placeholder scan:** No "TBD/TODO"; `noop` is real, intentional, scoped code (documented), not a plan gap. Every code step includes complete source. ✓

**Type consistency:** `ReportTemplate`, `DesignElement`, `ElementKind`, `Rect` names are stable across all tasks. Helper names (`newElement`, `addElement`, `reportsOnPage`, `findElement`, `paperSize`, `ELEMENT_KINDS`) match between `model.ts` and every consumer. Component prop names (`selectedElementId`, `onSelectElement`, `onInsert`, `onNameChange`, zoom handlers) are consistent between `ReportDesignerPage` and each child. i18n keys used in components (`reportDesigner.*`, `reportDesigner.element.<kind>`, `reportDesigner.pageOf`) all exist in Task 1. ✓
