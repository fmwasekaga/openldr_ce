import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, Select, TextInput } from './shared';

const list = (v: unknown) => (Array.isArray(v) ? (v as string[]).join(', ') : '');
const parse = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function PivotForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const patch = (p: Record<string, unknown>) => update({ config: { ...config, ...p } });
  return (
    <div className="space-y-4">
      <FormField label="Label"><TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} /></FormField>
      <FormField label="Group by" hint="Comma-separated key fields (one output row per unique key).">
        <TextInput value={list(config.groupBy)} onChange={(e) => patch({ groupBy: parse(e.target.value) })} />
      </FormField>
      <FormField label="Pivot column" hint="Field whose values become new column names.">
        <TextInput value={String(config.pivotColumn ?? '')} onChange={(e) => patch({ pivotColumn: e.target.value })} />
      </FormField>
      <FormField label="Value column" hint="Field supplying the cell values.">
        <TextInput value={String(config.valueColumn ?? '')} onChange={(e) => patch({ valueColumn: e.target.value })} />
      </FormField>
      <FormField label="Output columns" hint="Comma-separated fixed allow-list of pivot columns.">
        <TextInput value={list(config.columns)} onChange={(e) => patch({ columns: parse(e.target.value) })} />
      </FormField>
      <FormField label="Carry fields" hint="Comma-separated extra fields to keep from each group.">
        <TextInput value={list(config.carry)} onChange={(e) => patch({ carry: parse(e.target.value) })} />
      </FormField>
      <FormField label="Aggregate" hint="How to combine collisions within a group.">
        <Select value={String(config.aggregate ?? 'max')} onChange={(e) => patch({ aggregate: e.target.value })}>
          <option value="max">Max</option><option value="min">Min</option><option value="first">First</option><option value="last">Last</option>
        </Select>
      </FormField>
    </div>
  );
}
