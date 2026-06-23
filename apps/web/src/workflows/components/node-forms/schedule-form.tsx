import type { NodeFormProps } from './index';
import type { TriggerNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';

/**
 * Schedule trigger form. The cron expression + timezone are read by the backend
 * scheduler to fire the workflow on a timer.
 *
 * Field-name contract (read by the server's `syncWorkflowTriggers`):
 *   data.triggerType = 'schedule', data.cron, data.tz.
 */
export function ScheduleForm({ node, update }: NodeFormProps) {
  const data = node.data as TriggerNodeData;
  const cron = (data.cron as string | undefined) ?? '';
  const tz = (data.tz as string | undefined) ?? '';

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <FormField
        label="Cron Expression"
        hint="Standard cron format: minute hour day month weekday. E.g. */5 * * * * (every 5 min)."
      >
        <TextInput
          value={cron}
          onChange={(e) => update({ cron: e.target.value })}
          placeholder="* * * * *"
          className="font-mono"
        />
      </FormField>

      <FormField label="Timezone" hint="IANA timezone, e.g. America/New_York. Leave empty for UTC.">
        <TextInput
          value={tz}
          onChange={(e) => update({ tz: e.target.value })}
          placeholder="UTC"
        />
      </FormField>
    </div>
  );
}
