import type { FastifyRequest } from 'fastify';
import { recordAuditEvent, type AuditActor, type AuditDetails } from '@openldr/bootstrap';
import type { AppContext } from '@openldr/bootstrap';

export type { AuditDetails };

export function actorFromRequest(req: FastifyRequest): AuditActor {
  if (req.user) return { actorType: 'user', actorId: req.user.id, actorName: req.user.username };
  return { actorType: 'system', actorId: null, actorName: 'System' };
}

/** Best-effort audit recorder for HTTP routes — a thin wrapper over the shared recordAuditEvent. */
export async function recordAudit(ctx: AppContext, req: FastifyRequest, d: AuditDetails): Promise<void> {
  await recordAuditEvent(ctx, actorFromRequest(req), d);
}
