import type { FormField, FormSection } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';

export function BuilderCanvas({
  sections,
  selectedFieldIds,
  onSelectField,
  onDeleteField,
}: {
  sections: FormSection[];
  selectedFieldIds: Set<string>;
  onSelectField: (field: FormField, event: React.MouseEvent) => void;
  onDeleteField: (fieldId: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section key={section.id} className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">{section.title.en}</div>
          <div className="divide-y divide-border">
            {section.fields.length === 0 ? <div className="px-3 py-6 text-center text-xs text-muted-foreground">No fields in this section.</div> : null}
            {section.fields.map((field) => (
              <div key={field.id} className={selectedFieldIds.has(field.id) ? 'flex items-center gap-2 bg-primary/5 px-3 py-2' : 'flex items-center gap-2 px-3 py-2'}>
                <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={(event) => onSelectField(field, event)}>
                  <span className="font-medium">{field.label.en}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{field.type}</span>
                </button>
                <Button type="button" size="sm" variant="ghost" aria-label={`Delete ${field.label.en}`} onClick={() => onDeleteField(field.id)}>Delete</Button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
