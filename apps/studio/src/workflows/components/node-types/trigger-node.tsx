import { type NodeProps } from '@xyflow/react';
import { Play } from 'lucide-react';
import type { TriggerNodeData } from '../../lib/types';
import { NodeShell } from './base-node';

export function TriggerNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as TriggerNodeData;
  return (
    <NodeShell
      id={id}
      variant="trigger"
      icon={Play}
      iconName={nodeData.iconName}
      iconUrl={nodeData.iconUrl}
      label={nodeData.label}
      subtitle={nodeData.triggerType}
      selected={selected}
      hasInput={false}
    />
  );
}
