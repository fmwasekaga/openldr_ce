import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';

/**
 * Execute Workflow node form. Calls another saved workflow as a sub-workflow,
 * passing the current upstream output as its input.
 */
export function ExecuteWorkflowForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const workflowId = (config.workflowId as string) ?? '';
  const waitForCompletion = config.waitForCompletion !== false;

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

      <FormField label="Workflow ID" hint="The ID of a saved workflow to execute.">
        <TextInput
          value={workflowId}
          onChange={(e) => patchConfig({ workflowId: e.target.value })}
          placeholder="workflow-id"
          className="font-mono"
        />
      </FormField>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="waitForCompletion"
          checked={waitForCompletion}
          onChange={(e) => patchConfig({ waitForCompletion: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-border"
        />
        <label htmlFor="waitForCompletion" className="text-xs text-muted-foreground">
          Wait for completion
        </label>
      </div>

      {!waitForCompletion && (
        <p className="text-[10px] leading-snug text-muted-foreground/80">
          Fire-and-forget mode: the sub-workflow starts but this node continues
          immediately without waiting for it to finish.
        </p>
      )}
    </div>
  );
}
