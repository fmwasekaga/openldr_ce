import { useTranslation } from 'react-i18next';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

const PRESETS = ['#000000', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

interface Props {
  value: string;
  onChange(v: string, opts?: { discrete?: boolean }): void;
  allowNone?: boolean;
  mixed?: boolean;
  'aria-label'?: string;
}

export function ColorField({ value, onChange, allowNone, mixed, 'aria-label': ariaLabel }: Props): JSX.Element {
  const { t } = useTranslation();
  const label = ariaLabel ?? t('reportDesigner.color');
  const isNone = !value || value === 'none';
  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={label}
            className={cn('h-7 w-7 shrink-0 rounded-md border border-border', !mixed && isNone && 'bg-muted')}
            style={mixed ? { background: 'linear-gradient(135deg,#ef4444 0 33%,#10b981 33% 66%,#3b82f6 66%)' } : (isNone ? undefined : { background: value })} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-40 p-2">
          <div className="grid grid-cols-6 gap-1">
            {PRESETS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => onChange(c, { discrete: true })}
                className="h-5 w-5 rounded border border-border" style={{ background: c }} />
            ))}
          </div>
          {allowNone && (
            <button type="button" onClick={() => onChange('none', { discrete: true })}
              className="mt-2 w-full rounded border border-border py-1 text-xs text-muted-foreground hover:bg-muted">
              {t('reportDesigner.none')}
            </button>
          )}
        </PopoverContent>
      </Popover>
      <Input aria-label={`${label} hex`} value={mixed ? '' : (isNone ? '' : value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={mixed ? t('reportDesigner.mixed') : (allowNone ? t('reportDesigner.none') : '#000000')}
        className="h-7 font-mono text-xs" />
    </div>
  );
}
