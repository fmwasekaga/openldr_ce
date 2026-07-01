import type { NodeFormProps } from './index';
import { FormField, TextInput } from './shared';
import { CodeEditor } from './code-editor';

export function SqlForm({ node, update }: NodeFormProps) {
  const data = node.data as { label?: string; config?: { sql?: string } };
  const config = data.config ?? {};
  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField
        label="SQL (SELECT only)"
        hint="Runs over the reporting schema (read-only, row-capped). Use {{ $json.x }} to template values. Published datasets are queryable as wf_ds_<name> (one data jsonb column) — e.g. select data->>'col' from wf_ds_amr."
      >
        <CodeEditor
          language="sql"
          value={config.sql ?? ''}
          onChange={(v) => update({ config: { ...config, sql: v } })}
          placeholder={'select specimen_type, count(*) as n\nfrom lab_results\ngroup by specimen_type'}
          minHeight="12rem"
        />
      </FormField>
    </div>
  );
}
