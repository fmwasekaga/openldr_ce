import type { NodeFormProps } from './index';
import type { TriggerNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';

/**
 * Ingest trigger form. Fires the workflow when a lab-data batch finishes
 * ingesting (the durable `ingest.batch.done` event).
 *
 * Field-name contract (read by the server's `syncWorkflowTriggers`):
 *   data.triggerType = 'ingest', data.config.sourceFilter (optional).
 */
export function IngestForm({ node, update }: NodeFormProps) {
  const data = node.data as TriggerNodeData;
  const config = data.config ?? {};
  const sourceFilter = (config.sourceFilter as string | undefined) ?? '';

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <FormField label="Event" hint="Fires whenever a lab-data batch finishes ingesting.">
        <div className="mt-1.5 break-all rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          ingest.batch.done
        </div>
      </FormField>

      <FormField
        label="Source Filter"
        hint="Optional. Only run for batches from this source (e.g. whonet). Leave empty to run for all sources."
      >
        <TextInput
          value={sourceFilter}
          onChange={(e) => update({ config: { ...config, sourceFilter: e.target.value } })}
          placeholder="whonet"
        />
      </FormField>
    </div>
  );
}
