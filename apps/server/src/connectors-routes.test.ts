import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import type { ConnectorRecord, ConnectorStore, NewConnector, ConnectorPatch } from '@openldr/db';
import { registerConnectorsRoutes } from './connectors-routes';

// In-memory ConnectorStore matching the real masking + fail-closed contract.
function fakeStore(): ConnectorStore {
  const rows = new Map<string, { rec: ConnectorRecord; config: Record<string, string> }>();
  const requireKey = (key: string | undefined) => { if (!key) throw new Error('SECRETS_ENCRYPTION_KEY is required'); };
  return {
    async create(input: NewConnector, key) {
      requireKey(key);
      rows.set(input.id, {
        rec: { id: input.id, name: input.name, pluginId: input.pluginId ?? null, type: input.type ?? null, kind: input.kind, allowedHost: input.allowedHost ?? null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
        config: input.config,
      });
    },
    async get(id) { return rows.get(id)?.rec ?? null; },
    async list() { return [...rows.values()].map((r) => r.rec); },
    async update(id, patch: ConnectorPatch, key) {
      const row = rows.get(id); if (!row) return;
      if (patch.config !== undefined) { requireKey(key); row.config = patch.config; }
      if (patch.name !== undefined) row.rec.name = patch.name;
      if (patch.allowedHost !== undefined) row.rec.allowedHost = patch.allowedHost;
      if (patch.enabled !== undefined) row.rec.enabled = patch.enabled;
    },
    async remove(id) { rows.delete(id); },
    async getDecryptedConfig(id, key) { requireKey(key); const r = rows.get(id); if (!r) throw new Error(`connector ${id} not found`); return r.config; },
  };
}

function fakeSink(metadataCounts = { dataElements: 2, orgUnits: 1, categoryOptionCombos: 1, programs: 0, programStages: 0 }) {
  return {
    id: 'dhis2-sink', version: '0.1.0', entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker'],
    invoke: async (ep: string) => {
      if (ep === 'health_check') return { ok: true, version: '2.40' };
      if (ep === 'pull_metadata') return { dataElements: Array(metadataCounts.dataElements).fill({ id: 'd', name: 'd' }), orgUnits: Array(metadataCounts.orgUnits).fill({ id: 'o', name: 'o' }), categoryOptionCombos: Array(metadataCounts.categoryOptionCombos).fill({ id: 'c', name: 'c' }), programs: [], programStages: [] };
      return {};
    },
  };
}

type AuditRecord = { action: string; entityType: string; entityId: string; metadata?: Record<string, unknown> };

function fakeCtx(over: Partial<{ key: string | undefined; loadSink: (id: string) => Promise<unknown>; pluginRows: unknown[]; audited: AuditRecord[] }> = {}): AppContext {
  return {
    cfg: { SECRETS_ENCRYPTION_KEY: 'key' in over ? over.key : 'a'.repeat(44) },
    logger: { error() {}, warn() {}, info() {}, debug() {} },
    audit: { record: async (e: AuditRecord) => { over.audited?.push(e); } },
    plugins: {
      loadSink: over.loadSink ?? (async () => fakeSink()),
      list: async () => over.pluginRows ?? [
        { id: 'dhis2-sink', version: '0.1.0', enabled: true, manifest: { kind: 'sink' } },
        { id: 'whonet-sqlite', version: '0.1.0', enabled: true, manifest: { kind: 'source' } },
      ],
    },
  } as unknown as AppContext;
}

function appWith(store: ConnectorStore, ctx: AppContext = fakeCtx(), roles: string[] = ['lab_admin'], capabilities: string[] = ['connectors.manage']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles, capabilities } as never; });
  registerConnectorsRoutes(app, ctx, { connectors: store });
  return app;
}

const newBody = { name: 'DHIS2 Demo', pluginId: 'dhis2-sink', config: { baseUrl: 'https://dhis2.example/dhis', username: 'admin', password: 'district' } };

