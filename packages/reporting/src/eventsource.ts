import { amrIsolates } from './reports/amr-isolates';
import type { EventSource } from './eventsource-types';

export * from './eventsource-types';

const SOURCES: EventSource[] = [amrIsolates];

export function eventSourceCatalog(): EventSource[] { return SOURCES; }
export function getEventSource(id: string): EventSource | undefined { return SOURCES.find((s) => s.id === id); }
