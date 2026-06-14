import type { Migration } from 'kysely';
import * as m001 from './001_fhir_resources';
import * as m002 from './002_outbox';
import * as m003 from './003_ingest_batches';
import * as m004 from './004_plugins';
import * as m005 from './005_audit_events';
import * as m006 from './006_users';
import * as m007 from './007_terminology';
import * as m008 from './008_dhis2';
import * as m009 from './009_dhis2_schedules';
import * as m010 from './010_ingest_batch_config';

export const internalMigrations: Record<string, Migration> = {
  '001_fhir_resources': { up: m001.up, down: m001.down },
  '002_outbox': { up: m002.up, down: m002.down },
  '003_ingest_batches': { up: m003.up, down: m003.down },
  '004_plugins': { up: m004.up, down: m004.down },
  '005_audit_events': { up: m005.up, down: m005.down },
  '006_users': { up: m006.up, down: m006.down },
  '007_terminology': { up: m007.up, down: m007.down },
  '008_dhis2': { up: m008.up, down: m008.down },
  '009_dhis2_schedules': { up: m009.up, down: m009.down },
  '010_ingest_batch_config': { up: m010.up, down: m010.down },
};
