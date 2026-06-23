import { type NodeProps } from '@xyflow/react';
import { Repeat } from 'lucide-react';
import type { LoopNodeData } from '../../lib/types';
import { NodeShell } from './base-node';

export function LoopNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as LoopNodeData;
  return (
    <NodeShell
      id={id}
      variant="loop"
      icon={Repeat}
      iconName={nodeData.iconName}
      iconUrl={nodeData.iconUrl}
      label={nodeData.label}
      subtitle={`${nodeData.iterations} iterations`}
      selected={selected}
    />
  );
}
