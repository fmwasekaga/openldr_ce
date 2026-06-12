import type { Kysely } from 'kysely';
import type { HealthResult } from './health';

// Phase-1 schema is open; concrete tables arrive with the flattening layer (§8 step 2).
export type TargetSchema = Record<string, unknown>;

export interface TargetStorePort {
  healthCheck(): Promise<HealthResult>;
  readonly db: Kysely<TargetSchema>;
  transaction<T>(fn: (trx: Kysely<TargetSchema>) => Promise<T>): Promise<T>;
}
