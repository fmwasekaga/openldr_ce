import type { Kysely } from 'kysely';
import type { Logger } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { InternalSchema } from '@openldr/db';
import type { AuditStore } from '@openldr/audit';
import { safeRecord } from '@openldr/audit';
import { createPluginStore, createPluginRuntime, createExtismRunner, type PluginRuntime } from '@openldr/plugins';
import { createTrustStore } from '@openldr/marketplace';

const CE_VERSION = '0.1.0'; // artifact compatibility gate; matches package.json

/** Single source of truth for wiring the plugin/artifact registry — used by both the ingest worker and the server AppContext. */
export function createPluginRegistry(deps: {
  blob: BlobStoragePort;
  internalDb: Kysely<InternalSchema>;
  logger: Logger;
  audit: AuditStore;
  devAllowUnsigned: boolean;
}): PluginRuntime {
  return createPluginRuntime({
    blob: deps.blob,
    store: createPluginStore(deps.internalDb),
    runner: createExtismRunner(),
    logger: deps.logger,
    trustStore: createTrustStore(deps.internalDb),
    ceVersion: CE_VERSION,
    verifyConfig: { devAllowUnsigned: deps.devAllowUnsigned },
    recordInstall: (e) => safeRecord(deps.audit, deps.logger, e),
  });
}
