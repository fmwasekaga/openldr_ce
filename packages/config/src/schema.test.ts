import { describe, it, expect } from 'vitest';
import { ConfigSchema } from './schema';

const base = {
  INTERNAL_DATABASE_URL: 'postgres://u:p@localhost/db', TARGET_DATABASE_URL: 'postgres://u:p@localhost/ext',
  S3_ENDPOINT: 'http://localhost:9010', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_BUCKET: 'b',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/master',
};
describe('dashboard SQL config', () => {
  it('defaults DASHBOARD_SQL_ENABLED to false', () => {
    const cfg = ConfigSchema.parse(base);
    expect(cfg.DASHBOARD_SQL_ENABLED).toBe(false);
    expect(cfg.DASHBOARD_SQL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(cfg.DASHBOARD_SQL_ROW_CAP).toBeGreaterThan(0);
  });
  it('parses DASHBOARD_SQL_ENABLED=true', () => {
    expect(ConfigSchema.parse({ ...base, DASHBOARD_SQL_ENABLED: 'true' }).DASHBOARD_SQL_ENABLED).toBe(true);
  });
});

describe('auth config', () => {
  it('defaults AUTH_DEV_BYPASS on in development', () => {
    const cfg = ConfigSchema.parse({ ...base, NODE_ENV: 'development' });
    expect(cfg.AUTH_DEV_BYPASS).toBe(true);
  });
  it('defaults AUTH_DEV_BYPASS off in production', () => {
    const cfg = ConfigSchema.parse({ ...base, NODE_ENV: 'production' });
    expect(cfg.AUTH_DEV_BYPASS).toBe(false);
  });
  it('rejects AUTH_DEV_BYPASS=true under production', () => {
    expect(() => ConfigSchema.parse({ ...base, NODE_ENV: 'production', AUTH_DEV_BYPASS: 'true' })).toThrow(/AUTH_DEV_BYPASS/);
  });
  it('exposes dev actor defaults', () => {
    const cfg = ConfigSchema.parse({ ...base, NODE_ENV: 'development' });
    expect(cfg.AUTH_DEV_USERNAME).toBe('dev-admin');
    expect(cfg.AUTH_DEV_ROLES).toBe('lab_admin');
  });
});
