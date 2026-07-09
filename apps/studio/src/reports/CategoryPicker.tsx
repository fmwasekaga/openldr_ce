import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { ReportCategory } from './reportCategoriesApi';

export interface CategoryPickerProps {
  /** The currently-selected category id. */
  value: string;
  onChange: (id: string) => void;
  categories: ReportCategory[];
  /** Any add/rename/reorder/delete edit — the parent persists via saveReportCategories + refetch. */
  onCategoriesChange: (list: ReportCategory[]) => void;
  /** Non-managers can select a category but not manage the list (add/rename/reorder/delete hidden). */
  canEdit: boolean;
}

function generateId(label: string, existing: ReportCategory[]): string {
  const existingIds = new Set(existing.map((c) => c.id));
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'category';
  let candidate = base;
  let counter = 1;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter++;
  }
  return candidate;
}

export function CategoryPicker({ value, onChange, categories, onCategoriesChange, canEdit }: CategoryPickerProps): JSX.Element {
  const { t } = useTranslation();
  const [newLabel, setNewLabel] = useState('');

  const sorted = [...categories].sort((a, b) => a.order - b.order);
  const selected = sorted.find((c) => c.id === value);

  function handleSelect(id: string) {
    onChange(id);
  }

  function handleLabelChange(id: string, label: string) {
    onCategoriesChange(categories.map((c) => (c.id === id ? { ...c, label } : c)));
  }

  function handleAdd() {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    const id = generateId(trimmed, categories);
    const next: ReportCategory = { id, label: trimmed, order: sorted.length };
    onCategoriesChange([...sorted, next]);
    onChange(id);
    setNewLabel('');
  }

  function handleDelete(id: string) {
    const remaining = sorted.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i }));
    onCategoriesChange(remaining);
    if (value === id) onChange(remaining[0]?.id ?? '');
  }

  function handleMove(index: number, direction: 'up' | 'down') {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;
    const next = sorted.map((c) => ({ ...c }));
    const tempOrder = next[index].order;
    next[index].order = next[swapIndex].order;
    next[swapIndex].order = tempOrder;
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    onCategoriesChange(next);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAdd();
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full justify-between font-normal">
          <span className="truncate">{selected ? selected.label : t('reports.category.placeholder')}</span>
          <span className="ml-1 shrink-0 text-muted-foreground">▾</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex flex-col gap-2 p-3">
          <div className="flex flex-col gap-1">
            {sorted.map((cat, index) => {
              const isSelected = cat.id === value;
              return (
                <div
                  key={cat.id}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-2 py-1',
                    isSelected ? 'border-[#5A9BD6] bg-[rgba(70,130,180,0.08)]' : 'border-border',
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Select category ${cat.label}`}
                    aria-pressed={isSelected}
                    className="flex h-5 w-5 shrink-0 items-center justify-center"
                    onClick={() => handleSelect(cat.id)}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5 text-[#5A9BD6]" />}
                  </button>

                  {canEdit ? (
                    <Input
                      aria-label={`Category label for ${cat.id}`}
                      value={cat.label}
                      onChange={(e) => handleLabelChange(cat.id, e.target.value)}
                      className="h-7 flex-1 text-sm border-0 shadow-none focus-visible:ring-0 px-1"
                    />
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-sm"
                      onClick={() => handleSelect(cat.id)}
                    >
                      {cat.label}
                    </button>
                  )}

                  {canEdit && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => handleMove(index, 'up')}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        aria-label="Move down"
                        disabled={index === sorted.length - 1}
                        onClick={() => handleMove(index, 'down')}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                        aria-label={`Delete category ${cat.label}`}
                        onClick={() => handleDelete(cat.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {canEdit && (
            <div className="flex gap-1">
              <Input
                aria-label={t('reports.category.placeholder')}
                placeholder={t('reports.category.placeholder')}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 flex-1 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-3 text-xs"
                disabled={newLabel.trim() === ''}
                onClick={handleAdd}
              >
                {t('reports.category.add')}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
