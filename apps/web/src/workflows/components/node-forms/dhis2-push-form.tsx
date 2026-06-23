import type { NodeFormProps } from './index';
import { FormField, TextInput, inputClass } from './shared';

export function Dhis2PushForm({ node, update }: NodeFormProps) {
  const data = node.data as {
    label?: string;
    config?: { mappingId?: string; period?: string; dryRun?: boolean };
  };
  const config = data.config ?? {};
  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="Mapping ID" hint="The DHIS2 mapping configured in Settings › DHIS2.">
        <TextInput
          value={config.mappingId ?? ''}
          onChange={(e) => update({ config: { ...config, mappingId: e.target.value } })}
          placeholder="amr-mapping"
        />
      </FormField>
      <FormField label="Period" hint="DHIS2 period string, e.g. 202401, 2024Q1, 2024W01.">
        <TextInput
          value={config.period ?? ''}
          onChange={(e) => update({ config: { ...config, period: e.target.value } })}
          placeholder="202401"
        />
      </FormField>
      <div className="flex items-center gap-2">
        <input
          id="dhis2-dryrun"
          type="checkbox"
          className={inputClass + ' mt-0 h-4 w-4 cursor-pointer'}
          checked={config.dryRun ?? false}
          onChange={(e) => update({ config: { ...config, dryRun: e.target.checked } })}
        />
        <label htmlFor="dhis2-dryrun" className="cursor-pointer text-sm text-foreground">
          Dry run (validate only, do not submit)
        </label>
      </div>
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-amber-400">
        Requires DHIS2 to be configured as the reporting target in Settings › DHIS2. Without it the node will error at run time.
      </p>
    </div>
  );
}
