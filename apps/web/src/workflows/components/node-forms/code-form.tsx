import type { NodeFormProps } from './index';
import type { CodeNodeData } from '../../lib/types';
import { FormField, Select, TextInput } from './shared';
import { CodeEditor } from './code-editor';

/**
 * Code node form. We use a lightweight CodeMirror editor (not Monaco) for the
 * right-side panel — Monaco is reserved for the dedicated Code Editor page.
 * Templating tips and `$json`/`$items`/`$input` usage are called out in the
 * field hint.
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
          <option value="typescript" disabled>TypeScript (coming soon)</option>
        </Select>
      </FormField>

      <FormField
        label="Code"
        hint="Use `$json` (first item's fields), `$items` (all items' fields), or `$input` (raw WorkflowItem[]). Use `console.log(...)` — output streams to the Logs tab. Last expression or explicit `return` becomes this node's output."
      >
        <CodeEditor
          language="javascript"
          value={data.code ?? ''}
          onChange={(v) => update({ code: v })}
          placeholder={'console.log("hi", $json);\nreturn { doubled: $json.n * 2 };'}
          minHeight="14rem"
        />
      </FormField>
    </div>
  );
}
