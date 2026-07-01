import { useEffect, useState } from 'react';
import type { NodeFormProps } from './index';
import { FormField, TextInput, Select } from './shared';
import { CodeEditor } from './code-editor';
import { Switch } from '@/components/ui/switch';
import { fetchWorkflowNodes, fetchNodeOptions, fetchNodeDetail, type WorkflowNodeConfigField, type WorkflowNodeOption } from '@/api';

export function DeclarativeNodeForm({ node, update }: NodeFormProps) {
  const data = node.data as {
    label?: string;
    pluginId?: string;
    nodeId?: string;
    action?: string;
    templateId?: string;
    config?: Record<string, unknown>;
  };
  const config = data.config ?? {};
  const [fields, setFields] = useState<WorkflowNodeConfigField[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPlugin = Boolean(data.pluginId);
  const hostId = data.action ?? data.templateId ?? data.nodeId;

  useEffect(() => {
    void fetchWorkflowNodes()
      .then((nodes) => {
        const match = isPlugin
          ? nodes.find(
              (n) =>
                n.pluginId === data.pluginId &&
                (n.id === `${data.pluginId}:${data.nodeId}` || n.id === data.nodeId),
            )
          : nodes.find((n) => n.source === 'host' && n.id === hostId);
        if (!match) {
          // Plugin nodes whose plugin was uninstalled show a warning; host nodes
          // with no declarative config simply render label-only.
          if (isPlugin) setError('This plugin node is no longer installed.');
          setFields([]);
          return;
        }
        setFields(match.config);
      })
      .catch(() => {
        if (isPlugin) setError('Could not load node configuration.');
        setFields([]);
      });
  }, [data.pluginId, data.nodeId, isPlugin, hostId]);

  const setField = (key: string, value: unknown, merge?: Record<string, unknown>) =>
    update({ config: { ...config, [key]: value, ...merge } } as never);

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value } as never)} />
      </FormField>
      {error && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
          {error}
        </p>
      )}
      {fields === null && (
        <p className="text-xs text-muted-foreground">Loading configuration…</p>
      )}
      {fields?.map((f) => (
        <PluginField
          key={f.key}
          field={f}
          pluginId={data.pluginId}
          value={config[f.key]}
          onChange={(v) => setField(f.key, v)}
          onChangeMerge={(v, merge) => setField(f.key, v, merge)}
        />
      ))}
    </div>
  );
}

/** Back-compat alias — plugin nodes route here too. */
export const PluginNodeForm = DeclarativeNodeForm;

function PluginField({
  field,
  pluginId,
  value,
  onChange,
  onChangeMerge,
}: {
  field: WorkflowNodeConfigField;
  /** The node's plugin id — scopes plugin-specific option sources (e.g. connectors). */
  pluginId?: string;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Set the field value AND merge extra resolved keys into config in a single update. */
  onChangeMerge: (v: unknown, merge: Record<string, unknown>) => void;
}) {
  const [options, setOptions] = useState<WorkflowNodeOption[]>(field.options ?? []);

  useEffect(() => {
    if ((field.type === 'select' || field.type === 'multiselect') && field.optionsSource) {
      void fetchNodeOptions(field.optionsSource, pluginId)
        .then(setOptions)
        .catch(() => setOptions([]));
    }
  }, [field.optionsSource, field.type, pluginId]);

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3 py-0.5">
        <span className="text-sm text-foreground">{field.label}</span>
        <Switch checked={Boolean(value)} onCheckedChange={onChange} aria-label={field.label} />
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <FormField label={field.label}>
        <Select
          value={String(value ?? '')}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v);
            if (field.detailSource && v) {
              void fetchNodeDetail(field.detailSource, v).then((detail) => onChangeMerge(v, detail));
            }
          }}
        >
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </FormField>
    );
  }

  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (v: string) =>
      onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
    return (
      <FormField label={field.label}>
        <div className="mt-1.5 space-y-1">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </FormField>
    );
  }

  if (field.type === 'json') {
    // One <PluginField> renders a single field, so this hook sits at a stable
    // position within this component instance (Rules of Hooks hold).
    const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
    const [err, setErr] = useState<string | null>(null);
    return (
      <FormField label={field.label}>
        <CodeEditor
          language="json"
          value={text}
          minHeight="8rem"
          onChange={(t) => {
            setText(t);
            if (t.trim() === '') {
              setErr(null);
              onChange(undefined);
              return;
            }
            try {
              const parsed = JSON.parse(t);
              setErr(null);
              onChange(parsed);
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : 'invalid JSON');
            }
          }}
        />
        {err && <p className="text-[11px] text-destructive">{err}</p>}
      </FormField>
    );
  }

  if (field.type === 'file') {
    return (
      <FormField label={field.label} hint="File inputs arrive in a later release.">
        <TextInput disabled value="" placeholder="(not yet supported)" />
      </FormField>
    );
  }

  // text | number
  return (
    <FormField label={field.label}>
      <TextInput
        type={field.type === 'number' ? 'number' : 'text'}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) =>
          onChange(
            field.type === 'number'
              ? e.target.value === ''
                ? undefined
                : Number(e.target.value)
              : e.target.value,
          )
        }
      />
    </FormField>
  );
}
