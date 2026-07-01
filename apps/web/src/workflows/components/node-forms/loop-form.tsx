import type { NodeFormProps } from './index';
import type { LoopNodeData } from '../../lib/types';
import { FormField, Select, TextInput } from './shared';

/**
 * Loop node form. Supports two modes: count (iterate N times) and items
 * (iterate over each element in the upstream array).
 */
export function LoopForm({ node, update }: NodeFormProps) {
  const data = node.data as LoopNodeData;
  const loopMode = data.loopMode ?? 'count';

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput
          value={data.label ?? ''}
          onChange={(e) => update({ label: e.target.value })}
        />
      </FormField>

      <FormField label="Mode">
        <Select
          value={loopMode}
          onChange={(e) => update({ loopMode: e.target.value as LoopNodeData['loopMode'] })}
        >
          <option value="count">Count (fixed iterations)</option>
          <option value="items">Items (iterate upstream array)</option>
        </Select>
      </FormField>

      {loopMode === 'count' && (
        <FormField label="Iterations" hint="Number of times to loop. Max 1000.">
          <TextInput
            type="number"
            value={data.iterations ?? 10}
            onChange={(e) => update({ iterations: parseInt(e.target.value) || 1 })}
            min={1}
            max={1000}
          />
        </FormField>
      )}

      {loopMode === 'items' && (
        <>
          <FormField label="Batch size" hint="Items per iteration. Default 1.">
            <TextInput
              type="number"
              value={data.batchSize ?? 1}
              onChange={(e) => update({ batchSize: parseInt(e.target.value) || 1 })}
              min={1}
            />
          </FormField>
          <p className="text-[10px] leading-snug text-muted-foreground/80">
            The body runs once per batch. Access the current item via{' '}
            <code className="rounded bg-secondary px-1 font-mono">$item</code> and the iteration
            index via <code className="rounded bg-secondary px-1 font-mono">$index</code>.
          </p>
        </>
      )}
    </div>
  );
}
