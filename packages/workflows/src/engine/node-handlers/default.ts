import type { NodeHandler } from './types';

/** Fallback for unimplemented node types — passes items through unchanged. */
export const defaultHandler: NodeHandler = async (_node, _ctx, input) => input;
