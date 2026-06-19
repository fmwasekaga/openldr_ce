import React, { useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FormField, FormLintIssue } from '@openldr/forms/pure';
import { SortableFieldRow } from './SortableFieldRow';

export interface FieldListPaneProps {
  fields: FormField[];
  selectedFieldId: string | null;
  issues: FormLintIssue[];
  onSelect: (f: FormField, e: React.MouseEvent) => void;
  onToggleEnabled: (id: string) => void;
  onToggleRequired: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
}

export function FieldListPane({
  fields,
  selectedFieldId,
  issues,
  onSelect,
  onToggleEnabled,
  onToggleRequired,
  onDuplicate,
  onDelete,
  onReorder,
}: FieldListPaneProps): JSX.Element {
  const [searchText, setSearchText] = useState('');
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor));

  // Distinct sections derived from all fields
  const distinctSections = useMemo(() => {
    const seen = new Set<string>();
    for (const f of fields) {
      if (f.section) seen.add(f.section);
    }
    return Array.from(seen);
  }, [fields]);

  const enabledCount = useMemo(
    () => fields.filter((f) => f.enabled).length,
    [fields],
  );

  // Filter + sort
  const visibleFields = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return fields
      .filter((f) => {
        if (selectedSection && f.section !== selectedSection) return false;
        if (q) {
          const labelMatch = f.displayLabel.toLowerCase().includes(q);
          const pathMatch = f.fhirPath?.toLowerCase().includes(q) ?? false;
          return labelMatch || pathMatch;
        }
        return true;
      })
      .slice()
      .sort((a, b) => a.order - b.order);
  }, [fields, searchText, selectedSection]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id));
    }
  }

  function issueForField(fieldId: string): FormLintIssue | undefined {
    return issues.find((i) => i.fieldId === fieldId);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b space-y-2">
        {/* Counter */}
        <p className="text-xs text-muted-foreground">
          {fields.length} fields ({enabledCount} enabled)
        </p>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            aria-label="Search fields"
            placeholder="Search fields…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-7 h-8 text-sm"
          />
        </div>

        {/* Sections dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-between text-xs h-8">
              {selectedSection
                ? `Section: ${selectedSection}`
                : `Sections (${distinctSections.length})`}
              <span className="ml-1 text-muted-foreground">▾</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onSelect={() => setSelectedSection(null)}>
              All sections
            </DropdownMenuItem>
            {distinctSections.length > 0 && <DropdownMenuSeparator />}
            {distinctSections.map((section) => (
              <DropdownMenuItem
                key={section}
                data-testid={`section-item-${section}`}
                onSelect={() => setSelectedSection(section)}
              >
                {section}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleFields.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleFields.map((field) => (
              <SortableFieldRow
                key={field.id}
                field={field}
                selected={field.id === selectedFieldId}
                lintIssue={issueForField(field.id)}
                onSelect={onSelect}
                onToggleEnabled={onToggleEnabled}
                onToggleRequired={onToggleRequired}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
