import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
} from '@xyflow/react';
import type { WorkflowNode, WorkflowEdge } from '../lib/types';
import type { LogEntry } from '@/api';
import { sampleNodes, sampleEdges } from '../lib/sample-workflow';

export type NodeRunStatus =
  | 'idle'
  | 'waiting'
  | 'running'
  | 'success'
  | 'error'
  | 'skipped';

interface WorkflowState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** ReactFlow selection — drives the toolbar + selected border. */
  selectedNodeId: string | null;
  /** Which node's config panel is open. Decoupled from selection so clicking
   *  a node no longer pops the panel; the user has to click the cog in the
   *  node toolbar. */
  configNodeId: string | null;
  workflowName: string;
  workflowId: string | null;

  /** Per-node execution status, keyed by node id. Missing = 'idle'. */
  nodeRunStatus: Record<string, NodeRunStatus>;
  /** Error message for the last run of a given node. */
  nodeRunError: Record<string, string | undefined>;
  /** Captured console output, keyed by node id. */
  nodeLogs: Record<string, LogEntry[]>;
  /** What each node received as input during the last run. */
  nodeRunInput: Record<string, unknown>;
  /** What each node produced as output during the last run. */
  nodeRunOutput: Record<string, unknown>;
  /** Structured result metadata per node (e.g. a plugin sink's import summary). */
  nodeRunMeta: Record<string, unknown>;
  /**
   * True while the workflow is "armed" — the user has pressed Run and we're
   * now waiting for them to click a manual trigger to actually fire the
   * execution. False while idle or while an execution is in-flight.
   */
  armed: boolean;
  /**
   * Canvas interaction mode. `pan` = left-drag pans the viewport (default).
   * `select` = left-drag draws a box-selection over nodes; pan moves to
   * middle/right mouse button.
   */
  interactionMode: 'pan' | 'select';

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  addNode: (node: WorkflowNode) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Partial<WorkflowNode['data']>) => void;
  setSelectedNode: (id: string | null) => void;
  setConfigNode: (id: string | null) => void;
  setWorkflowName: (name: string) => void;
  setWorkflow: (id: string, name: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  /** Full reset — wipes the canvas AND the workflow identity (id + name). Used when
   *  starting a brand-new workflow (the /workflows/new load path). */
  clear: () => void;
  /** Empty the canvas (nodes/edges + run state) but KEEP the open workflow's identity
   *  (workflowId + name), so a subsequent Save updates that workflow rather than creating
   *  a duplicate. Wired to the toolbar "Clear canvas" button. */
  clearCanvas: () => void;

  /** Reset all per-node run state (called at the start of every run). */
  resetRun: () => void;
  setNodeStatus: (id: string, status: NodeRunStatus, error?: string) => void;
  appendNodeLog: (entry: LogEntry) => void;
  setNodeRunData: (id: string, input: unknown, output: unknown, meta?: unknown) => void;
  setArmed: (armed: boolean) => void;
  setInteractionMode: (mode: 'pan' | 'select') => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: sampleNodes,
  edges: sampleEdges,
  selectedNodeId: null,
  configNodeId: null,
  workflowName: 'Untitled workflow',
  workflowId: null,
  nodeRunStatus: {},
  nodeRunError: {},
  nodeLogs: {},
  nodeRunInput: {},
  nodeRunOutput: {},
  nodeRunMeta: {},
  armed: false,
  interactionMode: 'pan',

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) as WorkflowNode[] });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection: Connection) => {
    set({ edges: addEdge(connection, get().edges) });
  },

  addNode: (node) => {
    set({ nodes: [...get().nodes, node] });
  },

  removeNode: (id) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      configNodeId: get().configNodeId === id ? null : get().configNodeId,
    });
  },

  updateNodeData: (id, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id
          ? ({
              ...n,
              // Spread produces a non-exact intersection that TS can't narrow
              // back to the `WorkflowNodeData` union — cast through unknown
              // since the caller's `data` is already typed as a partial of it.
              data: { ...(n.data as Record<string, unknown>), ...data } as unknown as WorkflowNode['data'],
            } satisfies WorkflowNode)
          : n,
      ),
    });
  },

  setSelectedNode: (id) => {
    set({ selectedNodeId: id });
  },

  setConfigNode: (id) => {
    set({ configNodeId: id });
  },

  setWorkflowName: (name) => {
    set({ workflowName: name });
  },

  setWorkflow: (id, name, nodes, edges) => {
    set({ workflowId: id, workflowName: name, nodes, edges });
  },

  clear: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      configNodeId: null,
      workflowName: '', // empty → the name field shows its placeholder; save falls back to a default
      workflowId: null,
      nodeRunStatus: {},
      nodeRunError: {},
      nodeLogs: {},
      nodeRunInput: {},
      nodeRunOutput: {},
      nodeRunMeta: {},
      armed: false,
    });
  },

  clearCanvas: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      configNodeId: null,
      nodeRunStatus: {},
      nodeRunError: {},
      nodeLogs: {},
      nodeRunInput: {},
      nodeRunOutput: {},
      nodeRunMeta: {},
      armed: false,
    });
  },

  resetRun: () => {
    set({ nodeRunStatus: {}, nodeRunError: {}, nodeLogs: {}, nodeRunInput: {}, nodeRunOutput: {}, nodeRunMeta: {}, armed: false });
  },

  setNodeStatus: (id, status, error) => {
    set({
      nodeRunStatus: { ...get().nodeRunStatus, [id]: status },
      nodeRunError: { ...get().nodeRunError, [id]: error },
    });
  },

  appendNodeLog: (entry) => {
    const existing = get().nodeLogs[entry.nodeId] ?? [];
    set({
      nodeLogs: { ...get().nodeLogs, [entry.nodeId]: [...existing, entry] },
    });
  },

  setNodeRunData: (id, input, output, meta) => {
    set({
      nodeRunInput: { ...get().nodeRunInput, [id]: input },
      nodeRunOutput: { ...get().nodeRunOutput, [id]: output },
      nodeRunMeta: { ...get().nodeRunMeta, [id]: meta },
    });
  },

  setArmed: (armed) => {
    set({ armed });
  },

  setInteractionMode: (mode) => {
    set({ interactionMode: mode });
  },
}));
