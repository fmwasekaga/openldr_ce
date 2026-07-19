import { safeRecord, type AuditStore, type AuditEventInput } from '@openldr/audit';
import type { Logger } from '@openldr/core';

export type AuditActor = Pick<AuditEventInput, 'actorType' | 'actorId' | 'actorName'>;

export interface AuditDetails {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Request-free audit recorder shared by the server's recordAudit wrapper and the CLI. Best-effort:
 *  a store failure is logged, never thrown into the audited operation. */
export async function recordAuditEvent(
  ctx: { audit: AuditStore; logger: Logger },
  actor: AuditActor,
  d: AuditDetails,
): Promise<void> {
  await safeRecord(ctx.audit, ctx.logger, { ...actor, ...d });
}
