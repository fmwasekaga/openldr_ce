import type { NodeFormProps } from './index';
import type { CodeNodeData } from '../../lib/types';
import { FormField, Select, TextArea, TextInput } from './shared';

/**
 * Code node form. We intentionally use a plain monospace textarea instead of
 * importing Monaco here — dragging the full editor into the right-side panel
 * is heavy, and Monaco is already available on the dedicated Code Editor
 * page if users want a richer editing experience. Templating tips and
 * `$input` usage are called out in the field hint.
 */
export function CodeForm({ node, update }: NodeFormProps) {
  const data = node.data as CodeNodeData;

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <FormField label="Language">
        <Select
          value={data.language ?? 'javascript'}
          onChange={(e) => update({ language: e.target.value as CodeNodeData['language'] })}
        >
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
        </Select>
      </FormField>

      <FormField
        label="Code"
        hint="Access the upstream node's output via `$input`. Use `console.log(...)` — output streams to the Logs tab. Last expression or explicit `return` becomes this node's output."
      >
        <TextArea
          className="h-56 resize-none font-mono text-xs leading-relaxed"
          value={data.code ?? ''}
          onChange={(e) => update({ code: e.target.value })}
          spellCheck={false}
          placeholder={'console.log("hi", $input);\nreturn { doubled: $input * 2 };'}
        />
      </FormField>
    </div>
  );
}
