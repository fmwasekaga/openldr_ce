import { useState } from 'react';
import type { ClientOptionalJoin } from '../../api';
import type { AdhocDimension } from './builderForm.model';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/** Query-local key for an ad-hoc join column. */
export function adhocKey(join: string, column: string): string {
  return `${join}__${column}`;
}

// Columns that look like dates/numbers get a better default kind; everything else is a string.
function inferKind(column: string): AdhocDimension['kind'] {
  if (/(_at|_time|date|timestamp|issued|authored|received|effective)/i.test(column)) return 'date';
  if (/(count|value|amount|age|number|_id$)/i.test(column)) return 'number';
  return 'string';
}

const humanize = (column: string) =>
  column.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function JoinColumnPicker({
  optionalJoins,
  onAdd,
  onCancel,
}: {
  optionalJoins: ClientOptionalJoin[];
  onAdd: (dim: AdhocDimension) => void;
  onCancel: () => void;
}) {
  const [alias, setAlias] = useState(optionalJoins[0]?.alias ?? '');
  const [column, setColumn] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<AdhocDimension['kind']>('string');
  const join = optionalJoins.find((j) => j.alias === alias);

  const pickColumn = (c: string) => {
    setColumn(c);
    setKind(inferKind(c));
    setLabel(`${join?.label ?? alias} → ${humanize(c)}`);
  };

  const confirm = () => {
    if (!alias || !column) return;
    onAdd({ key: adhocKey(alias, column), label: label || humanize(column), join: alias, column, kind });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
      <label>
        Join
        <Select
          value={alias}
          onValueChange={(a) => {
            setAlias(a);
            setColumn('');
            setLabel('');
          }}
        >
          <SelectTrigger aria-label="Join" className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {optionalJoins.map((j) => (
              <SelectItem key={j.alias} value={j.alias}>
                {j.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label>
        Column
        <Select value={column} onValueChange={pickColumn}>
          <SelectTrigger aria-label="Column" className="mt-1 w-full">
            <SelectValue placeholder="Pick a column" />
          </SelectTrigger>
          <SelectContent>
            {(join?.exposableColumns ?? []).map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label>
        Label
        <Input
          aria-label="Label"
          className="mt-1 h-8"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>

      <label>
        Kind
        <Select value={kind} onValueChange={(k) => setKind(k as AdhocDimension['kind'])}>
          <SelectTrigger aria-label="Kind" className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="string">string</SelectItem>
            <SelectItem value="date">date</SelectItem>
            <SelectItem value="number">number</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!column} onClick={confirm}>
          Add column
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
