import type { NodeHandler } from './types';
import { runScript } from '../js-isolate';

/**
 * Run the node's JavaScript in the hardened QuickJS-WASM isolate. Console output
 * streams live as node:log; the return value is already normalized to
 * WorkflowItem[] by runScript (via toItems). Limits come from ctx.codeLimits.
 *
 * SECURITY (SEC-01): Code nodes now execute in a QuickJS isolate — pure compute
 * with NO host I/O (no filesystem, network, environment, `process`, `require`, or
 * host event loop reachable). Execution is nonetheless gated behind
 * WORKFLOW_CODE_ENABLED (ctx.codeLimits.enabled), default OFF: arbitrary compute is
 * a bigger surface than a boolean condition even when sandboxed, so we keep the flag
 * as defense-in-depth. We refuse here — BEFORE the isolate is ever started — when
 * the flag is off.
 */
export const codeHandler: NodeHandler = async (node, ctx, input) => {
  const code = (node.data.code as string | undefined) ?? '';
  if (!code.trim()) return input;

  if (!ctx.codeLimits.enabled) {
    throw new Error(
      'Code nodes are disabled. Set WORKFLOW_CODE_ENABLED=true to allow Code nodes to run (sandboxed QuickJS isolate — no host filesystem/network/environment access).',
    );
  }

  try {
    // runScript ALREADY returns WorkflowItem[] (normalized via toItems); return it directly.
    return await runScript(code, {
      input,
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
