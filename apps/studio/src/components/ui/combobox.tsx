import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TruncatedText } from '@/components/ui/truncated-text';
import { cn } from '@/lib/cn';

export interface ComboboxOption { value: string; label: string }

export function Combobox({
  options, value, onChange, placeholder, searchPlaceholder, disabled,
}: {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled} className="w-full justify-between font-normal" aria-label={selected ? selected.label : placeholder}>
          <TruncatedText text={selected ? selected.label : placeholder} className={cn('min-w-0', !selected && 'text-muted-foreground')} />
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="p-2"><Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} /></div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">{searchPlaceholder}…</div>
          ) : filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
            >
              <TruncatedText text={o.label} className="min-w-0" />
              {o.value === value ? <Check className="ml-2 h-4 w-4 shrink-0" /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
