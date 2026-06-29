import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import type { LogLevel } from '../../types';

/**
 * A simple "print this" node. Resolves `{{ $json.body.foo }}`-style templates
 * against the input items, pushes the line into ctx.logs[nodeId],
 * and emits a node:log event so it streams live to the UI.
 * Passes input items through unchanged.
 */
export const logHandler: NodeHandler = async (node, ctx, input) => {
  const rawMessage = (node.data.message as string | undefined) ?? '';
  const level = ((node.data.level as LogLevel | undefined) ?? 'log') as LogLevel;
  const message = resolveTemplate(rawMessage, ctx, input);
  const entry = { nodeId: node.id, level, message, ts: Date.now() };
  (ctx.logs[node.id] ??= []).push(entry);
  ctx.emit({ type: 'node:log', entry });
  return input;
};
