import type { Migration } from 'kysely';
import * as m001 from './001_fhir_resources';

export const internalMigrations: Record<string, Migration> = {
  '001_fhir_resources': { up: m001.up, down: m001.down },
};
