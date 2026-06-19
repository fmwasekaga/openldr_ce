import type { FormField } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import { ValueSetPicker } from '@/terminology/ValueSetPicker';
import { expandValueSet, type ValueSetSummary } from '../api';

export function ValueSetBindingEditor({ field, onChange }: { field: FormField; onChange: (updates: Partial<FormField>) => void }): JSX.Element {
  const bind = async (valueSet: ValueSetSummary) => {
    const expanded = await expandValueSet(valueSet.id);
    onChange({
      valueSetBinding: { valueSetId: valueSet.id, url: valueSet.url, strength: 'required', expandedAt: new Date().toISOString() },
      options: expanded.codes.map((code) => ({ code: code.code, system: code.system, display: { en: code.display ?? code.code } })),
    });
  };
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">ValueSet binding</div>
      <ValueSetPicker onPick={(valueSet) => { void bind(valueSet); }} />
      {field.valueSetBinding ? <div className="text-xs text-muted-foreground">{field.valueSetBinding.url}</div> : null}
      {field.valueSetBinding ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ valueSetBinding: undefined, options: [] })}>Clear binding</Button> : null}
    </div>
  );
}
