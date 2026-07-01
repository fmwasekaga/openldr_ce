import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, TextInput, TextArea, Select } from './shared';
import { ConnectorSelect } from './connector-select';

/** action → the connector type its picker filters to. */
const CONNECTOR_TYPE: Record<string, string> = {
  'send-email': 'smtp',
  gmail: 'gmail',
  outlook: 'outlook',
};

/**
 * Config form for the email action nodes (send-email / gmail / outlook).
 * Connector picker is filtered to the matching host type; the produced
 * attachment (from an upstream Excel Template / file node) rides along via
 * `attachBinaryField`.
 */
export function EmailForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const patch = (p: Record<string, unknown>) => update({ config: { ...config, ...p } });
  const connType = CONNECTOR_TYPE[(data.action as string) ?? 'send-email'] ?? 'smtp';
  const attach = config.attachBinaryField === undefined ? 'file' : String(config.attachBinaryField);

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="Connector" hint="Select the email connector that sends the message.">
        <ConnectorSelect type={connType} value={String(config.connectorId ?? '')} onChange={(id) => patch({ connectorId: id })} />
      </FormField>
      <FormField label="To" hint="Recipient address(es), comma-separated. Supports {{ $json.x }}.">
        <TextInput value={String(config.to ?? '')} onChange={(e) => patch({ to: e.target.value })} placeholder="you@gmail.com" />
      </FormField>
      <FormField label="Cc" hint="Optional, comma-separated.">
        <TextInput value={String(config.cc ?? '')} onChange={(e) => patch({ cc: e.target.value })} />
      </FormField>
      <FormField label="Subject">
        <TextInput value={String(config.subject ?? '')} onChange={(e) => patch({ subject: e.target.value })} />
      </FormField>
      <FormField label="Body">
        <TextArea rows={5} value={String(config.body ?? '')} onChange={(e) => patch({ body: e.target.value })} />
      </FormField>
      <FormField label="Body format">
        <Select value={config.html ? 'html' : 'text'} onChange={(e) => patch({ html: e.target.value === 'html' })}>
          <option value="text">Plain text</option>
          <option value="html">HTML</option>
        </Select>
      </FormField>
      <FormField label="Attachment field" hint="Binary field on the incoming item to attach (e.g. the Excel Template output). Blank = no attachment.">
        <TextInput value={attach} onChange={(e) => patch({ attachBinaryField: e.target.value })} />
      </FormField>
    </div>
  );
}
