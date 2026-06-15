import { useCallback, useEffect, useRef, useState } from 'react';
import { searchTerms, type Term } from '../api';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';

export interface PickedTerm { system: string; code: string; display: string | null }

export function TermPicker({ value, onChange, systemId, statuses }: {
  value: PickedTerm | null;
  onChange: (v: PickedTerm | null) => void;
  systemId: string;
  statuses?: string[];
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Term[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); return; }
    const res = await searchTerms(systemId, { q: trimmed, status: statuses?.[0], limit: 20 });
    setResults(res.rows);
  }, [systemId, statuses]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(query); }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
        <span className="text-sm">
          <span className="font-mono text-primary">{value.code}</span>
          {value.display && <span className="ml-2 text-muted-foreground">— {value.display}</span>}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear"
          className="h-7 w-7 shrink-0"
          onClick={() => onChange(null)}
        >
          ×
        </Button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search terms…"
        className="h-9 text-sm"
      />
      {open && query.trim().length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">No results</div>
          ) : (
            results.map((r) => (
              <button
                key={`${r.system}|${r.code}`}
                type="button"
                onClick={() => {
                  onChange({ system: r.system, code: r.code, display: r.display });
                  setOpen(false);
                  setQuery('');
                  setResults([]);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="shrink-0 font-mono text-xs text-primary">{r.code}</span>
                <span className="truncate text-foreground">{r.display ?? '—'}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
