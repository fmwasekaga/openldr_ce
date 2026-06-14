import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';

export interface EventWindow { from: string; to: string }

export interface EventSource {
  id: string;
  name: string;
  run(db: Kysely<ExternalSchema>, window: EventWindow, params?: Record<string, string>): Promise<{ rows: Record<string, unknown>[] }>;
}
