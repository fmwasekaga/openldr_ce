import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';

/**
 * Stop and Error node form. Configures the error message that halts the
 * workflow. Supports {{ $json.foo }} templates.
 */
export function StopErrorForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const errorMessage = (config.errorMessage as string) ?? '';

  const patchConfig = (patch: Record<string, unknown>) =>
    update({ config: { ...config, ...patch } });

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <FormField
        label="Error Message"
        hint="Supports templates: {{ $json.reason }}. The workflow stops with this error."
      >
        <TextInput
          value={errorMessage}
          onChange={(e) => patchConfig({ errorMessage: e.target.value })}
          placeholder="Workflow stopped: invalid data"
        />
      </FormField>
    </div>
  );
}
