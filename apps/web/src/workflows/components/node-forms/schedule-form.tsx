import type { NodeFormProps } from './index';
import type { TriggerNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';

/**
 * Schedule trigger form. The cron expression is stored in config and used
 * by the backend scheduler (when available) to fire the workflow on a timer.
 */
export function ScheduleForm({ node, update }: NodeFormProps) {
  const data = node.data as TriggerNodeData;
  const config = data.config ?? {};
  const cronExpression = (config.cronExpression as string) ?? '';
  const timezone = (config.timezone as string) ?? '';

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
        label="Cron Expression"
        hint="Standard cron format: minute hour day month weekday. E.g. */5 * * * * (every 5 min)."
      >
        <TextInput
          value={cronExpression}
          onChange={(e) => patchConfig({ cronExpression: e.target.value })}
          placeholder="* * * * *"
          className="font-mono"
        />
      </FormField>

      <FormField label="Timezone" hint="IANA timezone, e.g. America/New_York. Leave empty for UTC.">
        <TextInput
          value={timezone}
          onChange={(e) => patchConfig({ timezone: e.target.value })}
          placeholder="UTC"
        />
      </FormField>
    </div>
  );
}
