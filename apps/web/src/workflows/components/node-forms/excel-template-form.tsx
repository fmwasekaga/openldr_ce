import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';

/** Config form for the Excel Template node. `columns` is a comma-separated ordered field list. */
export function ExcelTemplateForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const patch = (p: Record<string, unknown>) => update({ config: { ...config, ...p } });
  const columns = Array.isArray(config.columns) ? (config.columns as string[]).join(', ') : '';
  const pw = (config.password as { connectorId?: string; key?: string } | undefined) ?? {};

  return (
    <div className="space-y-4">
      <FormField label="Label"><TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} /></FormField>
      <FormField label="Template artifact key" hint="Object key of the uploaded .xlsx template.">
        <TextInput value={String(config.templateRef ?? '')} onChange={(e) => patch({ templateRef: e.target.value })} />
      </FormField>
      <FormField label="Start cell" hint="Top-left of the data write range, e.g. A2.">
        <TextInput value={String(config.startCell ?? 'A2')} onChange={(e) => patch({ startCell: e.target.value })} />
      </FormField>
      <FormField label="Columns (ordered)" hint="Comma-separated item fields, in template column order.">
        <TextInput value={columns} onChange={(e) => patch({ columns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
      </FormField>
      <FormField label="Auto-filter header cell" hint="e.g. A1. Leave blank to disable.">
        <TextInput value={String(config.autoFilter ?? '')} onChange={(e) => patch({ autoFilter: e.target.value })} />
      </FormField>
      <FormField label="File name" hint="Output attachment name; supports templating.">
        <TextInput value={String(config.fileName ?? '')} onChange={(e) => patch({ fileName: e.target.value })} />
      </FormField>
      <FormField label="Password connector id" hint="Connector holding the report password (optional).">
        <TextInput value={pw.connectorId ?? ''} onChange={(e) => patch({ password: { ...pw, connectorId: e.target.value } })} />
      </FormField>
      <FormField label="Password secret key" hint="Config key of the password within that connector.">
        <TextInput value={pw.key ?? ''} onChange={(e) => patch({ password: { ...pw, key: e.target.value } })} />
      </FormField>
    </div>
  );
}
