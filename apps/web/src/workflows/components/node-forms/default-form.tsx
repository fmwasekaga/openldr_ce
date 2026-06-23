import type { NodeFormProps } from './index';
import { FormField, TextInput } from './shared';

/**
 * Fallback form for any node template that doesn't have its own custom form
 * yet. Always shows the label, and surfaces the most common config fields
 * from the previous field-detection panel so we don't regress.
 */
export function DefaultForm({ node, update }: NodeFormProps) {
  const data = node.data as Record<string, unknown>;

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={(data.label as string) ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <FormField label="Type">
        <div className="mt-1.5 flex h-9 items-center rounded-md border border-border bg-secondary/40 px-3 text-sm text-muted-foreground">
          {node.type}
        </div>
      </FormField>

      {data.condition !== undefined && (
        <FormField label="Condition" hint="JavaScript expression. `$input` references the upstream node's output.">
          <TextInput
            value={(data.condition as string) ?? ''}
            placeholder="$input.user.plan === 'premium'"
            onChange={(e) => update({ condition: e.target.value })}
          />
        </FormField>
      )}

      {data.iterations !== undefined && (
        <FormField label="Iterations">
          <TextInput
            type="number"
            value={(data.iterations as number) ?? 10}
            onChange={(e) => update({ iterations: parseInt(e.target.value) || 1 })}
          />
        </FormField>
      )}

      {data.url !== undefined && (
        <FormField label="URL">
          <TextInput
            value={(data.url as string) ?? ''}
            placeholder="https://..."
            onChange={(e) => update({ url: e.target.value })}
          />
        </FormField>
      )}
    </div>
  );
}
