import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface Props {
  onOpenHistory?: () => void;
  onOpenSchedules?: () => void;
  canManageSchedules?: boolean;
  /** The linked report-designer template id for a data-driven (source==='design') report. */
  designId?: string;
}

/** SP-3b: Run History (SP-2) and Schedules (manager-only) are live. */
export function ReportActionsMenu({ onOpenHistory, onOpenSchedules, canManageSchedules, designId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
        {designId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!canManageSchedules}
              title={canManageSchedules ? undefined : t('reports.comingSoon')}
              onSelect={() => { if (canManageSchedules) navigate(`/report-designer/${designId}`); }}
            >
              <Pencil className="mr-2 h-4 w-4" /> {t('reports.editTemplate')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
