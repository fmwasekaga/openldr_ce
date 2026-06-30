import type { NodeHandler } from './types';

const MAX_WAIT_MS = 30_000;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000 };

/**
 * Resolve a wait config to a bounded millisecond duration. An unknown or
 * missing unit defaults to seconds; negative / non-numeric → 0; the result is
 * clamped to [0, 30_000] ms (matches the builder form's "max 30s" hint).
 */
export function resolveWaitMs(config: Record<string, unknown>): number {
  const factor = UNIT_MS[config.unit as string] ?? UNIT_MS.s;
  const raw = Number(config.duration);
  let ms = Number.isFinite(raw) ? raw * factor : 0;
  if (ms < 0) ms = 0;
  return Math.min(ms, MAX_WAIT_MS);
}

/**
 * Pause the workflow for a bounded duration, then pass items through unchanged.
 */
export const waitHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const ms = resolveWaitMs(config);
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  return input;
};
