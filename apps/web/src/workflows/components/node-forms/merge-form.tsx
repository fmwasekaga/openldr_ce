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
        hint="Append: collect into array. Combine: merge objects. Choose Branch: pick one input. Combine by key: SQL-style join on key fields."
      >
        <Select value={mode} onChange={(e) => patchConfig({ mode: e.target.value })}>
          <option value="append">Append</option>
          <option value="combine">Combine (merge objects)</option>
          <option value="chooseBranch">Choose Branch</option>
          <option value="combineByKey">Combine by key (join)</option>
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

      {mode === 'combineByKey' && (
        <>
          <FormField label="Join keys" hint="Comma-separated fields matched between the two branches.">
            <TextInput
              value={Array.isArray(config.joinKeys) ? (config.joinKeys as string[]).join(', ') : ''}
              onChange={(e) => patchConfig({ joinKeys: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </FormField>
          <FormField label="Join type" hint="Left keeps unmatched first-branch rows; inner drops them.">
            <Select value={(config.joinType as string) ?? 'left'} onChange={(e) => patchConfig({ joinType: e.target.value })}>
              <option value="left">Left</option>
              <option value="inner">Inner</option>
            </Select>
          </FormField>
        </>
      )}
    </div>
  );
}
