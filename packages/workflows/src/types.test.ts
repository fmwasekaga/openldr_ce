import { describe, it, expect } from 'vitest';
import { WorkflowSchema } from './types';

describe('WorkflowSchema', () => {
  it('parses a minimal workflow and defaults definition', () => {
    const wf = WorkflowSchema.parse({ id: 'w1', name: 'Test' });
    expect(wf.definition).toEqual({ nodes: [], edges: [] });
    expect(wf.enabled).toBe(true);
    expect(wf.createdBy).toBeNull();
  });

  it('rejects a workflow without a name', () => {
    expect(() => WorkflowSchema.parse({ id: 'w1' })).toThrow();
  });
});
