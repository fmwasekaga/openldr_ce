import { useState } from 'react';
import type { ClientOptionalJoin } from '../../api';
import type { AdhocDimension } from './builderForm.model';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

const columnsForAlias = (adhoc: AdhocDimension[], alias: string) =>
  adhoc.filter((d) => d.join === alias).map((d) => d.column);

/**
 * Relationship-first, multi-column picker for admin-declared optional joins. Picking a relationship
 * shows its (curated) columns as checkboxes, pre-checked from what the widget already uses; Apply
 * reconciles that relationship's columns via setRelationshipColumnsPatch. Join keys are shown
 * read-only — the user never chooses them.
 */
export function JoinDataPicker({ optionalJoins, adhoc, onApply, onCancel }: {
  optionalJoins: ClientOptionalJoin[];
  adhoc: AdhocDimension[];
  onApply: (alias: string, joinLabel: string, columns: string[]) => void;
  onCancel: () => void;
}) {
  const [alias, setAlias] = useState(optionalJoins[0]?.alias ?? '');
  const [checked, setChecked] = useState<string[]>(() => columnsForAlias(adhoc, optionalJoins[0]?.alias ?? ''));
  const join = optionalJoins.find((j) => j.alias === alias);

  const selectAlias = (a: string) => { setAlias(a); setChecked(columnsForAlias(adhoc, a)); };
  const toggle = (c: string) => setChecked((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
      <label>
        Related data
        <Select value={alias} onValueChange={selectAlias}>
          <SelectTrigger aria-label="Related data" className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {optionalJoins.map((j) => (
              <SelectItem key={j.alias} value={j.alias}>{j.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {join && <p className="text-xs text-muted-foreground">on {join.left} = {join.right}</p>}

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs text-muted-foreground">Columns</legend>
        {(join?.exposableColumns ?? []).map((c) => (
          <label key={c} className="flex items-center gap-2 text-xs">
            <input type="checkbox" aria-label={c} checked={checked.includes(c)} onChange={() => toggle(c)} />
            {c}
          </label>
        ))}
      </fieldset>

      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!alias} onClick={() => onApply(alias, join?.label ?? alias, checked)}>
          Apply
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
