import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Frame, PanelLeftOpen } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useTemplateHistory } from '../forms-builder/useTemplateHistory';
import { TemplatesExplorer } from './TemplatesExplorer';
import { CanvasHeader } from './CanvasHeader';
import { PageCanvas } from './PageCanvas';
import { InspectorTabs } from './InspectorTabs';
import { PreviewReportDesignDialog } from './PreviewReportDesignDialog';
import { NewReportSheet } from '../reports/NewReportSheet';
import { createReportDesign, deleteReportDesign, downloadReportDesignPdf, getReportDesign, listReportDesigns, updateReportDesign } from '../api';
import { addElement, allElements, newElement, paperSize, removeElements, updateElement, updateElementRects, updateElements } from './model';
import { clampRectToPage } from './geometry';
import { exportDesignToExcel } from './exportExcel';
import type { ElementKind, Rect, ReportDesign, ReportTemplate } from './types';

const ZOOMS = [0.5, 0.75, 1, 1.25];
const AUTOSAVE_MS = 1200;

/** Autosave / dirty-state of the open design shown in the header. */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

function noop(): void { /* wired to real actions in a later port */ }

/** Replace `d` in the list (matched by id) or prepend it if new. */
function upsert(list: ReportDesign[], d: ReportDesign): ReportDesign[] {
  return list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [d, ...list];
}

/**
 * Stable serialization for dirty-detection: excludes the server-managed `createdAt`/`updatedAt`
 * so a save that returns a fresh `updatedAt` doesn't read back as dirty.
 */
function stableJson(d: ReportDesign): string {
  // Relies on both compared sides being built from the same object shape (so key insertion order
  // matches); not a canonical/sorted serializer.
  return JSON.stringify({ ...d, createdAt: undefined, updatedAt: undefined });
}

