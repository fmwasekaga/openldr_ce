import type { FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';

type AuditInput = Parameters<AppContext['audit']['record']>[0];
type Actor = Pick<AuditInput, 'actorType' | 'actorId' | 'actorName'>;

export interface AuditDetails {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export function actorFromRequest(req: FastifyRequest): Actor {
  if (req.user) return { actorType: 'user', actorId: req.user.id, actorName: req.user.username };
  return { actorType: 'system', actorId: null, actorName: 'System' };
}

/** Best-effort audit recorder — never throws into the caller (audit must not break the op). */
export async function recordAudit(ctx: AppContext, req: FastifyRequest, d: AuditDetails): Promise<void> {
  try {
    await ctx.audit.record({ ...actorFromRequest(req), ...d } as AuditInput);
  } catch (e) {
    ctx.logger.error({ action: d.action, error: e instanceof Error ? e.message : String(e) }, 'audit record failed');
  }
}
