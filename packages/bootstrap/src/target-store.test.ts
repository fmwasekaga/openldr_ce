import { describe, it, expect } from 'vitest';
import type { Config } from '@openldr/config';
import { selectTargetStore } from './target-store';

// Minimal fake cfg — mirrors index.test.ts's baseCfg fixture. Adapter construction (pg Pool /
// mssql ConnectionPool / mysql2 Pool) is lazy, so none of these selections touch a real DB.
const baseCfg: Config = Object.freeze({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  AUTH_ADAPTER: 'keycloak',
  BLOB_ADAPTER: 'minio',
  EVENTING_ADAPTER: 'pg',
  TARGET_STORE_ADAPTER: 'pg',
  INTERNAL_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  TARGET_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  S3_ENDPOINT: 'http://127.0.0.1:9499',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'x',
  S3_SECRET_ACCESS_KEY: 'xxxxxxxx',
  S3_BUCKET: 'none',
  S3_FORCE_PATH_STYLE: true,
  OIDC_ISSUER_URL: 'http://127.0.0.1:8499/realms/master',
}) as Config;

describe('selectTargetStore', () => {
  it('selects the postgres store by default', async () => {
    const sel = selectTargetStore(baseCfg);
    expect(sel.engine).toBe('postgres');
    expect(typeof sel.store.healthCheck).toBe('function');
    await sel.store.close();
  });

  it('selects the mssql store when TARGET_STORE_ADAPTER=mssql', async () => {
    const sel = selectTargetStore({
      ...baseCfg,
      TARGET_STORE_ADAPTER: 'mssql',
      MSSQL_HOST: 'h',
      MSSQL_PORT: 1433,
      MSSQL_DATABASE: 'd',
      MSSQL_USER: 'u',
      MSSQL_PASSWORD: 'p',
      MSSQL_ENCRYPT: true,
      MSSQL_TRUST_SERVER_CERT: false,
    } as any);
    expect(sel.engine).toBe('mssql');
    expect(typeof sel.store.healthCheck).toBe('function');
    await sel.store.close();
  });

  it('selects the mysql store when TARGET_STORE_ADAPTER=mysql', async () => {
    const sel = selectTargetStore({
      ...baseCfg,
      TARGET_STORE_ADAPTER: 'mysql',
      MYSQL_HOST: 'h',
      MYSQL_PORT: 3306,
      MYSQL_DATABASE: 'd',
      MYSQL_USER: 'u',
      MYSQL_PASSWORD: 'p',
      MYSQL_SSL: false,
    } as any);
    expect(sel.engine).toBe('mysql');
    expect(typeof sel.store.healthCheck).toBe('function');
    await sel.store.close();
  });

  it('throws a ConfigError when mysql is selected without required MYSQL_* vars', () => {
    expect(() => selectTargetStore(baseCfg, 'mysql')).toThrow(/mysql target store requires/);
  });
});
