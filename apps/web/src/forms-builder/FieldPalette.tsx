import type { FieldType } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TYPES: FieldType[] = ['string', 'text', 'choice', 'date', 'quantity', 'boolean'];

export function FieldPalette({ search, onSearch, onAddField }: { search: string; onSearch: (value: string) => void; onAddField: (type: FieldType) => void }): JSX.Element {
  return (
    <div className="space-y-3">
      <Input aria-label="Search fields" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search fields" className="h-8 text-xs" />
      <div className="grid gap-2">
        {TYPES.map((type) => (
          <Button key={type} type="button" variant="outline" size="sm" className="justify-start text-xs" onClick={() => onAddField(type)}>
            Add {type} field
          </Button>
        ))}
      </div>
    </div>
  );
}
