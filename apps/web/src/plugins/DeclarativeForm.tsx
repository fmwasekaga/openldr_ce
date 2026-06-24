import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pluginBrokerCall } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface JsonProp { type: 'string' | 'number' | 'boolean'; title?: string; enum?: string[] }
interface JsonSchema { type: 'object'; properties: Record<string, JsonProp> }

const COLLECTION = 'config';
const KEY = 'declarative';

export function DeclarativeForm({ pluginId, schema }: { pluginId: string; schema: unknown }): JSX.Element {
  const { t } = useTranslation();
  const props = ((schema as JsonSchema | null)?.properties) ?? {};
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void pluginBrokerCall(pluginId, { kind: 'storage.get', collection: COLLECTION, key: KEY }).then((r) => {
      if (!cancelled && r.ok && r.data && typeof r.data === 'object') setValues(r.data as Record<string, unknown>);
    });
    return () => { cancelled = true; };
  }, [pluginId]);

  function set(k: string, v: unknown) { setValues((prev) => ({ ...prev, [k]: v })); }

  async function save() {
    setSaving(true);
    try { await pluginBrokerCall(pluginId, { kind: 'storage.put', collection: COLLECTION, key: KEY, doc: values }); }
    finally { setSaving(false); }
  }

  return (
    <div className="max-w-xl space-y-4 p-6">
      {Object.entries(props).map(([key, p]) => {
        const label = p.title ?? key;
        if (p.type === 'boolean') {
          return (
            <div key={key} className="flex items-center justify-between">
              <Label>{label}</Label>
              <Switch aria-label={label} checked={Boolean(values[key])} onCheckedChange={(c) => set(key, c)} />
            </div>
          );
        }
        if (p.enum) {
          return (
            <div key={key} className="space-y-1">
              <Label htmlFor={key}>{label}</Label>
              <Select value={String(values[key] ?? '')} onValueChange={(v) => set(key, v)}>
                <SelectTrigger id={key}><SelectValue /></SelectTrigger>
                <SelectContent>{p.enum.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          );
        }
        return (
          <div key={key} className="space-y-1">
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              type={p.type === 'number' ? 'number' : 'text'}
              value={String(values[key] ?? '')}
              onChange={(e) => set(key, p.type === 'number' ? Number(e.target.value) : e.target.value)}
            />
          </div>
        );
      })}
      <Button onClick={save} disabled={saving}>{t('common.save')}</Button>
    </div>
  );
}
