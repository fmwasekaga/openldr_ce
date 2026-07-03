import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { AppShell } from '@/shell/AppShell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createEmptyTemplate, type Block, type BlockKind, type ReportTemplate } from '@openldr/report-builder/pure';
import { createReportTemplate, getReportTemplate, updateReportTemplate, deleteReportTemplate } from '../api';
import { useTemplateHistory } from '../forms-builder/useTemplateHistory';
import { addRowWithBlock, moveRow, newBlock, removeCell, setColSpan, updateBlockAt } from './reportBuilderModel';
import { BlockPalette } from './BlockPalette';
import { ReportCanvas, type CellRef } from './ReportCanvas';
import { BlockInspector } from './BlockInspector';
import { PreviewPdfDialog } from './PreviewPdfDialog';

export function ReportBuilderPage(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tplId, setTplId] = useState<string | null>(id ?? null);
  const [template, setTemplate] = useState<ReportTemplate>(() => createEmptyTemplate(`rt-${Date.now()}`, ''));
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string>();
  const history = useTemplateHistory<ReportTemplate>(() => template);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void getReportTemplate(id).then((t) => { if (!cancelled) { setTplId(t.id); setTemplate(t); } }).catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [id]);

  const update = (next: ReportTemplate) => { history.recordEdit(); setTemplate(next); };
  const pushUpdate = (next: ReportTemplate) => { history.pushHistory(); setTemplate(next); };

  const addBlock = (kind: BlockKind) => { pushUpdate(addRowWithBlock(template, newBlock(kind))); };
  const applyHistory = (next: ReportTemplate | null) => { if (next) setTemplate(next); };

  const onDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (active.startsWith('palette:')) { addBlock(active.slice('palette:'.length) as BlockKind); return; }
    if (active.startsWith('row:') && over?.startsWith('row:')) {
      const from = Number(active.slice(4)); const to = Number(over.slice(4));
      if (from !== to) pushUpdate(moveRow(template, from, to));
    }
  };

  const selectedBlock: Block | null = useMemo(
    () => (selected ? template.rows[selected.row]?.cells[selected.cell]?.block ?? null : null),
    [selected, template],
  );

  const save = async () => {
    try {
      const name = template.name.trim() || 'Untitled report';
      const toSave = { ...template, name };
      const saved = tplId ? await updateReportTemplate(tplId, toSave) : await createReportTemplate(toSave);
      setTemplate(saved); setTplId(saved.id);
      if (!id) navigate(`/reports/builder/${saved.id}`, { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const publish = async () => { if (tplId) { const s = await updateReportTemplate(tplId, { ...template, status: 'published' }); setTemplate(s); } };
  const handleDelete = async () => { if (tplId) { await deleteReportTemplate(tplId); navigate('/reports'); } };
  const doPreview = async () => { await save(); setPreviewOpen(true); };

  return (
    <AppShell title="Report Builder" fullBleed>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <Input aria-label="Report name" placeholder="Untitled report" value={template.name} onChange={(e) => update({ ...template, name: e.target.value })} className="h-8 max-w-xs text-sm" />
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => applyHistory(history.undo())}>Undo</Button>
              <Button size="sm" variant="ghost" onClick={() => applyHistory(history.redo())}>Redo</Button>
              <Button size="sm" variant="outline" onClick={() => { void doPreview(); }}>Preview PDF</Button>
              <Button size="sm" onClick={() => { void save(); }}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => { void publish(); }}>Publish</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { void handleDelete(); }}>Delete</Button>
            </div>
          </div>
          {error && <div className="border-b border-border px-4 py-2 text-xs text-destructive">{error}</div>}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="w-40 shrink-0 border-r border-border overflow-y-auto"><BlockPalette onAdd={addBlock} /></div>
            <div className="min-w-0 flex-1 overflow-auto bg-muted/30" onClick={() => setSelected(null)}>
              <ReportCanvas template={template} selected={selected} onSelect={(row, cell) => setSelected({ row, cell })} />
            </div>
            <div className="w-64 shrink-0 border-l border-border overflow-y-auto">
              {selectedBlock && selected ? (
                <BlockInspector
                  block={selectedBlock}
                  colSpan={template.rows[selected.row].cells[selected.cell].colSpan}
                  onPatchBlock={(patch) => update(updateBlockAt(template, selected.row, selected.cell, patch))}
                  onSetColSpan={(n) => update(setColSpan(template, selected.row, selected.cell, n))}
                  onDelete={() => { pushUpdate(removeCell(template, selected.row, selected.cell)); setSelected(null); }}
                />
              ) : (
                <div className="p-4 text-xs text-muted-foreground">Select a block to edit it, or drag a block from the palette.</div>
              )}
            </div>
          </div>
        </div>
      </DndContext>
      {tplId && <PreviewPdfDialog open={previewOpen} reportId={tplId} params={{}} onClose={() => setPreviewOpen(false)} />}
    </AppShell>
  );
}
