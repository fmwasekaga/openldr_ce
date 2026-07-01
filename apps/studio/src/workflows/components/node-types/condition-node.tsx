import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitBranch, Filter, Shuffle } from 'lucide-react';
import type { ConditionNodeData } from '../../lib/types';
import { NodeShell } from './base-node';

export function ConditionNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ConditionNodeData;
  const templateId = (nodeData as Record<string, unknown>).templateId as string | undefined;

  // Filter variant: single output handle (items pass or are dropped)
  if (templateId === 'filter') {
    return (
      <NodeShell
        id={id}
        variant="condition"
        icon={Filter}
        iconName={nodeData.iconName}
        iconUrl={nodeData.iconUrl}
        label={nodeData.label}
        subtitle={nodeData.condition || 'No condition set'}
        selected={selected}
        hasOutput={false}
        extraHandles={
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-emerald-500 transition-all hover:!h-4 hover:!w-4"
            title="Pass"
          />
        }
      />
    );
  }

  // Switch variant: dynamic output handles based on rules
  if (templateId === 'switch') {
    const rules = (nodeData.rules ?? []) as Array<{ name: string; condition: string }>;
    const fallbackOutput = (nodeData.fallbackOutput as string) ?? 'fallback';
    const outputs = [...rules.map((r) => r.name), fallbackOutput];
    const count = outputs.length;

    return (
      <NodeShell
        id={id}
        variant="condition"
        icon={Shuffle}
        iconName={nodeData.iconName}
        iconUrl={nodeData.iconUrl}
        label={nodeData.label}
        subtitle={`${rules.length} rule${rules.length !== 1 ? 's' : ''}`}
        selected={selected}
        hasOutput={false}
        extraHandles={
          <>
            {outputs.map((name, i) => {
              const pct = count === 1 ? 50 : 20 + (i * 60) / (count - 1);
              const isFallback = i === outputs.length - 1;
              return (
                <Handle
                  key={name}
                  type="source"
                  position={Position.Right}
                  id={name}
                  style={{ top: `${pct}%` }}
                  className={`!h-3 !w-3 !rounded-full !border-2 !border-background transition-all hover:!h-3.5 hover:!w-3.5 ${
                    isFallback ? '!bg-muted-foreground' : '!bg-amber-500'
                  }`}
                  title={name}
                />
              );
            })}
          </>
        }
      />
    );
  }

  // Default: If node with true/false handles
  return (
    <NodeShell
      id={id}
      variant="condition"
      icon={GitBranch}
      iconName={nodeData.iconName}
      iconUrl={nodeData.iconUrl}
      label={nodeData.label}
      subtitle={nodeData.condition || 'No condition set'}
      selected={selected}
      hasOutput={false}
      extraHandles={
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            style={{ top: '30%' }}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-emerald-500 transition-all hover:!h-4 hover:!w-4"
            title="True"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            style={{ top: '70%' }}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-rose-500 transition-all hover:!h-4 hover:!w-4"
            title="False"
          />
        </>
      }
    />
  );
}
