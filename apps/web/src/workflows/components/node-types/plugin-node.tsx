import { type NodeProps } from '@xyflow/react';
import { Puzzle } from 'lucide-react';
import { NodeShell } from './base-node';

export function PluginNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as { label?: string; kind?: string; pluginId?: string; iconName?: string; iconUrl?: string };
  const kind = d.kind ?? 'transform';
  return (
    <NodeShell
      id={id}
      variant="action"
      icon={Puzzle}
      iconName={d.iconName}
      iconUrl={d.iconUrl}
      label={d.label ?? 'Plugin'}
      subtitle={d.pluginId}
      selected={selected}
      hasInput={kind !== 'source'}
      hasOutput={kind !== 'sink'}
    />
  );
}
