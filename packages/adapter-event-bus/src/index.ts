import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { probe, errorMessage, redact } from '@openldr/core';
import type { EventEnvelope, EventHandler, EventingPort } from '@openldr/ports';
import { backoff } from './backoff';

export interface EventBusConfig {
  url: string;
}

export interface EventBusDeps {
  pool?: pg.Pool;
}

export interface DrainResult {
  processed: number;
  failed: number;
}

export interface EventBus extends EventingPort {
  drain(opts?: { limit?: number }): Promise<DrainResult>;
  startWorker(opts?: { intervalMs?: number }): { stop(): Promise<void> };
  stats(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

interface ClaimedRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

export function createEventBus(cfg: EventBusConfig, deps: EventBusDeps = {}): EventBus {
  const pool = deps.pool ?? new pg.Pool({ connectionString: cfg.url });
  const handlers = new Map<string, EventHandler>();

  async function publish(event: EventEnvelope): Promise<void> {
    const id = randomUUID();
    const batchId = (event.payload as { batchId?: string } | null)?.batchId ?? null;
    await pool.query(
      `insert into outbox_events (id, type, payload, batch_id) values ($1, $2, $3, $4)`,
      [id, event.type, JSON.stringify(event.payload), batchId],
    );
    await pool.query(`select pg_notify('openldr_events', $1)`, [event.type]);
  }

  async function subscribe(type: string, handler: EventHandler): Promise<void> {
    handlers.set(type, handler);
  }

  async function claim(limit: number): Promise<ClaimedRow[]> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const res = await client.query(
        `select id, type, payload, attempts, max_attempts from outbox_events
         where status='pending' and available_at <= now()
         order by available_at limit $1 for update skip locked`,
        [limit],
      );
      const rows = res.rows as ClaimedRow[];
      if (rows.length > 0) {
        await client.query(`update outbox_events set status='processing', updated_at=now() where id = any($1::text[])`, [
          rows.map((r) => r.id),
        ]);
      }
      await client.query('commit');
      return rows;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async function drain(opts: { limit?: number } = {}): Promise<DrainResult> {
    const rows = await claim(opts.limit ?? 20);
    let processed = 0;
    let failed = 0;
    for (const row of rows) {
      const handler = handlers.get(row.type);
      if (!handler) {
        await pool.query(`update outbox_events set status='pending', updated_at=now() where id=$1`, [row.id]);
        continue;
      }
      try {
        await handler({ type: row.type, payload: row.payload });
        await pool.query(`update outbox_events set status='done', updated_at=now() where id=$1`, [row.id]);
        processed++;
      } catch (err) {
        const attempts = row.attempts + 1;
        const msg = redact(errorMessage(err));
        if (attempts < row.max_attempts) {
          await pool.query(
            `update outbox_events set status='pending', attempts=$2,
             available_at = now() + ($3 || ' milliseconds')::interval, last_error=$4, updated_at=now() where id=$1`,
            [row.id, attempts, String(backoff(attempts)), msg],
          );
        } else {
          await pool.query(
            `update outbox_events set status='failed', attempts=$2, last_error=$3, updated_at=now() where id=$1`,
            [row.id, attempts, msg],
          );
          failed++;
        }
      }
    }
    return { processed, failed };
  }

  function startWorker(opts: { intervalMs?: number } = {}): { stop(): Promise<void> } {
    const intervalMs = opts.intervalMs ?? 2000;
    let stopped = false;
    let listenClient: pg.PoolClient | undefined;
    const tick = () => {
      if (stopped) return;
      void drain().catch(() => undefined);
    };
    void (async () => {
      listenClient = await pool.connect();
      await listenClient.query('listen openldr_events');
      listenClient.on('notification', () => tick());
    })();
    const timer = setInterval(tick, intervalMs);
    return {
      async stop() {
        stopped = true;
        clearInterval(timer);
        if (listenClient) {
          try {
            await listenClient.query('unlisten openldr_events');
          } finally {
            listenClient.release();
          }
        }
      },
    };
  }

  async function stats(): Promise<Record<string, number>> {
    const res = await pool.query(`select status, count(*)::int as count from outbox_events group by status`);
    const out: Record<string, number> = {};
    for (const r of res.rows as Array<{ status: string; count: number }>) out[r.status] = r.count;
    return out;
  }

  return {
    publish,
    subscribe,
    drain,
    startWorker,
    stats,
    async healthCheck() {
      return probe(async () => {
        await pool.query("select pg_notify('openldr_health', 'ping')");
        return 'pg_notify reachable';
      });
    },
    async close() {
      await pool.end();
    },
  };
}
