import React from 'react';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FormField, FormLintIssue } from '@openldr/forms/pure';

export interface SortableFieldRowProps {
  field: FormField;
  selected: boolean;
  lintIssue?: FormLintIssue;
  onSelect: (f: FormField, e: React.MouseEvent) => void;
  onToggleEnabled: (id: string) => void;
  onToggleRequired: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SortableFieldRow({
  field,
  selected,
  lintIssue,
  onSelect,
  onToggleEnabled,
  onToggleRequired,
  onDuplicate,
  onDelete,
}: SortableFieldRowProps): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : field.enabled ? 1 : 0.4,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-sortable-card
      className={`group flex items-center gap-2 px-3 py-2 rounded-md border transition-colors cursor-pointer ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-muted-foreground/30'
      }`}
      onClick={(e) => onSelect(field, e)}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground shrink-0 touch-none"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Enabled checkbox */}
      <Checkbox
        checked={field.enabled}
        onCheckedChange={() => onToggleEnabled(field.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Toggle enabled for ${field.displayLabel}`}
      />

      {/* Label region */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {field.displayLabel}
          {field.required && (
            <span className="text-destructive ml-0.5">*</span>
          )}
        </p>
        {field.fhirPath && (
          <p className="text-[10px] text-muted-foreground font-mono truncate">
            {field.fhirPath}
          </p>
        )}
      </div>

      {/* Lint marker */}
      {lintIssue && (
        <span
          className={`shrink-0 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
            lintIssue.severity === 'error'
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-amber-100 text-amber-700'
          }`}
          title={lintIssue.message}
          aria-label={lintIssue.message}
        >
          {lintIssue.severity === 'error' ? '!' : '?'}
        </span>
      )}

      {/* Type badge */}
      <Badge variant="secondary" className="text-[10px] shrink-0">
        {field.fieldType}
      </Badge>

      {/* Section badge */}
      {field.section && (
        <Badge variant="outline" className="text-[10px] shrink-0">
          {field.section}
        </Badge>
      )}

      {/* ⋯ Actions menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Actions for ${field.displayLabel}`}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => onDuplicate(field.id)}>
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleRequired(field.id)}>
            Required
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onDelete(field.id)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
