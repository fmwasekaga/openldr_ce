import { describe, it, expect } from 'vitest';
import { ConfigSchema } from './schema';

const base = {
  INTERNAL_DATABASE_URL: 'postgres://u:p@localhost/db', TARGET_DATABASE_URL: 'postgres://u:p@localhost/ext',
  S3_ENDPOINT: 'http://localhost:9010', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_BUCKET: 'b',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/master',
};
describe('workflow code sandbox config', () => {
  it('defaults the workflow code sandbox limits', () => {
    const cfg = ConfigSchema.parse(base);
    expect(cfg.WORKFLOW_CODE_TIMEOUT_MS).toBe(5000);
    expect(cfg.WORKFLOW_CODE_MEMORY_MB).toBe(128);
  });
  it('defaults WORKFLOW_HTTP_ALLOWLIST to empty', () => {
    expect(ConfigSchema.parse(base).WORKFLOW_HTTP_ALLOWLIST).toBe('');
  });
});

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

describe('startup migration config', () => {
  it('defaults MIGRATE_ON_START to false', () => {
    expect(ConfigSchema.parse(base).MIGRATE_ON_START).toBe(false);
  });
  it('parses MIGRATE_ON_START=true', () => {
    expect(ConfigSchema.parse({ ...base, MIGRATE_ON_START: 'true' }).MIGRATE_ON_START).toBe(true);
  });
  it('defaults SEED_ON_START to false', () => {
    expect(ConfigSchema.parse(base).SEED_ON_START).toBe(false);
  });
  it('parses SEED_ON_START=true', () => {
    expect(ConfigSchema.parse({ ...base, SEED_ON_START: 'true' }).SEED_ON_START).toBe(true);
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
  it('accepts optional Keycloak admin client credentials', () => {
    const cfg = ConfigSchema.parse({ ...base, KEYCLOAK_ADMIN_CLIENT_ID: 'svc', KEYCLOAK_ADMIN_CLIENT_SECRET: 'sek' });
    expect(cfg.KEYCLOAK_ADMIN_CLIENT_ID).toBe('svc');
    expect(cfg.KEYCLOAK_ADMIN_CLIENT_SECRET).toBe('sek');
  });
  it('leaves admin creds undefined when omitted', () => {
    const cfg = ConfigSchema.parse({ ...base });
    expect(cfg.KEYCLOAK_ADMIN_CLIENT_ID).toBeUndefined();
  });
});
