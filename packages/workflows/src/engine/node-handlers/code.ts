import type { NodeHandler } from './types';
import { runInSandbox } from '../sandbox';

/**
 * Run the node's JavaScript in the worker+vm sandbox. Console output streams
 * live as node:log; the return value becomes the node output. Limits come from
 * ctx.codeLimits (config-driven).
 *
 * SECURITY (SEC-01): `vm` is NOT a security boundary — Code nodes execute with
 * host-level privileges (fs/net/env). Execution is gated behind
 * WORKFLOW_CODE_ENABLED (ctx.codeLimits.enabled), default OFF. We refuse here —
 * BEFORE the worker is ever started — when the flag is off.
 */
export const codeHandler: NodeHandler = async (node, ctx, upstream) => {
  const code = (node.data.code as string | undefined) ?? '';
  if (!code.trim()) return { executed: true, output: undefined };

  if (!ctx.codeLimits.enabled) {
    throw new Error(
      'Code nodes are disabled. Set WORKFLOW_CODE_ENABLED=true only in trusted deployments — Code nodes execute with host-level privileges, not in a security sandbox.',
    );
  }

  // Loud, one-line warning whenever an enabled Code node actually runs.
  if (ctx.logger?.warn) {
    ctx.logger.warn(
      `Workflow Code node ${node.id} is executing with HOST-LEVEL privileges (WORKFLOW_CODE_ENABLED is on; vm is not a security sandbox).`,
    );
  } else {
    process.emitWarning(
      'Workflow Code node executing with host-level privileges (WORKFLOW_CODE_ENABLED is on; vm is not a security sandbox).',
      'WorkflowCodeNodeWarning',
    );
  }

  try {
    return await runInSandbox(code, {
      input: upstream,
      nodeOutputs: ctx.nodeOutputs,
      limits: ctx.codeLimits,
      onLog: (level, message) => {
        const entry = { nodeId: node.id, level, message, ts: Date.now() };
        (ctx.logs[node.id] ??= []).push(entry);
        ctx.emit({ type: 'node:log', entry });
      },
    });
  } catch (err) {
    throw new Error(`Code node error: ${err instanceof Error ? err.message : String(err)}`);
  }
};
