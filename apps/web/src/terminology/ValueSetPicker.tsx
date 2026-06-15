import { useEffect, useMemo, useRef, useState } from 'react';
import { listValueSets, type ValueSetSummary } from '../api';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';

interface Props {
  onPick: (valueSet: ValueSetSummary) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/** Typeahead over locally-curated ValueSets; loads once, filters client-side. */
export function ValueSetPicker({ onPick, placeholder, autoFocus, className }: Props): JSX.Element {
  const [all, setAll] = useState<ValueSetSummary[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void listValueSets()
      .then((rows) => {
        if (!cancelled) setAll(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? all.filter((v) => [v.title, v.name, v.url].some((s) => s?.toLowerCase().includes(q))) : all;
    return pool.slice(0, 20);
  }, [all, query]);

  return (
    <div ref={containerRef} className={className ? `relative ${className}` : 'relative'}>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? 'Search value sets...'}
        aria-label={placeholder ?? 'Search value sets'}
        autoFocus={autoFocus}
        className="h-9 text-sm"
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {loading ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">Loading...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">No value sets found.</div>
          ) : (
            results.map((vs) => (
              <button
                key={vs.id}
                type="button"
                onClick={() => {
                  onPick(vs);
                  setOpen(false);
                  setQuery('');
                }}
                className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">{vs.title ?? vs.name ?? vs.url}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{vs.url}</p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
                  {vs.codeCount} codes
                </Badge>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
