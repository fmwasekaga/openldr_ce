import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { FormField, FormSection } from '@openldr/forms/pure';
import { FieldRow } from './FieldRow';
import { SectionRow } from './SectionRow';

export function BuilderCanvas({
  sections,
  selectedFieldIds,
  onSelectField,
  onDuplicateField,
  onDeleteField,
  onReorderField,
}: {
  sections: FormSection[];
  selectedFieldIds: Set<string>;
  onSelectField: (field: FormField, event: React.MouseEvent) => void;
  onDuplicateField: (fieldId: string) => void;
  onDeleteField: (fieldId: string) => void;
  onReorderField: (activeId: string, overId: string) => void;
}): JSX.Element {
  const sensors = useSensors(useSensor(PointerSensor));
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) onReorderField(String(active.id), String(over.id));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        {sections.map((section) => (
          <SectionRow key={section.id} section={section}>
            <SortableContext items={section.fields.map((field) => field.id)} strategy={verticalListSortingStrategy}>
              {section.fields.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  selected={selectedFieldIds.has(field.id)}
                  onSelect={onSelectField}
                  onDuplicate={onDuplicateField}
                  onDelete={onDeleteField}
                />
              ))}
            </SortableContext>
          </SectionRow>
        ))}
      </div>
    </DndContext>
  );
}
