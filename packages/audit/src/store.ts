import { randomUUID } from 'node:crypto';
import { type Kysely, type ExpressionBuilder } from 'kysely';
import type { Logger } from '@openldr/core';
import type { InternalSchema } from '@openldr/db';

export interface AuditEventInput {
  actorType: 'user' | 'system' | 'cli';
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
  offset?: number;
}

export interface AuditStore {
  record(e: AuditEventInput): Promise<AuditEvent>;
  list(filter?: AuditFilter): Promise<AuditEvent[]>;
  count(filter?: AuditFilter): Promise<number>;
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
    actorType: r.actor_type === 'user' || r.actor_type === 'cli' ? r.actor_type : 'system',
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
  function filterExpressions(eb: ExpressionBuilder<InternalSchema, 'audit_events'>, filter: AuditFilter) {
    const expressions = [];
    if (filter.actorId) expressions.push(eb('actor_id', '=', filter.actorId));
    if (filter.entityType) expressions.push(eb('entity_type', '=', filter.entityType));
    if (filter.entityId) expressions.push(eb('entity_id', '=', filter.entityId));
    if (filter.action) expressions.push(eb('action', '=', filter.action));
    const from = filter.from ? new Date(filter.from) : undefined;
    const to = filter.to ? new Date(filter.to) : undefined;
    if (from && !Number.isNaN(from.getTime())) expressions.push(eb('occurred_at', '>=', from));
    if (to && !Number.isNaN(to.getTime())) expressions.push(eb('occurred_at', '<=', to));
    return expressions;
  }

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
      const rows = await db
        .selectFrom('audit_events')
        .selectAll()
        .where((eb) => eb.and(filterExpressions(eb, filter)))
        .orderBy('occurred_at', 'desc')
        .limit(filter.limit ?? 100)
        .offset(filter.offset ?? 0)
        .execute();
      return rows.map((r) => toEvent(r as unknown as Row));
    },
    async count(filter = {}) {
      const r = await db
        .selectFrom('audit_events')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where((eb) => eb.and(filterExpressions(eb, filter)))
        .executeTakeFirst();
      return Number(r?.n ?? 0);
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
