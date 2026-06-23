import type { NodeHandler } from './types';

export const fhirHandler: NodeHandler = async (node, ctx) => {
  if (!ctx.services) throw new Error('FHIR node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const resourceType = String(config.resourceType ?? '').trim();
  if (!resourceType) throw new Error('FHIR node: resourceType is required');
  const limit = Number(config.limit ?? 100);
  return ctx.services.fhirQuery(resourceType, Number.isFinite(limit) && limit > 0 ? limit : 100);
};
