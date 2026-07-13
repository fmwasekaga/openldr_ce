import type { Migration } from 'kysely';
import type { TargetEngine } from '../../engine';
import * as m001 from './001_flat_tables';
import * as m002 from './002_specimen_origin';
import * as m003 from './003_v2_core';
import * as m004 from './004_v2_patients_facility';
import * as m005 from './005_v2_specimen_diagreport';

export function externalMigrations(engine: TargetEngine): Record<string, Migration> {
  return {
    '001_flat_tables': { up: (db) => m001.up(db, engine), down: m001.down },
    '002_specimen_origin': { up: (db) => m002.up(db, engine), down: m002.down },
    '003_v2_core': { up: (db) => m003.up(db, engine), down: m003.down },
    '004_v2_patients_facility': { up: (db) => m004.up(db, engine), down: m004.down },
    '005_v2_specimen_diagreport': { up: (db) => m005.up(db, engine), down: m005.down },
  };
}
