import type { WorkflowNode, WorkflowEdge } from './types';

/**
 * Starter canvas for a brand-new (unsaved) workflow in the builder: a single Manual
 * Trigger, so creating a workflow starts clean instead of from a throwaway demo graph.
 * (The seeded default workflows a fresh install ships live in
 * packages/workflows/src/sample-workflow.ts.)
 */
export const sampleNodes: WorkflowNode[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 240, y: 200 },
    data: {
      label: 'When clicked',
      triggerType: 'manual',
      config: {},
      templateId: 'manual-trigger',
      iconName: 'Play',
    },
  },
];

export const sampleEdges: WorkflowEdge[] = [];
