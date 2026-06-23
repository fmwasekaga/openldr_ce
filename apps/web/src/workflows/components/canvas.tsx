import { useCallback, useMemo, useRef, type DragEvent } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes } from './node-types';
import { edgeTypes } from './edge-types';
import { useWorkflowStore } from '../hooks/use-workflow-store';
import { isValidConnection } from '../lib/validation';
import { InteractionModeToggle } from './interaction-mode-toggle';

interface CanvasProps {
  /**
   * Called when the user clicks a manual trigger node while the workflow
   * is armed (after pressing Run). The handler kicks off the streaming
   * execution from the server.
   */
  onFireTrigger?: (nodeId: string) => void;
}

export function Canvas({ onFireTrigger }: CanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const addNode = useWorkflowStore((s) => s.addNode);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const setConfigNode = useWorkflowStore((s) => s.setConfigNode);
  const armed = useWorkflowStore((s) => s.armed);
  const nodeRunStatus = useWorkflowStore((s) => s.nodeRunStatus);
  const interactionMode = useWorkflowStore((s) => s.interactionMode);

  // In `select` mode, left-drag draws a box-selection over nodes; pan moves
  // to the middle (1) / right (2) mouse buttons. In `pan` mode left-drag
  // pans the viewport like normal.
  const panOnDrag = useMemo<boolean | number[]>(
    () => (interactionMode === 'select' ? [1, 2] : true),
    [interactionMode],
  );
  const selectionOnDrag = interactionMode === 'select';

  // Route ReactFlow's keyboard-deletion through our store so dependent edges
  // get cleaned up the same way the toolbar Delete button does.
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const n of deleted) removeNode(n.id);
    },
    [removeNode],
  );

  const onEdgesDelete = useCallback((_deleted: Edge[]) => {
    // applyEdgeChanges already strips them; this hook is here for parity / future side-effects.
  }, []);

  const handleIsValidConnection = useCallback(
    (connection: Parameters<typeof isValidConnection>[0]) => isValidConnection(connection, nodes),
    [nodes],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow-type');
      const dataStr = event.dataTransfer.getData('application/reactflow-data');

      if (!type || !dataStr) return;

      // Convert screen coordinates to flow coordinates, accounting for
      // the current viewport zoom and pan offset.
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const data = JSON.parse(dataStr);
      const newNode = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data,
      };

      addNode(newNode);
    },
    [addNode, screenToFlowPosition],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      // If the workflow is armed and the user clicked a waiting trigger,
      // fire the run from that trigger instead of just selecting it.
      if (armed && nodeRunStatus[node.id] === 'waiting') {
        onFireTrigger?.(node.id);
        return;
      }
      setSelectedNode(node.id);
    },
    [armed, nodeRunStatus, onFireTrigger, setSelectedNode],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setConfigNode(null);
  }, [setSelectedNode, setConfigNode]);

  return (
    <div
      ref={reactFlowWrapper}
      data-mode={interactionMode}
      className="canvas-dark relative h-full w-full bg-background"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={['Delete', 'Backspace']}
        // Allow Shift / Meta / Control as multi-select modifiers regardless
        // of the active interaction mode (so users can shift-click multiple
        // nodes even while in pan mode).
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        panOnDrag={panOnDrag}
        selectionOnDrag={selectionOnDrag}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'custom' }}
        isValidConnection={handleIsValidConnection}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        snapToGrid
        snapGrid={[15, 15]}
        proOptions={{ hideAttribution: true }}
      >
        <Controls
          className="!border !border-border !bg-card !shadow-lg [&_button]:!border-border [&_button]:!bg-card [&_button]:!text-foreground [&_button:hover]:!bg-secondary"
          showInteractive={false}
        />
        <MiniMap
          className="!bottom-4 !right-4 !border !border-border !bg-card !shadow-lg"
          maskColor="rgba(0,0,0,0.6)"
          nodeColor="#a78bfa"
          nodeStrokeColor="#a78bfa"
          nodeStrokeWidth={3}
          pannable
          zoomable
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color="rgba(255,255,255,0.08)"
        />
      </ReactFlow>
      <InteractionModeToggle />
    </div>
  );
}
