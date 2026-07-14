import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeFormProps } from './index';
import type { SecretRef } from '@/api';
import { isSecretRef } from '@/api';
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
 * The incoming request payload becomes the trigger's item, so downstream nodes read
 * the request body via `$json.body`.
 *
 * Field-name contract (read by the server's `syncWorkflowTriggers`):
 *   data.path   → the path segment under /api/workflows/hooks/
 *   data.secret → the shared secret; callers must send it as X-Webhook-Token.
 */
export function WebhookForm({ node, update }: NodeFormProps) {
  const { t } = useTranslation();
  const data = node.data as WebhookNodeData;
  const path = (data.path as string | undefined) ?? '';
  const method = data.method ?? 'POST';
  // `data.secret` may be a plaintext string (new/regenerated) or an opaque
  // write-only `{ secretRef }` for a saved secret (SEC-06). A ref is never shown —
  // it renders a masked state and round-trips unchanged unless the operator replaces it.
  const rawSecret = data.secret as string | SecretRef | undefined;
  const secretIsRef = isSecretRef(rawSecret);
  const secret = typeof rawSecret === 'string' ? rawSecret : '';

  // Seed a secret on first render only if the node has NO secret at all — never
  // clobber a saved `{ secretRef }` (that would drop the stored secret).
  useEffect(() => {
    if (!rawSecret) update({ secret: generateSecret() });
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
        hint={
          secretIsRef
            ? t('workflows.secretWriteOnlyHelp')
            : 'Send this with each request as the X-Webhook-Token header. Regenerate to rotate it (then save).'
        }
      >
        <div className="mt-1.5 flex items-center gap-2">
          <TextInput
            value={secretIsRef ? '' : secret}
            readOnly
            placeholder={secretIsRef ? t('workflows.secretSet') : undefined}
            className="font-mono text-[11px]"
          />
          <button
            type="button"
            onClick={() => update({ secret: generateSecret() })}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
            title={secretIsRef ? t('workflows.replaceSecret') : 'Regenerate secret'}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {secretIsRef ? t('workflows.replaceSecret') : 'Regenerate'}
          </button>
        </div>
      </FormField>

      <FormField label="Header">
        <div className="mt-1.5 break-all rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          X-Webhook-Token: {secretIsRef ? '••••••' : secret || '<secret>'}
        </div>
      </FormField>
    </div>
  );
}
