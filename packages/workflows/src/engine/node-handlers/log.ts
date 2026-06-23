import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import type { LogLevel } from '../../types';

/**
 * A simple "print this" node. Resolves `{{ $input.body.foo }}`-style templates
 * against the upstream node's output, pushes the line into ctx.logs[nodeId],
 * and emits a node:log event so it streams live to the UI.
 */
export const logHandler: NodeHandler = async (node, ctx, upstream) => {
  const rawMessage = (node.data.message as string | undefined) ?? '';
  const level = ((node.data.level as LogLevel | undefined) ?? 'log') as LogLevel;

  const message = resolveTemplate(rawMessage, ctx, upstream);

  const entry = {
    nodeId: node.id,
    level,
    message,
    ts: Date.now(),
  };
  (ctx.logs[node.id] ??= []).push(entry);
  ctx.emit({ type: 'node:log', entry });

  return { logged: true, message };
};
