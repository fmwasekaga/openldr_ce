import { type NodeProps } from '@xyflow/react';
import { Globe } from 'lucide-react';
import type { WebhookNodeData } from '../../lib/types';
import { NodeShell } from './base-node';

export function WebhookNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as WebhookNodeData;
  return (
    <NodeShell
      id={id}
      variant="webhook"
      icon={Globe}
      iconName={nodeData.iconName}
      iconUrl={nodeData.iconUrl}
      label={nodeData.label}
      subtitle={nodeData.method}
      selected={selected}
      hasInput={false}
    />
  );
}
