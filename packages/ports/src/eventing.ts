import type { HealthResult } from './health';

export interface EventEnvelope {
  type: string;
  payload: unknown;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export interface EventingPort {
  healthCheck(): Promise<HealthResult>;
  /** Full outbox/worker semantics land in the ingest sub-project (§8 step 4). */
  publish(event: EventEnvelope): Promise<void>;
  subscribe(type: string, handler: EventHandler): Promise<void>;
}
