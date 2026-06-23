import type { NodeHandler } from './types';

/**
 * Trigger nodes have no upstream — their output is whatever started the run.
 * For manual triggers we surface a small object so users can still
 * `console.log($input)` and see something. For webhook triggers the runner
 * should have set `ctx.input` to the request payload.
 */
export const triggerHandler: NodeHandler = async (node, ctx) => {
  if (ctx.input !== undefined) return ctx.input;

  return {
    triggered: true,
    triggerType: (node.data.triggerType as string | undefined) ?? 'manual',
    timestamp: new Date().toISOString(),
  };
};
