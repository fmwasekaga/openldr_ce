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
        // 36x20 track. The thumb is absolutely positioned (left) rather than translated —
        // Tailwind v4 maps translate-x to the `translate` property and the flex base offset
        // left the thumb mid-track. off-state uses --input (visible gray; --muted ≈ panel bg).
        'relative inline-block h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled && 'cursor-not-allowed opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={cn(
          // White 16px thumb, 2px inset top/bottom + at each end (left 2px ↔ 18px = 36-16-2).
          'pointer-events-none absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/15 transition-all duration-150',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  );
}
