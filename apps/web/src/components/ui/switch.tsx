import { cn } from '@/lib/cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Minimal accessible toggle switch — no external dependency. */
export function Switch({ checked, onCheckedChange, disabled, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest['aria-label']}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled && 'cursor-not-allowed opacity-50',
        // off-state uses --input (a visible gray) not --muted, which equals --sidebar and is
        // nearly identical to the panel bg → the track would otherwise disappear.
        checked ? 'border-primary bg-primary' : 'border-input bg-input hover:border-muted-foreground/50',
      )}
    >
      <span
        className={cn(
          // White thumb with a shadow + hairline ring so it stays clearly visible on both
          // the blue (checked) and muted (unchecked) tracks, in light and dark themes.
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-1 ring-black/15 transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
