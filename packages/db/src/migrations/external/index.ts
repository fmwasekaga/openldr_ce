import type { Migration } from 'kysely';
import type { TargetEngine } from '../../engine';
import * as m001 from './001_flat_tables';
import * as m002 from './002_specimen_origin';

export function externalMigrations(engine: TargetEngine): Record<string, Migration> {
  return {
    '001_flat_tables': { up: (db) => m001.up(db, engine), down: m001.down },
    '002_specimen_origin': { up: (db) => m002.up(db, engine), down: m002.down },
  };
}
