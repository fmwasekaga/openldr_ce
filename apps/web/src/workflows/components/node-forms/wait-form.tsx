import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, Select, TextInput } from './shared';

/**
 * Wait node form. Configures a delay duration before the workflow continues.
 */
export function WaitForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const duration = (config.duration as number) ?? 1;
  const unit = (config.unit as string) ?? 's';

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

      <FormField label="Duration" hint="Maximum 30 seconds. Longer waits are capped.">
        <div className="mt-1.5 flex items-center gap-2">
          <TextInput
            type="number"
            value={duration}
            onChange={(e) => patchConfig({ duration: parseFloat(e.target.value) || 0 })}
            className="!mt-0 w-24"
            min={0}
          />
          <Select
            value={unit}
            onChange={(e) => patchConfig({ unit: e.target.value })}
            className="!mt-0 w-24"
          >
            <option value="ms">ms</option>
            <option value="s">seconds</option>
            <option value="m">minutes</option>
          </Select>
        </div>
      </FormField>
    </div>
  );
}
