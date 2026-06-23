import type { NodeHandler } from './types';
import { runInSandbox } from '../sandbox';

/**
 * Run the node's JavaScript in the worker+vm sandbox. Console output streams
 * live as node:log; the return value becomes the node output. Limits come from
 * ctx.codeLimits (config-driven).
 */
export const codeHandler: NodeHandler = async (node, ctx, upstream) => {
  const code = (node.data.code as string | undefined) ?? '';
  if (!code.trim()) return { executed: true, output: undefined };

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
