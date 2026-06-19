import * as React from 'react';
import type { FormField, FormFieldOption } from '@openldr/forms/pure';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface OptionsEditorProps {
  field: FormField;
  onUpdate: (patch: Partial<FormField>) => void;
}

export function OptionsEditor({ field, onUpdate }: OptionsEditorProps) {
  const options: FormFieldOption[] = field.valueSetOptions ?? [];

  function updateOption(index: number, key: keyof Pick<FormFieldOption, 'code' | 'display'>, value: string) {
    const next = options.map((opt, i) =>
      i === index ? { ...opt, [key]: value } : opt,
    );
    onUpdate({ valueSetOptions: next });
  }

  function addOption() {
    onUpdate({ valueSetOptions: [...options, { code: '', display: '' }] });
  }

  function removeOption(index: number) {
    onUpdate({ valueSetOptions: options.filter((_, i) => i !== index) });
  }

  return (
    <section className="mt-4">
      <h3 className="text-sm font-medium text-foreground pb-2 border-b border-border">
        Options
      </h3>

      <div className="py-3 space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label="Option code"
              value={opt.code}
              onChange={(e) => updateOption(i, 'code', e.target.value)}
              placeholder="Code"
              className="h-8 text-sm font-mono w-28 shrink-0"
            />
            <Input
              aria-label="Option display"
              value={opt.display}
              onChange={(e) => updateOption(i, 'display', e.target.value)}
              placeholder="Display"
              className="h-8 text-sm flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove option"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeOption(i)}
            >
              ×
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Add option"
        onClick={addOption}
        className="w-full mt-1"
      >
        + Add option
      </Button>
    </section>
  );
}
