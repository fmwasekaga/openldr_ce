import { type NodeProps } from '@xyflow/react';
import { Send } from 'lucide-react';
import type { ActionNodeData } from '../../lib/types';
import { NodeShell } from './base-node';

export function ActionNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ActionNodeData;
  return (
    <NodeShell
      id={id}
      variant="action"
      icon={Send}
      iconName={nodeData.iconName}
      iconUrl={nodeData.iconUrl}
      label={nodeData.label}
      subtitle={nodeData.action}
      selected={selected}
    />
  );
}
