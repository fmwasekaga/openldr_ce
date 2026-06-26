import { useCallback, useEffect, useState } from 'react';
import type { NodeFormProps } from './index';
import { FormField, TextInput, Select, inputClass } from './shared';
import { Button } from '@/components/ui/button';
import { listDhis2PushMappings, testConnector, type WorkflowDhis2Mapping } from '@/api';

export function Dhis2PushForm({ node, update }: NodeFormProps) {
  const data = node.data as {
    label?: string;
    config?: { mappingId?: string; period?: string; dryRun?: boolean };
  };
  const config = data.config ?? {};
  const [mappings, setMappings] = useState<WorkflowDhis2Mapping[]>([]);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { void listDhis2PushMappings().then(setMappings).catch(() => setMappings([])); }, []);

  const onTest = useCallback(async () => {
    const mappingId = config.mappingId;
    if (!mappingId) { setTestMsg('Select a mapping first.'); return; }
    setTesting(true); setTestMsg('Testing…');
    try {
      const connectorId = mappings.find((m) => m.id === mappingId)?.connectorId;
      if (!connectorId) { setTestMsg('This mapping has no connector configured (set it in the DHIS2 plugin).'); return; }
      const res = await testConnector(connectorId);
      setTestMsg(res.ok ? `Connected. ${res.metadata.dataElements} data elements, ${res.metadata.orgUnits} org units.` : `Test failed: ${res.error}`);
    } catch (e) {
      setTestMsg(`Test failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  }, [config.mappingId, mappings]);

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="Mapping" hint="A DHIS2 mapping from the DHIS2 plugin. The mapping carries the connector to push to.">
        <Select
          data-testid="dhis2-mapping-select"
          value={config.mappingId ?? ''}
          onChange={(e) => update({ config: { ...config, mappingId: e.target.value } })}
        >
          <option value="">Select a mapping…</option>
          {mappings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
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
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" data-testid="dhis2-test" disabled={testing} onClick={() => void onTest()}>
          Test connection
        </Button>
        {testMsg ? <span className="text-xs text-muted-foreground" data-testid="dhis2-test-result">{testMsg}</span> : null}
      </div>
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-amber-400">
        The selected mapping must point at an enabled connector (Settings › Connectors). Without it the node will error at run time.
      </p>
    </div>
  );
}
