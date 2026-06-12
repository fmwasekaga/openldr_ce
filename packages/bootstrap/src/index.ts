import { createAuth } from '@openldr/adapter-auth';
import { createDbStore } from '@openldr/adapter-db-store';
import { createEventBus } from '@openldr/adapter-event-bus';
import { createS3Bucket } from '@openldr/adapter-s3-bucket';
import type { Config } from '@openldr/config';
import { createLogger, HealthRegistry, type Logger } from '@openldr/core';
import type { AuthPort, BlobStoragePort, EventingPort, TargetStorePort } from '@openldr/ports';

export interface AppContext {
  logger: Logger;
  auth: AuthPort;
  blob: BlobStoragePort;
  eventing: EventingPort;
  store: TargetStorePort;
  health: HealthRegistry;
  close(): Promise<void>;
}

export async function createAppContext(cfg: Config): Promise<AppContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });

  const auth = createAuth({ issuerUrl: cfg.OIDC_ISSUER_URL });
  const blob = createS3Bucket({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    accessKeyId: cfg.S3_ACCESS_KEY_ID,
    secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    bucket: cfg.S3_BUCKET,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  });
  const eventing = createEventBus({ url: cfg.INTERNAL_DATABASE_URL });
  const store = createDbStore({ url: cfg.TARGET_DATABASE_URL });

  const health = new HealthRegistry();
  health.register({ name: 'auth', check: () => auth.healthCheck() });
  health.register({ name: 'blob', check: () => blob.healthCheck() });
  health.register({ name: 'eventing', check: () => eventing.healthCheck() });
  health.register({ name: 'target-store', check: () => store.healthCheck() });

  return {
    logger,
    auth,
    blob,
    eventing,
    store,
    health,
    async close() {
      await Promise.allSettled([eventing.close(), store.close()]);
    },
  };
}
