import type { NodeFormProps } from './index';
import { FormField, TextArea, TextInput } from './shared';

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
        <TextArea
          className="h-48 resize-none font-mono text-xs"
          value={config.sql ?? ''}
          onChange={(e) => update({ config: { ...config, sql: e.target.value } })}
          spellCheck={false}
          placeholder={'select specimen_type, count(*) as n\nfrom lab_results\ngroup by specimen_type'}
        />
      </FormField>
    </div>
  );
}
