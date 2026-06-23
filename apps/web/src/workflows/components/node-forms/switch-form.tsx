import { Plus, Trash2 } from 'lucide-react';
import type { NodeFormProps } from './index';
import type { ConditionNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';

interface SwitchRule {
  name: string;
  condition: string;
}

/**
 * Switch node form. Defines an ordered list of named rules — the first
 * matching rule determines which output branch the data flows through.
 */
export function SwitchForm({ node, update }: NodeFormProps) {
  const data = node.data as ConditionNodeData;
  const rules = (data.rules ?? []) as SwitchRule[];
  const fallbackOutput = (data.fallbackOutput as string) ?? 'fallback';

  const updateRule = (index: number, patch: Partial<SwitchRule>) => {
    const updated = rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update({ rules: updated });
  };

  const addRule = () => {
    update({ rules: [...rules, { name: `case-${rules.length}`, condition: '' }] });
  };

  const removeRule = (index: number) => {
    update({ rules: rules.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rules
          </span>
          <button
            type="button"
            onClick={addRule}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-violet-400 transition-colors hover:bg-violet-500/10"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>

        {rules.map((rule, i) => (
          <div key={i} className="flex items-start gap-1.5 rounded-md border border-border/50 p-2">
            <div className="flex-1 space-y-1">
              <TextInput
                value={rule.name}
                onChange={(e) => updateRule(i, { name: e.target.value })}
                placeholder="branch name"
                className="!mt-0 text-xs"
              />
              <TextInput
                value={rule.condition}
                onChange={(e) => updateRule(i, { condition: e.target.value })}
                placeholder="$input.status === 200"
                className="!mt-0 font-mono text-xs"
              />
            </div>
            <button
              type="button"
              onClick={() => removeRule(i)}
              className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}

        {rules.length === 0 && (
          <p className="text-[10px] text-muted-foreground/70 italic">
            No rules defined. Click Add to create one.
          </p>
        )}
      </div>

      <FormField label="Fallback Output" hint="Branch name used when no rule matches.">
        <TextInput
          value={fallbackOutput}
          onChange={(e) => update({ fallbackOutput: e.target.value })}
          placeholder="fallback"
        />
      </FormField>
    </div>
  );
}