export function ReportDesignerPage(): JSX.Element {
  const { t } = useTranslation();
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<ReportDesign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.75);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  // Ids of unsaved (transient) designs created via "New template" — Save creates them server-side.
  const [transientIds, setTransientIds] = useState<Set<string>>(() => new Set());
  // Autosave / dirty-state indicator for the open design.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  // stableJson of the last-persisted state of the OPEN design; compared against the working design to detect edits.
  const savedJsonRef = useRef<string>('');
  // Mirror of `selectedId` readable inside async callbacks — lets a late-resolving autosave tell whether
  // the design it saved is still the open one before it touches the shared savedJsonRef / status.
  const selectedIdRef = useRef<string | null>(null);
  // The last id loaded from / persisted to the API — guards the :id effect from re-loading over local edits.
  const loadedIdRef = useRef<string | null>(null);

  const template = templates.find((tpl) => tpl.id === selectedId) ?? null;

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    setError(msg);
    toast.error(msg);
  };

  // Load the design list on mount.
  useEffect(() => {
    listReportDesigns().then(setTemplates).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Load the design named in the URL when it isn't already the open one.
  useEffect(() => {
    if (!routeId || loadedIdRef.current === routeId) return;
    let cancelled = false;
    void getReportDesign(routeId)
      .then((d) => {
        if (cancelled) return;
        loadedIdRef.current = d.id;
        setTemplates((ts) => upsert(ts, d));
        setSelectedId(d.id);
        setSelectedIds([]);
        setEditingId(null);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  // Undo/redo history, scoped to the open template (reset whenever the selection changes).
  const history = useTemplateHistory<ReportTemplate>(() => template ?? templates[0]);
  useEffect(() => { if (template) history.reset(template); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedId]);

  // Keep the id-mirror ref in step with the open design so async callbacks can guard on it.
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // A freshly-opened/selected design starts clean: snapshot its serialization as the last-saved baseline
  // so subsequent edits (below) are what read as dirty. A transient (never-persisted) design shows "Unsaved".
  useEffect(() => {
    if (!template) return;
    savedJsonRef.current = stableJson(template);
    setSaveStatus(transientIds.has(template.id) ? 'unsaved' : 'saved');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Autosave: debounce edits to the open PERSISTED design, then PUT them. Transient designs are never
  // auto-saved (would create junk rows) — they show "Unsaved" until an explicit Save creates them.
  const dirtyJson = template ? stableJson(template) : null;
  useEffect(() => {
    if (!template || dirtyJson === null) return;
    const isTransient = transientIds.has(template.id);
    if (dirtyJson === savedJsonRef.current) { setSaveStatus(isTransient ? 'unsaved' : 'saved'); return; }
    // The working design differs from the last-saved snapshot → dirty.
    if (isTransient) { setSaveStatus('unsaved'); return; }
    setSaveStatus('unsaved');
    const design = template;
    const savingId = design.id;
    const timer = setTimeout(() => {
      setSaveStatus('saving');
      void updateReportDesign(design.id, design)
        .then((saved) => {
          const persisted = saved ?? design;
          // Always keep the list current — the design may no longer be open, but its saved form is still valid.
          setTemplates((ts) => upsert(ts, persisted));
          // Only touch the shared dirty-baseline / status when this design is STILL the open one; otherwise a
          // late resolution would corrupt the now-open design's baseline and falsely flip it to "Saved".
          if (selectedIdRef.current === savingId) {
            savedJsonRef.current = stableJson(persisted);
            setSaveStatus('saved');
          }
        })
        .catch((e) => {
          if (selectedIdRef.current === savingId) setSaveStatus('error');
          toast.error(e instanceof Error ? e.message : String(e));
        });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyJson, selectedId]);

  // Fire-and-forget: persist the open design's pending edits immediately (no debounce) before leaving it,
  // so switching designs never drops the last edit sitting in the autosave window. Transient designs are
  // skipped — they need an explicit Save. Navigation is not blocked on the response.
  //
  // Deliberately does NOT touch `savedJsonRef` or `saveStatus`: the debounce timer for the leaving design is
  // cancelled by this effect's cleanup on switch, and after the switch those shared refs belong to whatever
  // design is now open — writing them here would corrupt the new design's baseline. Failures are surfaced.
  const flushOpen = () => {
    if (!template || transientIds.has(template.id)) return;
    if (stableJson(template) === savedJsonRef.current) return; // clean — nothing pending
    const design = template;
    void updateReportDesign(design.id, design)
      .then((saved) => setTemplates((ts) => upsert(ts, saved ?? design)))
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  };

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
  const patchElements = (ids: string[], patch: Partial<import('./types').DesignElement>, opts?: { discrete?: boolean }) => {
    if (!template) return;
    const next = updateElements(template, ids, patch);
    if (opts?.discrete) pushTemplate(next); else updateTemplate(next);
  };
  const patchParameters = (parameters: import('./types').TemplateParam[]) => {
    if (!template) return;
    pushTemplate({ ...template, parameters }); // discrete step — param edits are deliberate
  };

  const startEdit = (id: string) => { setSelectedIds([id]); setEditingId(id); };
  const editChange = (id: string, text: string) => { if (template) updateTemplate(updateElement(template, id, { text })); };
  const endEdit = () => setEditingId(null);

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

  // Open a design from the explorer. Normally navigate so the URL drives the `:id` load effect;
  // but if the URL already points at `id` (e.g. after opening a transient without navigating),
  // navigate() is a no-op and the effect never re-runs — so re-select locally instead. The design
  // is always already in `templates` (the list endpoint returns full designs), so no fetch is needed.
  const selectDesign = (id: string) => {
    if (id !== selectedId) flushOpen();
    if (id === routeId) {
      loadedIdRef.current = id;
      setSelectedId(id);
      setSelectedIds([]);
      setEditingId(null);
    } else {
      navigate(`/report-designer/${id}`);
    }
  };

  const newTemplate = () => {
    flushOpen(); // persist any pending edits on the currently-open design before switching away
    const id = `rt-${Date.now()}`;
    const tpl: ReportTemplate = {
      id, name: 'Untitled template', paper: 'A4', orientation: 'portrait',
      pages: [{ id: `${id}-p1`, elements: [] }], parameters: [],
    };
    // Transient: lives only in local state until Save persists it (no navigation yet).
    setTransientIds((s) => new Set(s).add(id));
    loadedIdRef.current = id;
    setTemplates((ts) => [tpl, ...ts]);
    setSelectedId(id);
    setSelectedIds([]);
    setEditingId(null);
  };

  const onSave = async () => {
    if (!template) return;
    setError(undefined);
    const isNew = transientIds.has(template.id);
    try {
      const saved = isNew ? await createReportDesign(template) : await updateReportDesign(template.id, template);
      setTemplates((ts) => upsert(ts, saved));
      savedJsonRef.current = stableJson(saved ?? template);
      setSaveStatus('saved');
      if (isNew) {
        setTransientIds((s) => { const n = new Set(s); n.delete(template.id); return n; });
        loadedIdRef.current = saved.id;
        setSelectedId(saved.id);
        navigate(`/report-designer/${saved.id}`, { replace: true });
      }
      toast.success(t('reportDesigner.savedToast', { name: saved.name }));
    } catch (e) { fail(e); }
  };

  const onExportPdf = async () => {
    if (!template) return;
    setError(undefined);
    try {
      await downloadReportDesignPdf(template);
      toast.success(t('reportDesigner.exportedToast', { name: template.name }));
    } catch (e) { fail(e); }
  };

  const onExportExcel = async () => {
    if (!template) return;
    setError(undefined);
    try {
      const n = await exportDesignToExcel(template);
      if (n === 0) { toast.info(t('reportDesigner.nothingToExport')); return; }
      toast.success(t('reportDesigner.exportedExcelToast', { name: template.name }));
    } catch (e) { fail(e); }
  };

  // "Publish as report" needs a persisted design id (the report record links to it by id) —
  // a transient (never-saved) design has no server-side id yet, so ask the user to save first.
  const onPublishAsReport = () => {
    if (!template) return;
    if (transientIds.has(template.id)) { toast.info(t('reportDesigner.saveBeforePublish')); return; }
    setPublishOpen(true);
  };

  const onDelete = async () => {
    if (!template) return;
    setError(undefined);
    const isNew = transientIds.has(template.id);
    const deletedId = template.id;
    try {
      if (!isNew) await deleteReportDesign(deletedId);
      setTemplates((ts) => ts.filter((x) => x.id !== deletedId));
      setTransientIds((s) => { const n = new Set(s); n.delete(deletedId); return n; });
      savedJsonRef.current = '';
      setSaveStatus('saved');
      loadedIdRef.current = null;
      setSelectedId(null);
      setSelectedIds([]);
      setEditingId(null);
      toast.success(t('reportDesigner.deletedToast'));
      navigate('/report-designer');
    } catch (e) { fail(e); }
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
    setEditingId((id) => (id && !present.has(id) ? null : id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  // Warn on tab close / reload while there are unsaved (or in-flight / failed) autosave changes.
  useEffect(() => {
    if (saveStatus === 'saved') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveStatus]);

  return (
    <AppShell title={t('reportDesigner.title')} fullBleed>
      {error && <div className="shrink-0 border-b border-border px-4 py-2 text-xs text-destructive">{error}</div>}
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
              onSelect={selectDesign}
              onCollapse={() => setCollapsed(true)} />
          </div>
        )}

        {template ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col">
              <CanvasHeader name={template.name} zoom={zoom} saveStatus={saveStatus}
                onNameChange={(name) => updateTemplate({ ...template, name })}
                onNewTemplate={newTemplate}
                onInsert={insert}
                onUndo={undo} onRedo={redo} canUndo={history.canUndo} canRedo={history.canRedo}
                onZoomIn={() => zoomStep(1)} onZoomOut={() => zoomStep(-1)}
                onPreview={() => setPreviewOpen(true)} onSave={() => { void onSave(); }} onExportPdf={() => { void onExportPdf(); }} onExportExcel={() => { void onExportExcel(); }}
                onPublishAsReport={onPublishAsReport}
                onCheck={noop} onDuplicate={noop} onDelete={() => setConfirmDeleteOpen(true)} />
              <PageCanvas template={template} zoom={zoom} selectedIds={selectedIds} onSelect={setSelectedIds} onCommitRects={commitRects}
                editingId={editingId} onEditStart={startEdit} onEditChange={editChange} onEditEnd={endEdit} />
            </div>
            <div className="flex w-64 shrink-0 flex-col border-l border-border" data-testid="inspector">
              <InspectorTabs template={template} selectedIds={selectedIds} onSelect={setSelectedIds}
                onPatchElement={patchElement} onPatchPage={patchPage} onPatchElements={patchElements} onPatchParameters={patchParameters} />
            </div>
          </>
        ) : (
          <EmptyState
            className="min-w-0 bg-muted/30"
            icon={<Frame className="h-6 w-6" />}
            title={t('reportDesigner.emptyTitle')}
            body={t('reportDesigner.emptyBody')}
            action={<Button onClick={newTemplate}>{t('reportDesigner.newTemplate')}</Button>}
          />
        )}
      </div>
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('reportDesigner.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('reportDesigner.deleteConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { void onDelete(); }}>{t('reportDesigner.deleteConfirmAction')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {template && previewOpen && <PreviewReportDesignDialog open={previewOpen} design={template} onOpenChange={setPreviewOpen} />}
      {template && (
        <NewReportSheet
          open={publishOpen}
          onOpenChange={setPublishOpen}
          initialDesignId={template.id}
          onCreated={() => toast.success(t('reportDesigner.publishedToast', { name: template.name }))}
        />
      )}
    </AppShell>
  );
}
