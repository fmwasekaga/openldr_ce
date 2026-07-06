import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { AppShell } from '@/shell/AppShell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createEmptyTemplate, lintReportTemplate, type Block, type BlockKind, type PageSpec, type ReportTemplate } from '@openldr/report-builder/pure';
import { createReportTemplate, getReportTemplate, updateReportTemplate, deleteReportTemplate, fetchClientConfig } from '../api';
import { useTemplateHistory } from '../forms-builder/useTemplateHistory';
import { addRowWithBlock, duplicateRow, moveRow, moveRowFromCellDrag, newBlock, removeCell, setColSpan, setRepeat, updateBlockAt } from './reportBuilderModel';
import { BlockPalette } from './BlockPalette';
import { usePersistedToggle } from './usePersistedToggle';
import { ReportCanvas, type CellRef } from './ReportCanvas';
import { BlockInspector } from './BlockInspector';
import { ReportSettings } from './ReportSettings';
import { PreviewPdfDialog } from './PreviewPdfDialog';
import { useBlockData } from './useBlockData';
import { ParametersEditor } from './ParametersEditor';
import { ParamValuesBar } from './ParamValuesBar';
import { LintSummary } from './LintSummary';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';

export function ReportBuilderPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [tplId, setTplId] = useState<string | null>(id ?? null);
  const [template, setTemplate] = useState<ReportTemplate>(() => createEmptyTemplate(`rt-${Date.now()}`, ''));
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [paramsOpen, setParamsOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const blockData = useBlockData(template, paramValues);
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [activeDrag, setActiveDrag] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sqlEnabled, setSqlEnabled] = useState(false);
  const [error, setError] = useState<string>();
  const loadedIdRef = useRef<string | null>(null);
  const history = useTemplateHistory<ReportTemplate>(() => template);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [paletteCollapsed, togglePalette] = usePersistedToggle('openldr-rb-palette-collapsed');

  useEffect(() => {
    if (!id || loadedIdRef.current === id) return;
    let cancelled = false;
    void getReportTemplate(id).then((t) => { if (!cancelled) { loadedIdRef.current = t.id; setTplId(t.id); setTemplate(t); } }).catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => { fetchClientConfig().then((c) => setSqlEnabled(c.dashboardSqlEnabled)).catch(() => {}); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); applyHistory(e.shiftKey ? history.redo() : history.undo()); return; }
      if (mod && e.key.toLowerCase() === 'd' && selected) { e.preventDefault(); pushUpdate(duplicateRow(template, selected.row)); setSelected({ row: selected.row + 1, cell: selected.cell }); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); pushUpdate(removeCell(template, selected.row, selected.cell)); setSelected(null); return; }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, selected]);

  const update = (next: ReportTemplate) => { history.recordEdit(); setTemplate(next); };
  const pushUpdate = (next: ReportTemplate) => { history.pushHistory(); setTemplate(next); };

  const addBlock = (kind: BlockKind) => { pushUpdate(addRowWithBlock(template, newBlock(kind))); };
  const applyHistory = (next: ReportTemplate | null) => { if (next) setTemplate(next); };

  const onDragStart = (e: DragStartEvent) => setActiveDrag(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (active.startsWith('palette:')) { addBlock(active.slice('palette:'.length) as BlockKind); return; }
    const reordered = moveRowFromCellDrag(template, active, over);
    if (reordered) pushUpdate(reordered);
  };

  const selectedBlock: Block | null = useMemo(
    () => (selected ? template.rows[selected.row]?.cells[selected.cell]?.block ?? null : null),
    [selected, template],
  );

  const issues = useMemo(() => lintReportTemplate(template), [template]);
  const hasErrors = issues.some((i) => i.severity === 'error');

  const save = async () => {
    try {
      const name = template.name.trim() || 'Untitled report';
      const toSave = { ...template, name };
      const saved = tplId ? await updateReportTemplate(tplId, toSave) : await createReportTemplate(toSave);
      setTemplate(saved); setTplId(saved.id); loadedIdRef.current = saved.id;
      if (!id) navigate(`/reports/builder/${saved.id}`, { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const publish = async () => { if (tplId) { const s = await updateReportTemplate(tplId, { ...template, status: 'published' }); setTemplate(s); } };
  const handleDelete = async () => { if (tplId) { await deleteReportTemplate(tplId); navigate('/reports'); } };
  const doPreview = async () => { await save(); setPreviewOpen(true); };

  return (
    <AppShell title={t('reportBuilder.header.title')} fullBleed>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <Input aria-label={t('reportBuilder.header.reportNameAria')} placeholder={t('reportBuilder.header.namePlaceholder')} value={template.name} onChange={(e) => update({ ...template, name: e.target.value })} className="h-8 max-w-xs text-sm" />
            <div className="flex items-center gap-1.5">
              <LintSummary issues={issues} onSelectBlock={(r, c) => setSelected({ row: r, cell: c })} />
              <Button size="sm" variant="ghost" onClick={() => applyHistory(history.undo())}>{t('reportBuilder.header.undo')}</Button>
              <Button size="sm" variant="ghost" onClick={() => applyHistory(history.redo())}>{t('reportBuilder.header.redo')}</Button>
              <Button size="sm" variant="outline" onClick={() => setParamsOpen(true)}>{t('reportBuilder.header.parameters')}</Button>
              <Button size="sm" variant="outline" onClick={() => { void doPreview(); }}>{t('reportBuilder.header.preview')}</Button>
              <Button size="sm" onClick={() => { void save(); }}>{t('common.save')}</Button>
              <Button size="sm" variant="outline" disabled={hasErrors} onClick={() => { void publish(); }}>{t('reportBuilder.header.publish')}</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDeleteOpen(true)}>{t('common.delete')}</Button>
            </div>
          </div>
          {error && <div className="border-b border-border px-4 py-2 text-xs text-destructive">{error}</div>}
          <ParamValuesBar parameters={template.parameters} values={paramValues} onChange={setParamValues} />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className={`${paletteCollapsed ? 'w-12' : 'w-40'} shrink-0 border-r border-border overflow-y-auto`}><BlockPalette collapsed={paletteCollapsed} onToggle={togglePalette} onAdd={addBlock} /></div>
            <div className="min-w-0 flex-1 overflow-auto bg-muted/30" onClick={() => setSelected(null)}>
              <ReportCanvas template={template} selected={selected} onSelect={(row, cell) => setSelected({ row, cell })} data={blockData} issues={issues} />
            </div>
            <div className="w-64 shrink-0 border-l border-border overflow-y-auto">
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
            </div>
          </div>
        </div>
        <DragOverlay>
          {activeDrag && activeDrag.startsWith('cell:') ? (
            <div className="rounded border border-border bg-background px-2 py-1 text-xs shadow">{t('reportBuilder.header.movingRow')}</div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {tplId && <PreviewPdfDialog open={previewOpen} reportId={tplId} params={paramValues} onClose={() => setPreviewOpen(false)} />}
      <ParametersEditor
        open={paramsOpen}
        parameters={template.parameters}
        onClose={() => setParamsOpen(false)}
        onSave={(p) => update({ ...template, parameters: p })}
      />
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('reportBuilder.header.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('reportBuilder.header.deleteConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { void handleDelete(); }}>{t('reportBuilder.header.deleteConfirmAction')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
