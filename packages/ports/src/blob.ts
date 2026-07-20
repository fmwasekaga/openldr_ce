import type { HealthResult } from './health';
import type { Readable } from 'node:stream';

export interface BlobStoragePort {
  healthCheck(): Promise<HealthResult>;
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  /** Streaming put for large objects (multipart under the hood); never buffers the whole body. */
  putStream(key: string, body: Readable, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Streaming get for large objects; returns the object body as a Node Readable. */
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  presign(key: string, expiresInSeconds?: number): Promise<string>;
}
