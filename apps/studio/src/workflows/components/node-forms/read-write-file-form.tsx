import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, Select, TextInput } from './shared';

/**
 * Read-Write-File node form. Configures file I/O operations in the sandboxed
 * workspace root. Requires WORKFLOW_FILE_ACCESS_ENABLED + WORKFLOW_FILE_ACCESS_ROOT.
 */
export function ReadWriteFileForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const operation = (config.operation as string) ?? 'read';

  const patchConfig = (patch: Record<string, unknown>) =>
    update({ config: { ...config, ...patch } });

  return (
    <div className="space-y-4">
      <FormField label="Operation">
        <Select
          value={operation}
          onChange={(e) => patchConfig({ operation: e.target.value })}
        >
          <option value="read">read</option>
          <option value="write">write</option>
          <option value="list">list</option>
          <option value="delete">delete</option>
        </Select>
      </FormField>

      <FormField label="Path">
        <TextInput
          value={(config.path as string) ?? ''}
          placeholder="path relative to the sandbox root"
          onChange={(e) => patchConfig({ path: e.target.value })}
        />
      </FormField>

      {operation === 'read' && (
        <>
          <FormField label="Read as text">
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="checkbox"
                id="rwf-as-text"
                checked={!!(config.asText as boolean)}
                onChange={(e) => patchConfig({ asText: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-violet-500"
              />
              <span className="text-sm text-foreground">Return content as a text string</span>
            </div>
          </FormField>

          <FormField label="Output field" hint="Field name on the output item where file data is stored.">
            <TextInput
              value={(config.binaryField as string) ?? ''}
              placeholder="output field (default: file / content)"
              onChange={(e) => patchConfig({ binaryField: e.target.value })}
            />
          </FormField>
        </>
      )}

      {operation === 'write' && (
        <>
          <FormField label="Binary input field" hint="Item field holding a BinaryRef to write. Leave blank when writing text content.">
            <TextInput
              value={(config.binaryField as string) ?? ''}
              placeholder="binary field name"
              onChange={(e) => patchConfig({ binaryField: e.target.value })}
            />
          </FormField>

          <FormField label="Text content">
            <TextInput
              value={(config.textContent as string) ?? ''}
              placeholder="text content (used when no binary field)"
              onChange={(e) => patchConfig({ textContent: e.target.value })}
            />
          </FormField>
        </>
      )}

      <p className="text-[10px] leading-snug text-muted-foreground/80">
        Requires the operator to enable WORKFLOW_FILE_ACCESS_ENABLED and set WORKFLOW_FILE_ACCESS_ROOT.
      </p>
    </div>
  );
}
