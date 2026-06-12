import pg from 'pg';
import { probe } from '@openldr/core';
import type { EventEnvelope, EventHandler, EventingPort } from '@openldr/ports';

export interface EventBusConfig {
  url: string;
}

export interface EventBusDeps {
  pool?: pg.Pool;
}

export interface EventBus extends EventingPort {
  close(): Promise<void>;
}

export function createEventBus(cfg: EventBusConfig, deps: EventBusDeps = {}): EventBus {
  const pool = deps.pool ?? new pg.Pool({ connectionString: cfg.url });

  return {
    async healthCheck() {
      return probe(async () => {
        await pool.query("select pg_notify('openldr_health', 'ping')");
        return 'pg_notify reachable';
      });
    },
    async publish(_event: EventEnvelope) {
      throw new Error('event-bus.publish not implemented in the skeleton');
    },
    async subscribe(_type: string, _handler: EventHandler) {
      throw new Error('event-bus.subscribe not implemented in the skeleton');
    },
    async close() {
      await pool.end();
    },
  };
}
