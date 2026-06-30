import type { NodeHandler } from './types';
import type { LogLevel } from '../../types';

/**
 * Run another saved workflow as a sub-workflow. The upstream items are passed as
 * the sub-workflow's trigger input; the sub-workflow's terminal (leaf-node) items
 * are returned downstream. Requires the host `runSubWorkflow` service.
 *
 * `waitForCompletion: false` (fire-and-forget) is not supported yet — there is no
 * durable detached-job queue — so the sub-run is executed synchronously and a note
 * is logged.
 */
export const executeWorkflowHandler: NodeHandler = async (node, ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  // Only honour a string workflowId; any non-string (number, object, …) is treated
  // as absent so it yields the friendly error rather than a raw TypeError.
  const raw = config.workflowId;
  const workflowId = (typeof raw === 'string' ? raw : '').trim();
  if (!workflowId) throw new Error('Execute Workflow: workflowId is required');
  if (!ctx.services?.runSubWorkflow) {
    throw new Error('Execute Workflow node requires server services');
  }

  if (config.waitForCompletion === false) {
    const entry = {
      nodeId: node.id,
      level: 'warn' as LogLevel,
      message: 'Execute Workflow: fire-and-forget is not supported yet — ran synchronously.',
      ts: Date.now(),
    };
    (ctx.logs[node.id] ??= []).push(entry);
    ctx.emit({ type: 'node:log', entry });
  }

  const result = await ctx.services.runSubWorkflow({ workflowId, input, callStack: ctx.callStack });
  if (result.status === 'failed') {
    throw new Error(`Execute Workflow: sub-workflow "${workflowId}" failed`);
  }
  return result.items;
};
