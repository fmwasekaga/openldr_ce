import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

export interface PickerOption {
  value: string;
  label: string;
}

/**
 * A minimal searchable single-select — the plugin's own Combobox (the iframe has no
 * shadcn/radix). A button shows the selected label (or the placeholder); clicking opens
 * a dropdown with a case-insensitive substring filter over the option labels. Selecting
 * an option calls `onChange(value)` and closes. Closes on Escape and on focus leaving
 * the widget. No external deps beyond preact/hooks; reused by the later DHIS2 screens.
 */
export function Picker(props: {
  options: PickerOption[];
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  testId?: string;
}): JSX.Element {
  const { options, value, onChange, placeholder, searchPlaceholder, disabled, testId } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Focus the filter input when the dropdown opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);

  function choose(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div
      class="picker"
      ref={rootRef}
      data-testid={testId}
      onBlur={(e) => {
        // Close when focus leaves the widget entirely (not when moving between
        // the trigger button and the filter input / options).
        const next = e.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) return;
        setOpen(false);
      }}
    >
      <button
        type="button"
        class="picker-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span class={selected ? 'picker-label' : 'picker-label picker-placeholder'}>
          {selected ? selected.label : placeholder ?? 'Select…'}
        </span>
        <span class="picker-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div class="picker-menu" role="listbox">
          <input
            ref={inputRef}
            type="text"
            class="picker-search"
            value={query}
            placeholder={searchPlaceholder ?? 'Search…'}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
          <div class="picker-options">
            {filtered.length === 0 ? (
              <div class="picker-empty">No matches</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  class={o.value === value ? 'picker-option picker-option-selected' : 'picker-option'}
                  onClick={() => choose(o.value)}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
