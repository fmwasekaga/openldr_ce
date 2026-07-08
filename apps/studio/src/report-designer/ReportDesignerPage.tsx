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
              onCollapse={() => setCollapsed(true)} />
          </div>
        )}

        {template ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col">
              <CanvasHeader name={template.name} zoom={zoom}
                onNameChange={(name) => patchTemplate({ ...template, name })}
                onNewTemplate={newTemplate}
                onInsert={insert} onZoomIn={() => zoomStep(1)} onZoomOut={() => zoomStep(-1)}
                onPreview={noop} onSave={noop} onExportPdf={noop} onExportExcel={noop}
                onCheck={noop} onDuplicate={noop} onDelete={noop} />
              <PageCanvas template={template} zoom={zoom}
                selectedElementId={selectedElementId} onSelectElement={setSelectedElementId} />
            </div>
            <div className="flex w-64 shrink-0 flex-col border-l border-border" data-testid="inspector">
              <InspectorTabs template={template} selectedElementId={selectedElementId} onSelectElement={setSelectedElementId} />
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
