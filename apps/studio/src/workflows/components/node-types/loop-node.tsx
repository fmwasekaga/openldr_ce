import { type NodeProps, Handle, Position } from '@xyflow/react';
import { Repeat } from 'lucide-react';
import type { LoopNodeData } from '../../lib/types';
import { NodeShell } from './base-node';

export function LoopNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as LoopNodeData;
  const subtitle =
    (nodeData.loopMode ?? 'count') === 'items'
      ? `batch ${nodeData.batchSize ?? 1}`
      : `${nodeData.iterations ?? 0} iterations`;
  return (
    <NodeShell
      id={id}
      variant="loop"
      icon={Repeat}
      iconName={nodeData.iconName}
      iconUrl={nodeData.iconUrl}
      label={nodeData.label}
      subtitle={subtitle}
      selected={selected}
      hasOutput={false}
      extraHandles={
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="loop"
            style={{ top: '30%' }}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-violet-500 transition-all hover:!h-4 hover:!w-4"
            title="Loop (body)"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="done"
            style={{ top: '70%' }}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-emerald-500 transition-all hover:!h-4 hover:!w-4"
            title="Done"
          />
        </>
      }
    />
  );
}
