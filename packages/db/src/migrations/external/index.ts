import type { Migration } from 'kysely';
import * as m001 from './001_flat_tables';

export const externalMigrations: Record<string, Migration> = {
  '001_flat_tables': { up: m001.up, down: m001.down },
};
