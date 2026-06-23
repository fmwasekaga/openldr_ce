import type { NodeFormProps } from './index';
import { FormField, TextInput } from './shared';

export function LoadDatasetForm({ node, update }: NodeFormProps) {
  const data = node.data as { label?: string; config?: { datasetName?: string } };
  const config = data.config ?? {};
  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="Dataset name" hint="Reads a previously materialized dataset's rows into this workflow.">
        <TextInput
          value={config.datasetName ?? ''}
          onChange={(e) => update({ config: { ...config, datasetName: e.target.value } })}
          placeholder="amr"
        />
      </FormField>
    </div>
  );
}
