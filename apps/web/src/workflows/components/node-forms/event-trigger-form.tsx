import type { NodeFormProps } from './index';
import type { TriggerNodeData } from '../../lib/types';
import { FormField, TextInput, Select } from './shared';

/**
 * Event trigger form. Fires the workflow when a matching internal domain event
 * is published (pass one: `data.persisted`, emitted by the Persist Store node).
 *
 * Field-name contract (read by the server's event-trigger indexing + the runner's
 * eventNodeMatches): data.triggerType = 'event', data.config.{event,source,resourceType}.
 */
export function EventTriggerForm({ node, update }: NodeFormProps) {
  const data = node.data as TriggerNodeData;
  const config = data.config ?? {};
  const event = (config.event as string | undefined) ?? 'data.persisted';
  const source = (config.source as string | undefined) ?? '';
  const resourceType = (config.resourceType as string | undefined) ?? '';

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>

      <FormField label="Event" hint="Fires when this internal event is published.">
        <Select value={event} onChange={(e) => update({ config: { ...config, event: e.target.value } })}>
          <option value="data.persisted">data.persisted</option>
        </Select>
      </FormField>

      <FormField label="Source filter" hint="Optional. Only run for events from this source (e.g. demo-lab). Empty = all.">
        <TextInput
          value={source}
          onChange={(e) => update({ config: { ...config, source: e.target.value } })}
          placeholder="demo-lab"
        />
      </FormField>

      <FormField label="Resource type filter" hint="Optional. Only run when this resource type was persisted (e.g. Observation). Empty = all.">
        <TextInput
          value={resourceType}
          onChange={(e) => update({ config: { ...config, resourceType: e.target.value } })}
          placeholder="Observation"
        />
      </FormField>
    </div>
  );
}
