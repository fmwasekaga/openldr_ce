import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Activity, BarChart3, Users, FlaskConical, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { listStarters, type StarterId } from '@openldr/report-builder/pure';

const ICONS: Record<StarterId, LucideIcon> = {
  'blank': FileText,
  'amr-resistance': Activity,
  'test-volume': BarChart3,
  'patient-demographics': Users,
  'specimen-results': FlaskConical,
};

export function StarterGalleryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const starters = listStarters();

  const pick = (id: StarterId) => {
    onOpenChange(false);
    navigate(`/reports/builder/new?starter=${id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <div>
          <DialogTitle>{t('reportBuilder.gallery.title')}</DialogTitle>
          <DialogDescription>{t('reportBuilder.gallery.subtitle')}</DialogDescription>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {starters.map((s) => {
            const Icon = ICONS[s.id];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => pick(s.id)}
                className="flex flex-col gap-1 rounded-lg border border-border p-3 text-left hover:border-primary hover:bg-accent"
              >
                <div className="flex items-center justify-between">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <Badge variant="secondary">{t(`reportBuilder.gallery.category.${s.category}`)}</Badge>
                </div>
                <div className="mt-1 text-sm font-medium">{t(`reportBuilder.gallery.starters.${s.id}.name`)}</div>
                <div className="text-xs text-muted-foreground">{t(`reportBuilder.gallery.starters.${s.id}.description`)}</div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
