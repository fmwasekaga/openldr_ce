import { randomUUID } from 'node:crypto';
import { type Kysely } from 'kysely';
import type { Logger } from '@openldr/core';
import type { InternalSchema } from '@openldr/db';

export interface AuditEventInput {
  actorType: 'user' | 'system';
  actorId?: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditEvent extends AuditEventInput {
  id: string;
  occurredAt: string;
}

export interface AuditFilter {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AuditStore {
  record(e: AuditEventInput): Promise<AuditEvent>;
  list(filter?: AuditFilter): Promise<AuditEvent[]>;
  get(id: string): Promise<AuditEvent | undefined>;
}

interface Row {
  id: string;
  occurred_at: Date;
  actor_type: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

function toEvent(r: Row): AuditEvent {
  return {
    id: r.id,
    occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at),
    actorType: r.actor_type === 'user' ? 'user' : 'system',
    actorId: r.actor_id,
    actorName: r.actor_name,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    before: r.before ?? undefined,
    after: r.after ?? undefined,
    metadata: (r.metadata as Record<string, unknown> | null) ?? undefined,
  };
}

export function createAuditStore(db: Kysely<InternalSchema>): AuditStore {
  return {
    async record(e) {
      const id = randomUUID();
      await db
        .insertInto('audit_events')
        .values({
          id,
          actor_type: e.actorType,
          actor_id: e.actorId ?? null,
          actor_name: e.actorName,
          action: e.action,
          entity_type: e.entityType,
          entity_id: e.entityId,
          before: (e.before ?? null) as never,
          after: (e.after ?? null) as never,
          metadata: (e.metadata ?? null) as never,
        })
        .execute();
      const row = await db.selectFrom('audit_events').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return toEvent(row as unknown as Row);
    },
    async list(filter = {}) {
      let q = db.selectFrom('audit_events').selectAll().orderBy('occurred_at', 'desc');
      if (filter.actorId) q = q.where('actor_id', '=', filter.actorId);
      if (filter.entityType) q = q.where('entity_type', '=', filter.entityType);
      if (filter.entityId) q = q.where('entity_id', '=', filter.entityId);
      if (filter.action) q = q.where('action', '=', filter.action);
      const from = filter.from ? new Date(filter.from) : undefined;
      const to = filter.to ? new Date(filter.to) : undefined;
      if (from && !Number.isNaN(from.getTime())) q = q.where('occurred_at', '>=', from);
      if (to && !Number.isNaN(to.getTime())) q = q.where('occurred_at', '<=', to);
      const rows = await q.limit(filter.limit ?? 100).execute();
      return rows.map((r) => toEvent(r as unknown as Row));
    },
    async get(id) {
      const r = await db.selectFrom('audit_events').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? toEvent(r as unknown as Row) : undefined;
    },
  };
}

/** Best-effort recorder — never throws into the caller (audit must not break the audited op). */
export async function safeRecord(store: AuditStore, logger: Logger, e: AuditEventInput): Promise<void> {
  try {
    await store.record(e);
  } catch (err) {
    logger.error({ action: e.action, error: err instanceof Error ? err.message : String(err) }, 'audit record failed');
  }
}
