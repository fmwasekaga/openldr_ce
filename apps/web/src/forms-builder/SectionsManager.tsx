import React from 'react';
import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { FormSection } from '@openldr/forms/pure';

export interface SectionsManagerProps {
  sections: FormSection[];
  onChange: (sections: FormSection[]) => void;
  onFieldsClearSection: (sectionId: string) => void;
}

function generateId(label: string, existing: FormSection[]): string {
  const existingIds = new Set(existing.map((s) => s.id));
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
  let candidate = base;
  let counter = 1;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter++;
  }
  return candidate;
}

export function SectionsManager({
  sections,
  onChange,
  onFieldsClearSection,
}: SectionsManagerProps): JSX.Element {
  // Always work with sections sorted by order
  const sorted = [...sections].sort((a, b) => a.order - b.order);

  function handleLabelChange(id: string, newLabel: string) {
    onChange(
      sections.map((s) => (s.id === id ? { ...s, label: newLabel } : s)),
    );
  }

  function handleAdd() {
    const n = sorted.length;
    const label = `Section ${n + 1}`;
    const id = generateId(label, sections);
    const next: FormSection = { id, label, order: n };
    onChange([...sorted, next]);
  }

  function handleDelete(id: string) {
    const remaining = sorted
      .filter((s) => s.id !== id)
      .map((s, i) => ({ ...s, order: i }));
    onChange(remaining);
    onFieldsClearSection(id);
  }

  function handleMove(index: number, direction: 'up' | 'down') {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;
    const next = sorted.map((s) => ({ ...s }));
    // Swap order values
    const tempOrder = next[index].order;
    next[index].order = next[swapIndex].order;
    next[swapIndex].order = tempOrder;
    // Swap positions in array
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Sections
      </p>

      <div className="flex flex-col gap-1">
        {sorted.map((section, index) => (
          <div
            key={section.id}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1"
          >
            <Input
              aria-label={`Section label for ${section.id}`}
              value={section.label}
              onChange={(e) => handleLabelChange(section.id, e.target.value)}
              className="h-7 flex-1 text-sm border-0 shadow-none focus-visible:ring-0 px-1"
            />

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
              aria-label={`Delete section ${section.label}`}
              onClick={() => handleDelete(section.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full h-8 text-xs gap-1"
        onClick={handleAdd}
      >
        <Plus className="h-3.5 w-3.5" />
        Add section
      </Button>
    </div>
  );
}
