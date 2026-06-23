import { Plus, Trash2 } from 'lucide-react';
import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';

interface FieldMapping {
  name: string;
  value: string;
}

/**
 * Edit Fields (Set) node form. Lets the user define name → value mappings
 * that build the node's output object. Values support {{ }} templates.
 */
export function SetForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const fields = (config.fields as FieldMapping[]) ?? [];
  const keepExisting = Boolean(config.keepExisting);

  const patchConfig = (patch: Record<string, unknown>) =>
    update({ config: { ...config, ...patch } });

  const updateField = (index: number, patch: Partial<FieldMapping>) => {
    const updated = fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
    patchConfig({ fields: updated });
  };

  const addField = () => {
    patchConfig({ fields: [...fields, { name: '', value: '' }] });
  };

  const removeField = (index: number) => {
    patchConfig({ fields: fields.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="keepExisting"
          checked={keepExisting}
          onChange={(e) => patchConfig({ keepExisting: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-border"
        />
        <label htmlFor="keepExisting" className="text-xs text-muted-foreground">
          Keep existing fields from input
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Fields
          </span>
          <button
            type="button"
            onClick={addField}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-violet-400 transition-colors hover:bg-violet-500/10"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>

        {fields.map((field, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <div className="flex-1 space-y-1">
              <TextInput
                value={field.name}
                onChange={(e) => updateField(i, { name: e.target.value })}
                placeholder="field name"
                className="!mt-0 text-xs"
              />
              <TextInput
                value={field.value}
                onChange={(e) => updateField(i, { value: e.target.value })}
                placeholder="{{ $input.foo }}"
                className="!mt-0 font-mono text-xs"
              />
            </div>
            <button
              type="button"
              onClick={() => removeField(i)}
              className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}

        {fields.length === 0 && (
          <p className="text-[10px] text-muted-foreground/70 italic">
            No fields defined. Click Add to create one.
          </p>
        )}
      </div>
    </div>
  );
}
