import type { Migration } from 'kysely';
import type { TargetEngine } from '../../engine';
import * as m001 from './001_flat_tables';

export function externalMigrations(engine: TargetEngine): Record<string, Migration> {
  return {
    '001_flat_tables': { up: (db) => m001.up(db, engine), down: m001.down },
  };
}
