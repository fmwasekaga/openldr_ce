import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, GripVertical, Trash2 } from 'lucide-react';
import type { FormField } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';

export function FieldRow({
  field,
  selected,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  field: FormField;
  selected: boolean;
  onSelect: (field: FormField, event: React.MouseEvent) => void;
  onDuplicate: (fieldId: string) => void;
  onDelete: (fieldId: string) => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className={selected ? 'flex items-center gap-2 bg-primary/5 px-3 py-2' : 'flex items-center gap-2 px-3 py-2'}>
      <button type="button" className="cursor-grab text-muted-foreground" aria-label={`Drag ${field.label.en}`} {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={(event) => onSelect(field, event)}>
        <span className="font-medium">{field.label.en}</span>
        <span className="ml-2 text-xs text-muted-foreground">{field.type}</span>
        {field.enabled === false ? <span className="ml-2 text-xs text-muted-foreground">(disabled)</span> : null}
      </button>
      <Button type="button" size="icon" variant="ghost" aria-label={`Duplicate ${field.label.en}`} onClick={() => onDuplicate(field.id)}>
        <Copy className="h-4 w-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${field.label.en}`} onClick={() => onDelete(field.id)}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
