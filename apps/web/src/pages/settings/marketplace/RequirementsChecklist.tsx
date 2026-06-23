import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';

export function RequirementsChecklist({ compatible, ceRange, ceVersion }: {
  compatible: boolean;
  ceRange: string;
  ceVersion: string;
}) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1 text-[13px]">
      <li className="flex items-center gap-2">
        {compatible
          ? <Check className="h-3.5 w-3.5 text-emerald-600" />
          : <X className="h-3.5 w-3.5 text-destructive" />}
        <span className={compatible ? '' : 'text-destructive'}>
          {compatible
            ? t('settings.marketplace.compatibleWith', { version: ceVersion })
            : t('settings.marketplace.incompatibleWith', { range: ceRange, version: ceVersion })}
        </span>
      </li>
    </ul>
  );
}
