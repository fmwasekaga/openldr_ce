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
