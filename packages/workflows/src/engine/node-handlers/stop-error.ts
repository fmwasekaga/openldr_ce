import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/** Halts the workflow by throwing. The message supports {{ $json.x }} templates. */
export const stopErrorHandler: NodeHandler = async (node, ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const raw = (config.errorMessage as string) ?? '';
  const message = resolveTemplate(raw, ctx, input).trim() || 'Workflow stopped';
  throw new Error(message);
};
