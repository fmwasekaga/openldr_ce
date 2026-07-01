import type { NodeFormProps } from './index';
import { FormField, TextInput } from './shared';

export function FhirForm({ node, update }: NodeFormProps) {
  const data = node.data as { label?: string; config?: { resourceType?: string; limit?: number } };
  const config = data.config ?? {};
  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="Resource type" hint="e.g. Observation, Specimen, Patient">
        <TextInput
          value={config.resourceType ?? ''}
          onChange={(e) => update({ config: { ...config, resourceType: e.target.value } })}
          placeholder="Observation"
        />
      </FormField>
      <FormField label="Limit">
        <TextInput
          type="number"
          value={String(config.limit ?? 100)}
          onChange={(e) => update({ config: { ...config, limit: Number(e.target.value) } })}
        />
      </FormField>
    </div>
  );
}
