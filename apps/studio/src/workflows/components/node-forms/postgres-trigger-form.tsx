import type { NodeFormProps } from './index';
import type { TriggerNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';
import { ConnectorSelect } from './connector-select';

/**
 * Postgres trigger form. Fires the workflow when a NOTIFY arrives on the given
 * channel of the selected Postgres connector.
 *
 * Field-name contract (read by the trigger runner): data.triggerType = 'postgres',
 * data.config.{connectorId, channel}.
 */
export function PostgresTriggerForm({ node, update }: NodeFormProps) {
  const data = node.data as TriggerNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const connectorId = (config.connectorId as string | undefined) ?? '';
  const channel = (config.channel as string | undefined) ?? '';

  const patchConfig = (patch: Record<string, unknown>) =>
    update({ config: { ...config, ...patch } });

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>

      <FormField label="Connector" hint="A Postgres connector to LISTEN on.">
        <ConnectorSelect
          type="postgres"
          value={connectorId}
          onChange={(id) => patchConfig({ connectorId: id })}
        />
      </FormField>

      <FormField label="Channel" hint="The NOTIFY channel to listen on (e.g. lab_events).">
        <TextInput
          value={channel}
          onChange={(e) => patchConfig({ channel: e.target.value })}
          placeholder="channel name"
        />
      </FormField>
    </div>
  );
}
