import type { Migration } from 'kysely';
import * as m001 from './001_fhir_resources';
import * as m002 from './002_outbox';
import * as m003 from './003_ingest_batches';

export const internalMigrations: Record<string, Migration> = {
  '001_fhir_resources': { up: m001.up, down: m001.down },
  '002_outbox': { up: m002.up, down: m002.down },
  '003_ingest_batches': { up: m003.up, down: m003.down },
};
