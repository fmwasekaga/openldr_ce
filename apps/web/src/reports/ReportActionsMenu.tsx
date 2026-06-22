import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

/**
 * SP-1: History and Schedules are placeholders (disabled). They are wired live
 * in SP-2 (Run History) and SP-3 (Scheduling).
 */
export function ReportActionsMenu() {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('common.actions')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled title={t('reports.comingSoon')}>
          {t('reports.runHistory')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled title={t('reports.comingSoon')}>
          {t('reports.schedules')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
