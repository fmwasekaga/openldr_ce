import type { NodeFormProps } from './index';
import type { ConditionNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';

/**
 * Filter node form. Evaluates a condition — items passing the test continue
 * downstream, items failing are dropped (no output).
 */
export function FilterForm({ node, update }: NodeFormProps) {
  const data = node.data as ConditionNodeData;

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <FormField
        label="Condition"
        hint="Items passing this test continue. Use $json to reference the first item. E.g. $json.status === 200"
      >
        <TextInput
          value={data.condition ?? ''}
          onChange={(e) => update({ condition: e.target.value })}
          placeholder="$json.active === true"
        />
      </FormField>
    </div>
  );
}
