import { describe, it, expect } from 'vitest';
import { loadConfig } from './load';

const valid = {
  INTERNAL_DATABASE_URL: 'postgres://u:p@localhost:5432/openldr',
  TARGET_DATABASE_URL: 'postgres://u:p@localhost:5432/openldr_target',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'minio',
  S3_SECRET_ACCESS_KEY: 'minio12345',
  S3_BUCKET: 'openldr',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/master',
};

describe('loadConfig', () => {
  it('parses a valid env and applies defaults', () => {
    const cfg = loadConfig(valid);
    expect(cfg.AUTH_ADAPTER).toBe('keycloak');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('throws a ConfigError listing missing required vars', () => {
    expect(() => loadConfig({})).toThrowError(/INTERNAL_DATABASE_URL/);
  });
});
