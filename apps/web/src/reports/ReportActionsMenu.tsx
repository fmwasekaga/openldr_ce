import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

interface Props {
  onOpenHistory?: () => void;
  onOpenSchedules?: () => void;
  canManageSchedules?: boolean;
}

/** SP-3b: Run History (SP-2) and Schedules (manager-only) are live. */
export function ReportActionsMenu({ onOpenHistory, onOpenSchedules, canManageSchedules }: Props) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('common.actions')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onOpenHistory?.()}>
          {t('reports.runHistory')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canManageSchedules}
          title={canManageSchedules ? undefined : t('reports.comingSoon')}
          onSelect={() => { if (canManageSchedules) onOpenSchedules?.(); }}
        >
          {t('reports.schedules')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
