import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { SignatureBadge } from './SignatureBadge';
import type { CardEntry } from './util';

export function PackageCard({ entry, onClick }: { entry: CardEntry; onClick: () => void }) {
  const { t } = useTranslation();
  const stateBadge = entry.installed
    ? (entry.active
        ? <Badge variant="outline" className="border-emerald-500 text-emerald-700">{t('settings.marketplace.active')}</Badge>
        : <Badge variant="outline">{t('settings.marketplace.installed')}</Badge>)
    : <Badge variant="outline" className="opacity-70">{t('settings.marketplace.install')}</Badge>;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`card-${entry.ref ?? entry.id}`}
      className="w-full rounded-md border border-border p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug text-foreground">{entry.id}</span>
        <Badge variant="outline" className="shrink-0 text-[10px] uppercase">{entry.type}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {(entry.publisher?.name || '—')} · v{entry.version}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {stateBadge}
        {entry.ref ? <SignatureBadge valid={entry.valid} publisher={entry.publisher} /> : null}
      </div>
    </button>
  );
}
