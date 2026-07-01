import type { NodeFormProps } from './index';
import type { TriggerNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';
import { Switch } from '@/components/ui/switch';
import { ConnectorSelect } from './connector-select';

/**
 * Email trigger form. Polls an IMAP mailbox and fires the workflow for each new
 * message in the given folder.
 *
 * Field-name contract (read by the trigger runner): data.triggerType = 'email',
 * data.config.{connectorId, folder, pollSeconds, markSeen}.
 */
export function EmailTriggerForm({ node, update }: NodeFormProps) {
  const data = node.data as TriggerNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const connectorId = (config.connectorId as string | undefined) ?? '';
  const folder = (config.folder as string | undefined) ?? 'INBOX';
  const pollSeconds = (config.pollSeconds as number | undefined) ?? 60;
  const markSeen = config.markSeen === undefined ? true : Boolean(config.markSeen);

  const patchConfig = (patch: Record<string, unknown>) =>
    update({ config: { ...config, ...patch } });

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>

      <FormField label="Connector" hint="An IMAP connector to poll for new mail.">
        <ConnectorSelect
          type="imap"
          value={connectorId}
          onChange={(id) => patchConfig({ connectorId: id })}
        />
      </FormField>

      <FormField label="Folder" hint="Mailbox folder to poll.">
        <TextInput
          value={folder}
          onChange={(e) => patchConfig({ folder: e.target.value })}
          placeholder="INBOX"
        />
      </FormField>

      <FormField label="Poll seconds" hint="How often to check for new mail. Minimum 30.">
        <TextInput
          type="number"
          value={pollSeconds}
          min={30}
          onChange={(e) => patchConfig({ pollSeconds: Math.max(30, parseInt(e.target.value) || 60) })}
        />
      </FormField>

      <div className="flex items-center justify-between gap-3 py-0.5">
        <span className="text-sm text-foreground">Mark as read</span>
        <Switch
          checked={markSeen}
          onCheckedChange={(v) => patchConfig({ markSeen: v })}
          aria-label="Mark as read"
        />
      </div>
    </div>
  );
}
