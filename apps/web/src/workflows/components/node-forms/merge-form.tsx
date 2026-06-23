import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, Select, TextInput } from './shared';

/**
 * Merge node form. Configures how data from multiple incoming branches
 * is combined.
 */
export function MergeForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const mode = (config.mode as string) ?? 'append';
  const preferredBranch = (config.preferredBranch as number) ?? 0;

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
        label="Mode"
        hint="Append: collect into array. Combine: merge objects. Choose Branch: pick one input."
      >
        <Select value={mode} onChange={(e) => patchConfig({ mode: e.target.value })}>
          <option value="append">Append</option>
          <option value="combine">Combine (merge objects)</option>
          <option value="chooseBranch">Choose Branch</option>
        </Select>
      </FormField>

      {mode === 'chooseBranch' && (
        <FormField label="Branch Index" hint="0-based index of the incoming branch to use.">
          <TextInput
            type="number"
            value={preferredBranch}
            onChange={(e) => patchConfig({ preferredBranch: parseInt(e.target.value) || 0 })}
          />
        </FormField>
      )}
    </div>
  );
}
