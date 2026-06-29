import type { NodeHandler } from './types';
import { toItems } from '../items';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export const triggerHandler: NodeHandler = async (node, ctx) => {
  // A per-run file attachment (manual upload / webhook body / ingest blob) rides the trigger item.
  if (ctx.files && Object.keys(ctx.files).length > 0) {
    return [{ json: isRecord(ctx.input) ? ctx.input : {}, binary: ctx.files }];
  }
  if (ctx.input !== undefined) return toItems(ctx.input);
  return [{ json: {
    triggered: true,
    triggerType: (node.data.triggerType as string | undefined) ?? 'manual',
    timestamp: new Date().toISOString(),
  } }];
};
