import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { StripedEmpty } from './striped-empty';

/** A spinning loader glyph. Wraps lucide's Loader2 (the app's de-facto spinner) with an
 *  accessible role so screen readers announce the busy state. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 role="status" aria-label="Loading" className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} />;
}

/** Spinner + optional label centered over the striped-empty backdrop — the loading
 *  counterpart to StripedEmpty, so loading and empty states share the same look. Give it a
 *  height (or `flex-1`/`min-h-*` via className) so it fills and doesn't jump between the
 *  loading, empty, and populated states. */
export function LoadingState({ label, className }: { label?: string; className?: string }) {
  return (
    <StripedEmpty className={className}>
      <span className="flex items-center gap-2">
        <Spinner />
        {label && <span>{label}</span>}
      </span>
    </StripedEmpty>
  );
}
