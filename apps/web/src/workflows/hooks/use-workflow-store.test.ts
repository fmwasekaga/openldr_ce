import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowStore } from './use-workflow-store';
import type { WorkflowNode, WorkflowEdge } from '../lib/types';

const node = (id: string) => ({ id, type: 'action', position: { x: 0, y: 0 }, data: {} }) as unknown as WorkflowNode;
const edge = (id: string) => ({ id, source: 'a', target: 'b' }) as unknown as WorkflowEdge;

describe('useWorkflowStore — clear vs clearCanvas', () => {
  beforeEach(() => {
    useWorkflowStore.getState().setWorkflow('wf_x', 'My WF', [node('n1')], [edge('e1')]);
  });

  it('clearCanvas empties the canvas but KEEPS the workflow identity (so Save updates, not creates)', () => {
    useWorkflowStore.getState().clearCanvas();
    const s = useWorkflowStore.getState();
    expect(s.nodes).toEqual([]);
    expect(s.edges).toEqual([]);
    expect(s.workflowId).toBe('wf_x'); // the bug: the Clear button used clear(), which nulled this → Save created a duplicate
    expect(s.workflowName).toBe('My WF');
  });

  it('clear() is a full reset that DOES drop identity (used only when starting a new workflow)', () => {
    useWorkflowStore.getState().clear();
    const s = useWorkflowStore.getState();
    expect(s.nodes).toEqual([]);
    expect(s.workflowId).toBeNull();
    expect(s.workflowName).toBe(''); // empty so the name input shows its placeholder for a new workflow
  });
});
