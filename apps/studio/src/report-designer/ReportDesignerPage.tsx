import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Frame, PanelLeftOpen } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { useTemplateHistory } from '../forms-builder/useTemplateHistory';
import { TemplatesExplorer } from './TemplatesExplorer';
import { CanvasHeader } from './CanvasHeader';
import { PageCanvas } from './PageCanvas';
import { InspectorTabs } from './InspectorTabs';
import { MOCK_TEMPLATES } from './mockTemplates';
import { addElement, allElements, newElement, paperSize, removeElements, updateElementRects } from './model';
import { clampRectToPage } from './geometry';
import type { ElementKind, Rect, ReportTemplate } from './types';

const ZOOMS = [0.5, 0.75, 1, 1.25];

function noop(): void { /* wired to real actions in a later port */ }

export function ReportDesignerPage(): JSX.Element {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<ReportTemplate[]>(MOCK_TEMPLATES);
  const [selectedId, setSelectedId] = useState<string | null>(MOCK_TEMPLATES[0]?.id ?? null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(0.75);
  const [collapsed, setCollapsed] = useState(false);

  const template = templates.find((tpl) => tpl.id === selectedId) ?? null;

  // Undo/redo history, scoped to the open template (reset whenever the selection changes).
  const history = useTemplateHistory<ReportTemplate>(() => template ?? templates[0]);
  useEffect(() => { if (template) history.reset(template); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedId]);

  const patchTemplate = (next: ReportTemplate) =>
    setTemplates((ts) => ts.map((tpl) => (tpl.id === next.id ? next : tpl)));
  // `updateTemplate` coalesces bursty edits (e.g. typing a name); `pushTemplate` records a discrete step.
  const updateTemplate = (next: ReportTemplate) => { history.recordEdit(); patchTemplate(next); };
  const pushTemplate = (next: ReportTemplate) => { history.pushHistory(); patchTemplate(next); };
  const applyHistory = (next: ReportTemplate | null) => { if (next) patchTemplate(next); };
  const undo = () => applyHistory(history.undo());
  const redo = () => applyHistory(history.redo());

  const commitRects = (rects: Map<string, Rect>) => { if (template) pushTemplate(updateElementRects(template, rects)); };
  const deleteSelected = () => {
    if (!template || selectedIds.length === 0) return;
    pushTemplate(removeElements(template, new Set(selectedIds)));
    setSelectedIds([]);
  };
  const nudge = (dx: number, dy: number) => {
    if (!template || selectedIds.length === 0) return;
    const size = paperSize(template.paper, template.orientation);
    const rects = new Map<string, Rect>();
    for (const el of allElements(template)) if (selectedIds.includes(el.id)) rects.set(el.id, clampRectToPage({ ...el.rect, x: el.rect.x + dx, y: el.rect.y + dy }, size));
    updateTemplate(updateElementRects(template, rects)); // coalesced
  };

  const zoomStep = (dir: 1 | -1) => {
    const idx = ZOOMS.indexOf(zoom);
    const base = idx < 0 ? 1 : idx;
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, base + dir))]);
  };

  const insert = (kind: ElementKind) => {
    if (!template) return;
    const el = newElement(kind);
    pushTemplate(addElement(template, 0, el));
    setSelectedIds([el.id]);
  };

  const newTemplate = () => {
    const id = `rt-${Date.now()}`;
    const tpl: ReportTemplate = {
      id, name: 'Untitled template', paper: 'A4', orientation: 'portrait',
      pages: [{ id: `${id}-p1`, elements: [] }], parameters: [],
    };
    setTemplates((ts) => [tpl, ...ts]);
    setSelectedId(id);
    setSelectedIds([]);
  };

  // Keyboard: undo/redo, select-all, Esc clear, Delete/Backspace remove, arrows nudge (Shift = 10px).
  // Ignore while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      // Bail while a Radix menu handles keys itself (arrow-navigation/Esc) or lives in a [role="menu"].
      if (e.defaultPrevented || (el && el.closest('[role="menu"]'))) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); if (template) setSelectedIds(allElements(template).map((x) => x.id)); return; }
      if (e.key === 'Escape') { setSelectedIds([]); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, selectedIds]);

  // Reconcile selection after undo/redo/delete: drop ids that no longer exist in the template.
  useEffect(() => {
    if (!template) return;
    const present = new Set(allElements(template).map((e) => e.id));
    setSelectedIds((ids) => { const kept = ids.filter((id) => present.has(id)); return kept.length === ids.length ? ids : kept; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

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
              onSelect={(id) => { setSelectedId(id); setSelectedIds([]); }}
              onCollapse={() => setCollapsed(true)} />
          </div>
        )}

        {template ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col">
              <CanvasHeader name={template.name} zoom={zoom}
                onNameChange={(name) => updateTemplate({ ...template, name })}
                onNewTemplate={newTemplate}
                onInsert={insert}
                onUndo={undo} onRedo={redo} canUndo={history.canUndo} canRedo={history.canRedo}
                onZoomIn={() => zoomStep(1)} onZoomOut={() => zoomStep(-1)}
                onPreview={noop} onSave={noop} onExportPdf={noop} onExportExcel={noop}
                onCheck={noop} onDuplicate={noop} onDelete={noop} />
              <PageCanvas template={template} zoom={zoom} selectedIds={selectedIds} onSelect={setSelectedIds} onCommitRects={commitRects} />
            </div>
            <div className="flex w-64 shrink-0 flex-col border-l border-border" data-testid="inspector">
              <InspectorTabs template={template} selectedIds={selectedIds} onSelect={setSelectedIds} />
            </div>
          </>
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