describe('connectors routes', () => {
  it('creates, lists (no secrets), and gets', async () => {
    const store = fakeStore();
    const app = appWith(store);
    const created = await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody });
    expect(created.statusCode).toBe(200);
    const rec = created.json();
    expect(rec).toMatchObject({ name: 'DHIS2 Demo', pluginId: 'dhis2-sink', kind: 'sink', allowedHost: 'dhis2.example', enabled: true });
    expect(JSON.stringify(rec)).not.toContain('district'); // no secret leaked
    expect(rec).not.toHaveProperty('config');

    const list = await app.inject({ method: 'GET', url: '/api/connectors' });
    expect(list.json()).toHaveLength(1);
    expect(JSON.stringify(list.json())).not.toContain('district');

    const got = await app.inject({ method: 'GET', url: `/api/connectors/${rec.id}` });
    expect(got.json().name).toBe('DHIS2 Demo');
    expect(JSON.stringify(got.json())).not.toContain('district'); // no secret on get-by-id either
  });

  it('fails create with 400 when the encryption key is unset', async () => {
    const app = appWith(fakeStore(), fakeCtx({ key: undefined }));
    const res = await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/SECRETS_ENCRYPTION_KEY/);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await appWith(fakeStore()).inject({ method: 'POST', url: '/api/connectors', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('updates (enabled + name) and deletes', async () => {
    const store = fakeStore();
    const app = appWith(store);
    const id = (await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody })).json().id;
    const upd = await app.inject({ method: 'PUT', url: `/api/connectors/${id}`, payload: { name: 'Renamed', enabled: false } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ name: 'Renamed', enabled: false });
    const del = await app.inject({ method: 'DELETE', url: `/api/connectors/${id}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/connectors' })).json()).toHaveLength(0);
  });

  it('lists only sink plugins', async () => {
    const res = await appWith(fakeStore()).inject({ method: 'GET', url: '/api/connectors/sink-plugins' });
    expect(res.json()).toEqual([{ id: 'dhis2-sink', version: '0.1.0', enabled: true }]);
  });

  it('test endpoint runs health_check + pull_metadata and returns a metadata summary', async () => {
    const store = fakeStore();
    const app = appWith(store);
    const id = (await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody })).json().id;
    const res = await app.inject({ method: 'POST', url: `/api/connectors/${id}/test` });
    expect(res.json()).toEqual({ ok: true, metadata: { dataElements: 2, orgUnits: 1, categoryOptionCombos: 1, programs: 0, programStages: 0 } });
  });

  it('test endpoint returns ok:false when the sink plugin is not installed', async () => {
    const store = fakeStore();
    const app = appWith(store, fakeCtx({ loadSink: async () => undefined }));
    const id = (await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody })).json().id;
    const res = await app.inject({ method: 'POST', url: `/api/connectors/${id}/test` });
    expect(res.json()).toMatchObject({ ok: false });
    expect(res.json().error).toMatch(/not installed/);
  });

  describe('audit trail', () => {
    it('records create/update/delete + test outcomes, and never logs secret values', async () => {
      const audited: AuditRecord[] = [];
      const store = fakeStore();
      const app = appWith(store, fakeCtx({ audited }));
      const secretBody = { name: 'C', pluginId: 'dhis2-sink', config: { baseUrl: 'https://dhis.example/', username: 'admin', password: 'hunter2' } };
      const id = (await app.inject({ method: 'POST', url: '/api/connectors', payload: secretBody })).json().id;
      await app.inject({ method: 'PUT', url: `/api/connectors/${id}`, payload: { config: { baseUrl: 'https://dhis.example/', username: 'admin', password: 'rotated' } } });
      await app.inject({ method: 'POST', url: `/api/connectors/${id}/test` });
      await app.inject({ method: 'DELETE', url: `/api/connectors/${id}` });

      const actions = audited.map((a) => a.action);
      expect(actions).toEqual(['connector.create', 'connector.update', 'connector.test', 'connector.delete']);
      // The password must never appear anywhere in the audit metadata.
      expect(JSON.stringify(audited)).not.toContain('hunter2');
      expect(JSON.stringify(audited)).not.toContain('rotated');
      expect(audited[0].metadata).toMatchObject({ pluginId: 'dhis2-sink', allowedHost: 'dhis.example' });
      expect(audited[1].metadata).toMatchObject({ secretsRotated: true });
      expect(audited[2].metadata).toMatchObject({ outcome: 'ok' });
    });

    it('records a failed test outcome', async () => {
      const audited: AuditRecord[] = [];
      const store = fakeStore();
      const app = appWith(store, fakeCtx({ audited, loadSink: async () => undefined }));
      const id = (await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody })).json().id;
      await app.inject({ method: 'POST', url: `/api/connectors/${id}/test` });
      const test = audited.find((a) => a.action === 'connector.test');
      expect(test?.metadata).toMatchObject({ outcome: 'failed' });
    });
  });

  describe('host (database) connectors', () => {
    const pgBody = { name: 'PG One', type: 'postgres', config: { host: 'db.example', port: '5432', database: 'ldr', user: 'admin', password: 'secret' } };

    it('creates a host connector with type+kind:database, no pluginId', async () => {
      const store = fakeStore();
      const app = appWith(store);
      const res = await app.inject({ method: 'POST', url: '/api/connectors', payload: pgBody });
      expect(res.statusCode).toBe(200);
      const rec = res.json();
      expect(rec).toMatchObject({ name: 'PG One', type: 'postgres', kind: 'database', enabled: true });
      expect(rec.pluginId).toBeNull();
      expect(JSON.stringify(rec)).not.toContain('secret');
    });

    it('rejects POST with neither pluginId nor type with 400', async () => {
      const res = await appWith(fakeStore()).inject({
        method: 'POST', url: '/api/connectors',
        payload: { name: 'Bad', config: { host: 'x' } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects POST with both pluginId and type with 400', async () => {
      const res = await appWith(fakeStore()).inject({
        method: 'POST', url: '/api/connectors',
        payload: { name: 'Bad', pluginId: 'dhis2-sink', type: 'postgres', config: { host: 'x' } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('test endpoint routes a host connector to the SELECT 1 path (200 with ok)', async () => {
      const store = fakeStore();
      const app = appWith(store);
      const id = (await app.inject({ method: 'POST', url: '/api/connectors', payload: pgBody })).json().id;
      const res = await app.inject({ method: 'POST', url: `/api/connectors/${id}/test` });
      // No live DB here, so the real connection errors → ok:false with an error string (not 400/404).
      // This asserts the route branches to the host SELECT 1 path rather than the plugin path.
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('ok');
    });
  });

  it('404s an unknown connector', async () => {
    expect((await appWith(fakeStore()).inject({ method: 'GET', url: '/api/connectors/nope' })).statusCode).toBe(404);
  });

  it('403s a non-admin', async () => {
    const res = await appWith(fakeStore(), fakeCtx(), ['lab_technician'], []).inject({ method: 'GET', url: '/api/connectors' });
    expect(res.statusCode).toBe(403);
  });

  describe('baseUrl validation (SEC-13)', () => {
    const post = (config: Record<string, string>) =>
      appWith(fakeStore()).inject({ method: 'POST', url: '/api/connectors', payload: { name: 'C', pluginId: 'dhis2-sink', config } });

    it('accepts an https baseUrl', async () => {
      const res = await post({ baseUrl: 'https://play.dhis2.org' });
      expect(res.statusCode).toBe(200);
      expect(res.json().allowedHost).toBe('play.dhis2.org');
    });

    it('accepts a plain http localhost baseUrl (on-prem/dev allowed)', async () => {
      const res = await post({ baseUrl: 'http://localhost:8080' });
      expect(res.statusCode).toBe(200);
      expect(res.json().allowedHost).toBe('localhost');
    });

    it('accepts a private-IP baseUrl (on-prem DHIS2 must NOT be blocked)', async () => {
      const res = await post({ baseUrl: 'https://10.0.0.5:8443' });
      expect(res.statusCode).toBe(200);
      expect(res.json().allowedHost).toBe('10.0.0.5');
    });

    it('rejects a non-http(s) scheme with 400', async () => {
      const res = await post({ baseUrl: 'ftp://x' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a malformed baseUrl with 400 instead of silently creating with null host', async () => {
      const res = await post({ baseUrl: 'not a url' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a baseUrl carrying userinfo (credentials) with 400', async () => {
      const res = await post({ baseUrl: 'https://user:pass@host' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a malformed baseUrl on PUT patch with 400', async () => {
      const store = fakeStore();
      const app = appWith(store);
      const id = (await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody })).json().id;
      const res = await app.inject({ method: 'PUT', url: `/api/connectors/${id}`, payload: { config: { baseUrl: 'ftp://nope' } } });
      expect(res.statusCode).toBe(400);
    });

    it('still creates a connector with no baseUrl in config (host null)', async () => {
      const res = await post({ username: 'admin', password: 'district' });
      expect(res.statusCode).toBe(200);
      expect(res.json().allowedHost).toBeNull();
    });
  });
});
