import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { X } from 'lucide-react';
import { useWorkflowStore } from '../../hooks/use-workflow-store';

export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edges = useWorkflowStore((s) => s.edges);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);

  const handleDelete = () => {
    onEdgesChange([{ id, type: 'remove' }]);
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: selected ? 'hsl(var(--primary))' : '#94a3b8', strokeWidth: 2 }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="nodrag nopan pointer-events-auto absolute flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
            onClick={handleDelete}
          >
            <X className="h-3 w-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
