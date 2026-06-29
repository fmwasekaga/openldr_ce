import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, Select, TextArea, TextInput } from './shared';

/**
 * HTTP Request node form. Configures method, URL, headers, body, and
 * response type. All string fields support `{{ $json.foo }}` templates.
 */
export function HttpRequestForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;

  const method = (config.method as string) ?? 'GET';
  const url = (config.url as string) ?? '';
  const headers = (config.headers as string) ?? '';
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
        hint='JSON object, e.g. { "Authorization": "Bearer {{ $json.token }}" }'
      >
        <TextArea
          className="h-20 resize-none font-mono text-xs leading-relaxed"
          value={headers}
          onChange={(e) => patchConfig({ headers: e.target.value })}
          placeholder='{ "Content-Type": "application/json" }'
          spellCheck={false}
        />
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
