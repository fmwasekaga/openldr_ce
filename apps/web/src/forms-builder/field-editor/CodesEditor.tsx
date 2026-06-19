import * as React from 'react';
import type { FormField, FormFieldCoding } from '@openldr/forms/pure';
import { TermPicker, type PickedTerm } from '@/terminology/TermPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export interface CodesEditorProps {
  field: FormField;
  onUpdate: (patch: Partial<FormField>) => void;
}

/**
 * Renders the "Codes" section of the Edit Field sheet.
 *
 * Shows each existing coding as a chip (system · code · display) with a
 * remove (×) button, and a TermPicker to append additional codings.
 *
 * TermPicker requires a `systemId` (the terminology system URL). The user
 * picks a system from a small text input before searching.
 */
export function CodesEditor({ field, onUpdate }: CodesEditorProps): JSX.Element {
  const codes: FormFieldCoding[] = field.code ?? [];
  const [systemId, setSystemId] = React.useState('http://loinc.org');
  // null = search mode, value = just picked (reset back to null so picker stays open)
  const [pickerValue, setPickerValue] = React.useState<PickedTerm | null>(null);

  function removeCode(index: number): void {
    onUpdate({ code: codes.filter((_, i) => i !== index) });
  }

  function handlePick(picked: PickedTerm | null): void {
    if (!picked) {
      setPickerValue(null);
      return;
    }
    const newCoding: FormFieldCoding = {
      system: picked.system,
      code: picked.code,
      ...(picked.display != null ? { display: picked.display } : {}),
    };
    onUpdate({ code: [...codes, newCoding] });
    // Reset picker so the user can add another
    setPickerValue(null);
  }

  return (
    <section className="mt-2">
      {/* Existing code chips */}
      {codes.length > 0 && (
        <div className="flex flex-wrap gap-2 py-3">
          {codes.map((c, i) => (
            <div
              key={`${c.system}|${c.code}|${i}`}
              className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5"
            >
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={c.system}>
                {c.system.replace(/^https?:\/\//, '')}
              </span>
              <Badge
                variant="secondary"
                className="rounded-full font-mono text-xs px-1.5 py-0"
              >
                {c.code}
              </Badge>
              {c.display && (
                <span className="text-xs text-foreground">{c.display}</span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove code"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeCode(i)}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add a new coding */}
      <div className="py-3 space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="codes-system-input" className="whitespace-nowrap text-xs">
            System
          </Label>
          <Input
            id="codes-system-input"
            aria-label="Terminology system"
            value={systemId}
            onChange={(e) => setSystemId(e.target.value)}
            placeholder="http://loinc.org"
            className="h-8 text-xs flex-1 font-mono"
          />
        </div>
        <TermPicker
          value={pickerValue}
          onChange={handlePick}
          systemId={systemId}
        />
      </div>
    </section>
  );
}
