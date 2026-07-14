import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import type { NodeFormProps } from './index';
import type { SecretRef } from '@/api';
import { isSecretRef } from '@/api';
import type { ActionNodeData } from '../../lib/types';
import { FormField, Select, TextArea, TextInput } from './shared';

/**
 * HTTP Request node form. Configures method, URL, headers, body, and
 * response type. All string fields support `{{ $json.foo }}` templates.
 */
export function HttpRequestForm({ node, update }: NodeFormProps) {
  const { t } = useTranslation();
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;

  const method = (config.method as string) ?? 'GET';
  const url = (config.url as string) ?? '';
  // The WHOLE headers blob is sealed when it carries an auth header (SEC-06). A saved
  // blob comes back as an opaque write-only `{ secretRef }` (an object, not a string) —
  // the textarea can't show it, so we render a masked state and keep the ref on save
  // unless the operator replaces the entire blob.
  const rawHeaders = config.headers as string | SecretRef | undefined;
  const headersIsRef = isSecretRef(rawHeaders);
  const headers = typeof rawHeaders === 'string' ? rawHeaders : '';
  const body = (config.body as string) ?? '';
  const responseType = (config.responseType as string) ?? 'json';

  const patchConfig = (patch: Record<string, unknown>) =>
    update({ config: { ...config, ...patch } });

  const showBody = ['POST', 'PUT', 'PATCH'].includes(method);

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <FormField label="Method">
        <Select value={method} onChange={(e) => patchConfig({ method: e.target.value })}>
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>PATCH</option>
          <option>DELETE</option>
        </Select>
      </FormField>

      <FormField label="URL" hint="Supports templates: {{ $json.baseUrl }}/users — only allow-listed hosts are reachable (set WORKFLOW_HTTP_ALLOWLIST on the server).">
        <TextInput
          value={url}
          onChange={(e) => patchConfig({ url: e.target.value })}
          placeholder="https://api.example.com/data"
        />
      </FormField>

      <FormField
        label="Headers"
        hint={
          headersIsRef
            ? t('workflows.secretWriteOnlyHelp')
            : 'JSON object, e.g. { "Authorization": "Bearer {{ $json.token }}" }'
        }
      >
        {headersIsRef ? (
          <div className="mt-1.5 space-y-2">
            <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t('workflows.headersSecretHidden')}</span>
            </div>
            <button
              type="button"
              onClick={() => patchConfig({ headers: '' })}
              className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
            >
              {t('workflows.replaceHeaders')}
            </button>
          </div>
        ) : (
          <TextArea
            className="h-20 resize-none font-mono text-xs leading-relaxed"
            value={headers}
            onChange={(e) => patchConfig({ headers: e.target.value })}
            placeholder='{ "Content-Type": "application/json" }'
            spellCheck={false}
          />
        )}
      </FormField>

      {showBody && (
        <FormField label="Body" hint="Request body. Supports {{ $json.foo }} templates.">
          <TextArea
            className="h-24 resize-none font-mono text-xs leading-relaxed"
            value={body}
            onChange={(e) => patchConfig({ body: e.target.value })}
            placeholder='{ "name": "{{ $json.name }}" }'
            spellCheck={false}
          />
        </FormField>
      )}

      <FormField label="Response Type">
        <Select value={responseType} onChange={(e) => patchConfig({ responseType: e.target.value })}>
          <option value="json">JSON</option>
          <option value="text">Text</option>
        </Select>
      </FormField>
    </div>
  );
}
