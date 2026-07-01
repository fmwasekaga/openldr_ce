import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';
import { CodeEditor } from './code-editor';
import { ConnectorSelect } from './connector-select';

const DB_LABEL: Record<string, string> = {
  postgres: 'Postgres',
  'microsoft-sql': 'Microsoft SQL',
  mysql: 'MySQL',
};

/**
 * Config form for the SQL database nodes (postgres / microsoft-sql / mysql).
 * The connector's type drives the dialect, so all three share this form; the
 * dialect is read from `data.action`. SQL is edited in the CodeMirror editor
 * (syntax highlight + line numbers) rather than a plain textarea.
 */
export function DatabaseForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const dbType = (data.action as string) || 'postgres';
  const patch = (p: Record<string, unknown>) => update({ config: { ...config, ...p } });

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="Connector" hint={`Select a ${DB_LABEL[dbType] ?? dbType} connector.`}>
        <ConnectorSelect type={dbType} value={String(config.connectorId ?? '')} onChange={(id) => patch({ connectorId: id })} />
      </FormField>
      <FormField label="SQL" hint="Use {{ $json.x }} to template values from the incoming item.">
        <CodeEditor
          language="sql"
          value={String(config.sql ?? '')}
          onChange={(v) => patch({ sql: v })}
          placeholder={'select *\nfrom my_table\nwhere created_at >= \'{{ $json.periodStart }}\''}
          minHeight="12rem"
        />
      </FormField>
    </div>
  );
}
