import type { NodeHandler } from './types';

export const dhis2PushHandler: NodeHandler = async (node, ctx) => {
  if (!ctx.services?.dhis2Push) {
    throw new Error('DHIS2 push not available (DHIS2 is not the configured reporting target)');
  }
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const mappingId = String(config.mappingId ?? '').trim();
  const period = String(config.period ?? '').trim();
  if (!mappingId || !period) throw new Error('DHIS2 push node: mappingId and period are required');
  return ctx.services.dhis2Push({ mappingId, period, dryRun: Boolean(config.dryRun) });
};
