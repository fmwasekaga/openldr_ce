import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { NodeFormProps } from './index';
import type { WebhookNodeData } from '../../lib/types';
import { FormField, Select, TextInput } from './shared';

/** Generate a fresh shared secret. `crypto.randomUUID` is available in all modern browsers. */
function generateSecret(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Defensive fallback for non-secure contexts where randomUUID is unavailable.
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Webhook trigger form. Saving the workflow re-registers the path + secret with
 * the backend so `POST /api/workflows/hooks/<path>` resolves to this workflow.
 * The incoming request body becomes `$input.body` for downstream nodes.
 *
 * Field-name contract (read by the server's `syncWorkflowTriggers`):
 *   data.path   → the path segment under /api/workflows/hooks/
 *   data.secret → the shared secret; callers must send it as X-Webhook-Token.
 */
export function WebhookForm({ node, update }: NodeFormProps) {
  const data = node.data as WebhookNodeData;
  const path = (data.path as string | undefined) ?? '';
  const method = data.method ?? 'POST';
  const secret = (data.secret as string | undefined) ?? '';

  // Seed a secret on first render if one isn't already present.
  useEffect(() => {
    if (!secret) update({ secret: generateSecret() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const base = `${window.location.origin}/api/workflows/hooks`;
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
        hint="Path segment under /api/workflows/hooks/. Save the workflow to register the route."
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

      <FormField
        label="Secret"
        hint="Send this with each request as the X-Webhook-Token header. Regenerate to rotate it (then save)."
      >
        <div className="mt-1.5 flex items-center gap-2">
          <TextInput
            value={secret}
            readOnly
            className="font-mono text-[11px]"
          />
          <button
            type="button"
            onClick={() => update({ secret: generateSecret() })}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
            title="Regenerate secret"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </button>
        </div>
      </FormField>

      <FormField label="Header">
        <div className="mt-1.5 break-all rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          X-Webhook-Token: {secret || '<secret>'}
        </div>
      </FormField>
    </div>
  );
}
