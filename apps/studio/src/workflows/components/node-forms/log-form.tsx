import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, Select, TextArea, TextInput } from './shared';

/**
 * Log node form. The message field accepts `{{ $json.body.foo }}` style
 * templates; values are resolved server-side by the log handler before the
 * line is streamed back as a `node:log` event.
 */
export function LogForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const message = (data.message as string | undefined) ?? '';
  const level = (data.level as ActionNodeData['level'] | undefined) ?? 'log';

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <FormField label="Level">
        <Select
          value={level}
          onChange={(e) => update({ level: e.target.value as ActionNodeData['level'] })}
        >
          <option value="log">log</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </Select>
      </FormField>

      <FormField
        label="Message"
        hint="Templates: {{ $json.field }}, {{ $items }}, {{ $node('trigger-1').0.json.foo }}. Non-string values are JSON-stringified."
      >
        <TextArea
          className="h-24 resize-none font-mono text-xs leading-relaxed"
          value={message}
          onChange={(e) => update({ message: e.target.value })}
          placeholder="got {{ $json.body.name }}"
          spellCheck={false}
        />
      </FormField>
    </div>
  );
}
