import type { HealthResult } from './health';

export interface BlobStoragePort {
  healthCheck(): Promise<HealthResult>;
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  presign(key: string, expiresInSeconds?: number): Promise<string>;
}
