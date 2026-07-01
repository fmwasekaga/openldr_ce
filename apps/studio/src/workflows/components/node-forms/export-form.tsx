import type { NodeFormProps } from './index';
import { FormField, TextInput, Select } from './shared';

export function ExportForm({ node, update }: NodeFormProps) {
  const data = node.data as { label?: string; config?: { format?: string; filename?: string } };
  const config = data.config ?? {};
  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="Format">
        <Select
          value={config.format ?? 'csv'}
          onChange={(e) => update({ config: { ...config, format: e.target.value } })}
        >
          <option value="csv">CSV</option>
          <option value="xlsx">Excel (XLSX)</option>
          <option value="pdf">PDF</option>
        </Select>
      </FormField>
      <FormField label="Filename" hint="Optional. Defaults to export.<format> if left blank.">
        <TextInput
          value={config.filename ?? ''}
          onChange={(e) => update({ config: { ...config, filename: e.target.value } })}
          placeholder="my-export.csv"
        />
      </FormField>
    </div>
  );
}
