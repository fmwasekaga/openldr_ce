import type { NodeFormProps } from './index';
import type { WebhookNodeData } from '../../lib/types';
import { FormField, Select, TextInput } from './shared';

/**
 * Webhook trigger form. Saving the workflow re-registers the path with the
 * backend so `POST /api/webhooks/<path>` resolves to this workflow. The
 * incoming request body becomes `$input.body` for downstream nodes.
 */
export function WebhookForm({ node, update }: NodeFormProps) {
  const data = node.data as WebhookNodeData;
  const path = (data.path as string | undefined) ?? '';
  const method = data.method ?? 'POST';

  const base = `${window.location.origin}/api/webhooks`;
  const fullUrl = path
    ? `${base}/${path.replace(/^\/+/, '')}`
    : `${base}/<path>`;

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <FormField label="Method">
        <Select
          value={method}
          onChange={(e) => update({ method: e.target.value as WebhookNodeData['method'] })}
        >
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>DELETE</option>
        </Select>
      </FormField>

      <FormField
        label="Path"
        hint="Path segment under /api/webhooks/. Save the workflow to register the route."
      >
        <TextInput
          value={path}
          onChange={(e) => update({ path: e.target.value })}
          placeholder="hello"
        />
      </FormField>

      <FormField label="URL">
        <div className="mt-1.5 break-all rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {fullUrl}
        </div>
      </FormField>
    </div>
  );
}
