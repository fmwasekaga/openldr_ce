import type { FieldType, FormField } from '@openldr/forms/pure';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TYPES: FieldType[] = ['string', 'text', 'integer', 'decimal', 'boolean', 'date', 'dateTime', 'choice', 'open-choice', 'reference', 'quantity'];

export function PropertiesSheet({ field, onChange }: { field: FormField | null; onChange: (updates: Partial<FormField>) => void }): JSX.Element {
  if (!field) return <div className="text-xs text-muted-foreground">Select a field to edit properties.</div>;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="field-label" className="text-xs">Field label</Label>
        <Input id="field-label" aria-label="Field label" value={field.label.en} onChange={(event) => onChange({ label: { ...field.label, en: event.target.value } })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="field-id" className="text-xs">Field id</Label>
        <Input id="field-id" aria-label="Field id" value={field.id} onChange={(event) => onChange({ id: event.target.value })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Field type</Label>
        <Select value={field.type} onValueChange={(value) => onChange({ type: value as FieldType })}>
          <SelectTrigger aria-label="Field type"><SelectValue /></SelectTrigger>
          <SelectContent>{TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox checked={Boolean(field.required)} onCheckedChange={(checked) => onChange({ required: Boolean(checked) })} />
        Required
      </label>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox checked={Boolean(field.repeats)} onCheckedChange={(checked) => onChange({ repeats: Boolean(checked) })} />
        Repeats
      </label>
      <div className="space-y-1">
        <Label htmlFor="field-fhir-path" className="text-xs">FHIR path</Label>
        <Input id="field-fhir-path" aria-label="FHIR path" value={field.fhirPath ?? ''} onChange={(event) => onChange({ fhirPath: event.target.value || undefined })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="field-unit" className="text-xs">Unit</Label>
        <Input id="field-unit" aria-label="Unit" value={field.unit ?? ''} onChange={(event) => onChange({ unit: event.target.value || undefined })} />
      </div>
    </div>
  );
}
