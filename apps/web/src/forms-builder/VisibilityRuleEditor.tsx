import type { FormField } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function VisibilityRuleEditor({ field, fields, onChange }: { field: FormField; fields: FormField[]; onChange: (visibility: FormField['visibility'] | undefined) => void }): JSX.Element {
  const candidates = fields.filter((candidate) => candidate.id !== field.id);
  const visibility = field.visibility;
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">Visibility</div>
      <Select value={visibility?.whenField ?? '__always'} onValueChange={(value) => onChange(value === '__always' ? undefined : { whenField: value, equals: '' })}>
        <SelectTrigger aria-label="Visibility field"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__always">Always visible</SelectItem>
          {candidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.label.en}</SelectItem>)}
        </SelectContent>
      </Select>
      {visibility ? (
        <Input aria-label="Visibility value" value={String(visibility.equals)} onChange={(event) => onChange({ ...visibility, equals: event.target.value })} />
      ) : null}
      {visibility ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>Clear visibility</Button> : null}
    </div>
  );
}
