import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createEventBus, type EventBus } from './index';

// Live integration test for the lease reaper. The fake-pool unit tests (lease.test.ts) lock in
// the claim SQL and branch logic; this proves the REAL `updated_at < now() - interval` arithmetic
// actually reclaims a stuck 'processing' row against a live Postgres. Runs only when
// INTERNAL_DATABASE_URL is set (the migrated dev DB); otherwise the whole suite skips, so the
// default hermetic `pnpm test` is unaffected.
const url = process.env.INTERNAL_DATABASE_URL;
const live = describe.skipIf(!url);

live('event-bus lease reaper (live Postgres)', () => {
  let pool: pg.Pool;
  let bus: EventBus | undefined;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => {
    await bus?.close();
    // close() ends the bus's own pool; this test owns a separate handle.
    await pool.end().catch(() => undefined);
  });

  it('reclaims a row stuck in processing past the lease window and re-runs the handler', async () => {
    // leaseMs = 50ms so a row whose updated_at is in the past is immediately stale.
    bus = createEventBus({ url: url!, leaseMs: 50 }, { pool });
    const id = randomUUID();
    await pool.query(
      `insert into outbox_events (id, type, payload, status, attempts, max_attempts, available_at, updated_at)
       values ($1, 'reaper.test', $2, 'processing', 0, 5, now() - interval '1 hour', now() - interval '1 hour')`,
      [id, JSON.stringify({ marker: id })],
    );
    let handled = false;
    await bus.subscribe('reaper.test', async () => {
      handled = true;
    });
    const res = await bus.drain();

    expect(handled).toBe(true);
    expect(res.processed).toBeGreaterThanOrEqual(1);
    const after = await pool.query(`select status, attempts from outbox_events where id=$1`, [id]);
    expect(after.rows[0].status).toBe('done');
    expect(after.rows[0].attempts).toBe(1); // the presumed crash counts as one attempt
    await pool.query(`delete from outbox_events where id=$1`, [id]);
  });

  it('fails a stale processing row terminally once it exhausts max_attempts', async () => {
    bus = createEventBus({ url: url!, leaseMs: 50 }, { pool });
    const id = randomUUID();
    // attempts already at max_attempts-1: reclaiming counts the crash as the final attempt -> failed.
    await pool.query(
      `insert into outbox_events (id, type, payload, status, attempts, max_attempts, available_at, updated_at)
       values ($1, 'reaper.test.dead', $2, 'processing', 4, 5, now() - interval '1 hour', now() - interval '1 hour')`,
      [id, JSON.stringify({ marker: id })],
    );
    // Whether a handler is subscribed is irrelevant — the reaper fails it during claim() before dispatch.
    await bus.drain();
    const after = await pool.query(`select status, attempts, last_error from outbox_events where id=$1`, [id]);
    expect(after.rows[0].status).toBe('failed');
    expect(after.rows[0].attempts).toBe(5);
    expect(String(after.rows[0].last_error ?? '')).toMatch(/lease/i);
    await pool.query(`delete from outbox_events where id=$1`, [id]);
  });
});
