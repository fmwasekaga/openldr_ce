import type { HealthResult } from './health';

export interface EventEnvelope {
  type: string;
  payload: unknown;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export interface PublishOptions {
  /** Earliest time the event may be claimed. Omitted ⇒ now (immediate). */
  availableAt?: Date;
}

export interface EventingPort {
  healthCheck(): Promise<HealthResult>;
  /** Full outbox/worker semantics land in the ingest sub-project (§8 step 4). */
  publish(event: EventEnvelope, opts?: PublishOptions): Promise<void>;
  subscribe(type: string, handler: EventHandler): Promise<void>;
}
