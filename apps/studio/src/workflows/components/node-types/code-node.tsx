import { type NodeProps } from '@xyflow/react';
import { Code } from 'lucide-react';
import type { CodeNodeData } from '../../lib/types';
import { NodeShell } from './base-node';

export function CodeNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as CodeNodeData;
  return (
    <NodeShell
      id={id}
      variant="code"
      icon={Code}
      iconName={nodeData.iconName}
      iconUrl={nodeData.iconUrl}
      label={nodeData.label}
      subtitle={nodeData.language}
      selected={selected}
    />
  );
}
