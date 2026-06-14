import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { amrIsolates } from './reports/amr-isolates';

export interface EventWindow { from: string; to: string }

export interface EventSource {
  id: string;
  name: string;
  run(db: Kysely<ExternalSchema>, window: EventWindow, params?: Record<string, string>): Promise<{ rows: Record<string, unknown>[] }>;
}

const SOURCES: EventSource[] = [amrIsolates];

export function eventSourceCatalog(): EventSource[] { return SOURCES; }
export function getEventSource(id: string): EventSource | undefined { return SOURCES.find((s) => s.id === id); }
