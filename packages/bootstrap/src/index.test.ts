import { describe, it, expect, afterEach } from 'vitest';
import type { Config } from '@openldr/config';
import { createAppContext, type AppContext } from './index';

const cfg: Config = Object.freeze({
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

let ctx: AppContext;
afterEach(async () => { await ctx?.close(); });

describe('createAppContext', () => {
  it('wires and registers all four port health checks', async () => {
    ctx = await createAppContext(cfg);
    const out = await ctx.health.runAll();
    expect(Object.keys(out.checks).sort()).toEqual(['auth', 'blob', 'eventing', 'target-store']);
    expect(typeof ctx.terminology.ontology.listDistributions).toBe('function');
    expect(typeof ctx.terminology.loaders.loinc).toBe('function');
    expect(typeof ctx.forms.list).toBe('function');
    // Nothing reachable in this test → overall down, but no crash.
    expect(out.status).toBe('down');
  }, 20000);
});
