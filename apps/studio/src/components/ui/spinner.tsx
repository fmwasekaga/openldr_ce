import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/** A spinning loader glyph. Wraps lucide's Loader2 (the app's de-facto spinner) with an
 *  accessible role so screen readers announce the busy state. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 role="status" aria-label="Loading" className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} />;
}

/** Centered spinner + optional label that fills its parent — the loading counterpart to
 *  StripedEmpty (give it a height, or pass min-h via className so it doesn't jump between
 *  the loading, empty, and populated states). */
export function LoadingState({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
      <Spinner />
      {label && <span>{label}</span>}
    </div>
  );
}
