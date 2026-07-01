import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

export function SignatureBadge({ valid, publisher }: { valid?: boolean; publisher: { name: string } | null }) {
  const { t } = useTranslation();
  if (valid === false) {
    return <Badge variant="secondary" className="border-destructive/50 text-destructive">{t('settings.marketplace.invalid')}</Badge>;
  }
  if (valid === undefined) {
    return <Badge variant="outline" className="text-muted-foreground">{t('settings.marketplace.unverified')}</Badge>;
  }
  if (publisher) {
    return <Badge variant="outline" className="border-emerald-500 text-emerald-700">{t('settings.marketplace.verified')}</Badge>;
  }
  return <Badge variant="outline">{t('settings.marketplace.firstUse')}</Badge>;
}
