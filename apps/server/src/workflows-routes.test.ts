import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerWorkflowRoutes } from './workflows-routes';

// In-memory fakes for the trigger registries widened onto ctx.workflows (runs/schedules/webhooks/runner).
function fakeWorkflowExtras() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runRecords: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scheduleRows: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webhookEntries = new Map<string, { workflowId: string; secret: string | null }>();
  const norm = (p: string) => p.replace(/^\/+/, '').replace(/\/+$/, '');
  let ingestIds: string[] = [];
  let eventIds: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runAndRecordCalls: any[] = [];
  return {
    runRecords, scheduleRows, webhookEntries, runAndRecordCalls,
    getIngestIds: () => ingestIds,
    getEventIds: () => eventIds,
    runs: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      record: async (r: any) => { runRecords.push(r); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      list: async (id: string) => runRecords.filter((r) => r.workflowId === id),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get: async (runId: string) => runRecords.find((r) => r.id === runId),
    },
    schedules: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upsert: async (s: any) => {
        const i = scheduleRows.findIndex((x) => x.workflowId === s.workflowId && x.nodeId === s.nodeId);
        if (i >= 0) scheduleRows[i] = s; else scheduleRows.push(s);
      },
      removeForWorkflow: async (workflowId: string) => {
        for (let i = scheduleRows.length - 1; i >= 0; i--) if (scheduleRows[i].workflowId === workflowId) scheduleRows.splice(i, 1);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      list: async () => scheduleRows as any[],
      get: async (workflowId: string, nodeId: string) => scheduleRows.find((x) => x.workflowId === workflowId && x.nodeId === nodeId),
      setNextDue: async () => {},
    },
    webhooks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      register: (path: string, entry: any) => { webhookEntries.set(norm(path), entry); },
      resolve: (path: string) => webhookEntries.get(norm(path)),
      clear: (workflowId: string) => { for (const [k, v] of webhookEntries) if (v.workflowId === workflowId) webhookEntries.delete(k); },
      sync: () => {},
      list: () => Array.from(webhookEntries.entries()).map(([path, e]) => ({ path, workflowId: e.workflowId })),
    },
    runner: {
      setIngestWorkflowIds: (ids: string[]) => { ingestIds = ids; },
      setEventWorkflowIds: (ids: string[]) => { eventIds = ids; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runAndRecord: async (workflowId: string, source: string, input: unknown, files?: unknown) => { runAndRecordCalls.push({ workflowId, source, input, files }); },
      registerRunner: async () => {},
      reconcile: async () => {},
    },
    datasets: {
      list: async () => [],
      getByName: async () => undefined,
    },
  };
}

function fakeCtx() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = [];
  const auditEvents: any[] = [];
  const extras = fakeWorkflowExtras();
  return {
    workflows: {
      store: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        list: async () => data as any[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get: async (id: string) => data.find((d) => d.id === id) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: async (w: any) => { data.push(w); return w; },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: async (_id: string, w: any) => w,
        remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
      },
      runs: extras.runs,
      schedules: extras.schedules,
      webhooks: extras.webhooks,
      runner: extras.runner,
      services: undefined,
      datasets: extras.datasets,
    },
    blob: { put: vi.fn().mockResolvedValue(undefined), get: async () => Buffer.from('artifact-bytes') },
    // dhis2-sink mappings for the workflow dhis2-push picker. Empty by default; tests override.
    pluginData: { list: async () => [] },
    plugins: { list: async () => [] as any[] },
    forms: { listPublished: async () => [] as any[] },
    cfg: { WORKFLOW_CODE_TIMEOUT_MS: 5000, WORKFLOW_CODE_MEMORY_MB: 128, WORKFLOW_CODE_ENABLED: true, WORKFLOW_FILE_MAX_BYTES: 52_428_800 },
    audit: { record: async (e: unknown) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    __auditEvents: auditEvents,
    __extras: extras,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const MANAGER_USER = { id: 'u1', username: 'manager', displayName: null, roles: ['lab_manager'] };
const TECHNICIAN_USER = { id: 'u2', username: 'tech', displayName: null, roles: ['lab_technician'] };

const SAMPLE_WORKFLOW = {
  id: 'wf1',
  name: 'Test Workflow',
  description: null,
  definition: { nodes: [], edges: [] },
  enabled: true,
  createdBy: null,
};

// A workflow whose definition embeds secrets (webhook secret + HTTP auth header).
const SECRET_WORKFLOW = {
  id: 'wf-secret',
  name: 'Secret Workflow',
  description: null,
  definition: {
    nodes: [
      { id: 't1', type: 'trigger', data: { triggerType: 'webhook', path: 'hook', secret: 'sup3r-secret' } },
      { id: 'h1', type: 'action', data: { action: 'http-request', headers: { Authorization: 'Bearer tok', 'X-Keep': 'yes' } } },
    ],
    edges: [],
  },
  enabled: true,
  createdBy: null,
};

describe('workflow routes', () => {
  it('POST /api/workflows as lab_manager → 200 and returns the created workflow', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: SAMPLE_WORKFLOW,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('wf1');
    expect(body.name).toBe('Test Workflow');
  });

  it('GET /api/workflows → 200 and array length 1 after create', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    await app.inject({ method: 'POST', url: '/api/workflows', payload: SAMPLE_WORKFLOW });
    const res = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(1);
  });

  it('GET /api/workflows/:id with missing id → 404', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/workflows as lab_technician → 403', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = TECHNICIAN_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: SAMPLE_WORKFLOW,
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/workflows/:id/execute-stream for trigger→log graph → SSE contains node:start and workflow:done', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });

    // Stub ctx with a workflow that has a trigger node → log action node
    const workflowWithGraph = {
      id: 'wf-run',
      name: 'Run Test',
      description: null,
      definition: {
        nodes: [
          { id: 't1', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'l1', type: 'action', data: { action: 'log', message: 'hello' } },
        ],
        edges: [
          { id: 'e1', source: 't1', target: 'l1' },
        ],
      },
      enabled: true,
      createdBy: null,
    };

    const auditEvents: unknown[] = [];
    const extras = fakeWorkflowExtras();
    const ctx = {
      workflows: {
        store: {
          list: async () => [],
          get: async (id: string) => id === 'wf-run' ? workflowWithGraph : undefined,
          create: async (w: unknown) => w,
          update: async (_id: string, w: unknown) => w,
          remove: async () => {},
        },
        runs: extras.runs,
        schedules: extras.schedules,
        webhooks: extras.webhooks,
        runner: extras.runner,
        services: undefined,
        datasets: extras.datasets,
      },
      cfg: { WORKFLOW_CODE_TIMEOUT_MS: 5000, WORKFLOW_CODE_MEMORY_MB: 128, WORKFLOW_CODE_ENABLED: true },
      audit: { record: async (e: unknown) => { auditEvents.push(e); return e; } },
      logger: { error() {}, warn() {}, info() {} },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/wf-run/execute-stream',
      payload: { input: { triggered: true } },
    });

    // The SSE body contains data: frames with JSON events
    expect(res.payload).toContain('"type":"node:start"');
    expect(res.payload).toContain('"type":"workflow:done"');
    // A manual run was recorded.
    expect(extras.runRecords.length).toBe(1);
    expect(extras.runRecords[0].triggerSource).toBe('manual');
    expect(extras.runRecords[0].workflowId).toBe('wf-run');
  });

  it('GET /api/workflows/:id/runs after create → 200 and empty array', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    await app.inject({ method: 'POST', url: '/api/workflows', payload: SAMPLE_WORKFLOW });
    const res = await app.inject({ method: 'GET', url: '/api/workflows/wf1/runs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/workflows/runs/:runId for unknown id → 404', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/runs/nope' });
    expect(res.statusCode).toBe(404);
  });

  // --- dhis2-push mapping picker (sourced from the dhis2-sink plugin datastore) ---

  it('GET /api/workflows/dhis2-mappings as lab_manager → 200 and maps {id,name,connectorId}', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    ctx.pluginData = {
      list: async (pluginId: string, collection: string) => {
        expect(pluginId).toBe('dhis2-sink');
        expect(collection).toBe('mappings');
        return [
          { collection, key: 'm1', doc: { id: 'm1', name: 'AMR', definition: { connectorId: 'c1' } }, updatedAt: new Date(0) },
          { collection, key: 'm2', doc: { definition: {} }, updatedAt: new Date(0) }, // falls back to key, null connector
        ];
      },
    };
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/dhis2-mappings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 'm1', name: 'AMR', connectorId: 'c1' },
      { id: 'm2', name: 'm2', connectorId: null },
    ]);
  });

  it('GET /api/workflows/dhis2-mappings as lab_technician → 403', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = TECHNICIAN_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/dhis2-mappings' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/workflows/dhis2-mappings with no dhis2-sink mappings → 200 and empty array', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/dhis2-mappings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/workflows/datasets → 200 and empty array', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/datasets' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/workflows/datasets/:name for unknown name → 404', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/datasets/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/workflows/hooks/:path with no registered path → 404', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'POST', url: '/api/workflows/hooks/unknown', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/workflows/hooks/:path enforces the secret (401 wrong token, 200 + run on correct)', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    ctx.workflows.webhooks.register('hello', { workflowId: 'wf-hook', secret: 's3cret' });
    registerWorkflowRoutes(app, ctx);

    const wrong = await app.inject({
      method: 'POST', url: '/api/workflows/hooks/hello',
      headers: { 'x-webhook-token': 'nope' }, payload: { name: 'a' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(ctx.__extras.runAndRecordCalls.length).toBe(0);

    const ok = await app.inject({
      method: 'POST', url: '/api/workflows/hooks/hello',
      headers: { 'x-webhook-token': 's3cret' }, payload: { name: 'a' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    expect(ctx.__extras.runAndRecordCalls.length).toBe(1);
    expect(ctx.__extras.runAndRecordCalls[0].workflowId).toBe('wf-hook');
    expect(ctx.__extras.runAndRecordCalls[0].source).toBe('webhook');
  });

  // --- SEC-06: workflow reads are manager-gated + list redacts secrets ---

  it('GET /api/workflows as lab_technician → 403 (SEC-06)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = TECHNICIAN_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/workflows/:id as lab_technician → 403 (SEC-06)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = TECHNICIAN_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/wf-secret' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/workflows as lab_manager → 200 and the LIST redacts node secrets (SEC-06)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    await app.inject({ method: 'POST', url: '/api/workflows', payload: SECRET_WORKFLOW });
    const res = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.length).toBe(1);
    const raw = JSON.stringify(list);
    // The webhook secret must NOT appear anywhere in the list response.
    expect(raw).not.toContain('sup3r-secret');
    // The Authorization header value must be masked, not leaked.
    expect(raw).not.toContain('Bearer tok');
    // The trigger node's `secret` field is stripped entirely.
    const trigger = list[0].definition.nodes.find((n: any) => n.id === 't1');
    expect(trigger.data.secret).toBeUndefined();
    // Non-secret data is preserved.
    expect(trigger.data.path).toBe('hook');
    const http = list[0].definition.nodes.find((n: any) => n.id === 'h1');
    expect(http.data.headers['X-Keep']).toBe('yes');
  });

  it('GET /api/workflows/:id as lab_manager → 200 and detail keeps FULL secrets (SEC-06)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    await app.inject({ method: 'POST', url: '/api/workflows', payload: SECRET_WORKFLOW });
    const res = await app.inject({ method: 'GET', url: '/api/workflows/wf-secret' });
    expect(res.statusCode).toBe(200);
    const w = res.json();
    const trigger = w.definition.nodes.find((n: any) => n.id === 't1');
    // Detail is full — the builder needs the real secret to edit.
    expect(trigger.data.secret).toBe('sup3r-secret');
    const http = w.definition.nodes.find((n: any) => n.id === 'h1');
    expect(http.data.headers.Authorization).toBe('Bearer tok');
  });

  // --- SEC-07: webhook fail-closed, header-only, constant-time, stripped input ---

  it('POST /api/workflows/hooks/:path with no configured secret → 401 (SEC-07 fail-closed)', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    ctx.workflows.webhooks.register('open', { workflowId: 'wf-open', secret: '' });
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'POST', url: '/api/workflows/hooks/open', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(ctx.__extras.runAndRecordCalls.length).toBe(0);
  });

  it('POST /api/workflows/hooks/:path with token only in query string → 401 (SEC-07 header-only)', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    ctx.workflows.webhooks.register('hello', { workflowId: 'wf-hook', secret: 's3cret' });
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'POST', url: '/api/workflows/hooks/hello?token=s3cret', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(ctx.__extras.runAndRecordCalls.length).toBe(0);
  });

  it('POST /api/workflows/hooks/:path strips auth headers from forwarded input (SEC-07)', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    ctx.workflows.webhooks.register('hello', { workflowId: 'wf-hook', secret: 's3cret' });
    registerWorkflowRoutes(app, ctx);

    const ok = await app.inject({
      method: 'POST', url: '/api/workflows/hooks/hello',
      headers: { 'x-webhook-token': 's3cret', authorization: 'Bearer leak', cookie: 'sid=abc' },
      payload: { name: 'a' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ctx.__extras.runAndRecordCalls.length).toBe(1);
    const forwarded = ctx.__extras.runAndRecordCalls[0].input as { headers: Record<string, unknown> };
    expect(forwarded.headers['x-webhook-token']).toBeUndefined();
    expect(forwarded.headers.authorization).toBeUndefined();
    expect(forwarded.headers.cookie).toBeUndefined();
  });

  // --- SEC-08: artifact blob key constrained to the workflow-artifacts/ namespace ---

  it('GET /api/workflows/artifacts/* rejects a key outside the namespace (SEC-08)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    let calledWith: string | undefined;
    const ctx = fakeCtx();
    ctx.blob = { get: async (k: string) => { calledWith = k; return Buffer.from('x'); } };
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/artifacts/plugin-assets/secret.bin' });
    expect([400, 404]).toContain(res.statusCode);
    expect(calledWith).toBeUndefined();
  });

  it('GET /api/workflows/artifacts/* rejects path traversal (SEC-08)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    let calledWith: string | undefined;
    const ctx = fakeCtx();
    ctx.blob = { get: async (k: string) => { calledWith = k; return Buffer.from('x'); } };
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/artifacts/workflow-artifacts/..%2f..%2fsecret' });
    expect([400, 404]).toContain(res.statusCode);
    expect(calledWith).toBeUndefined();
  });

  it('GET /api/workflows/artifacts/* serves a valid namespaced key (SEC-08)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    let calledWith: string | undefined;
    const ctx = fakeCtx();
    ctx.blob = { get: async (k: string) => { calledWith = k; return Buffer.from('artifact-bytes'); } };
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({ method: 'GET', url: '/api/workflows/artifacts/workflow-artifacts/abc/export.csv' });
    expect(res.statusCode).toBe(200);
    expect(calledWith).toBe('workflow-artifacts/abc/export.csv');
  });

  it('GET /api/workflows/nodes returns the host node descriptors', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);
    const res = await app.inject({ method: 'GET', url: '/api/workflows/nodes' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nodes: Array<{ id: string; source: string; kind: string }> };
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.nodes.some((n) => n.id === 'export-artifact' && n.source === 'host')).toBe(true);
  });

  it('GET /api/workflows/nodes merges enabled plugin nodes', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    ctx.plugins.list = async () => [{
      id: 'dhis2-sink', enabled: true,
      manifest: {
        schemaVersion: 1, type: 'plugin', id: 'dhis2-sink', version: '1.0.0',
        compatibility: { ceVersion: '*' },
        capabilities: [{ kind: 'host:connectors' }],
        payload: {
          kind: 'plugin', wasmSha256: 'a'.repeat(64),
          workflowNodes: [
            { id: 'aggregate-push', label: 'Push', kind: 'sink', entrypoint: 'wf_push_aggregate',
              ports: { inputs: [{ name: 'in' }], outputs: [] }, capabilities: ['host:connectors'] },
          ],
        },
      },
    }];
    registerWorkflowRoutes(app, ctx);
    const res = await app.inject({ method: 'GET', url: '/api/workflows/nodes' });
    const body = res.json() as { nodes: Array<{ id: string; source: string; pluginId?: string }> };
    const pluginNode = body.nodes.find((n) => n.id === 'dhis2-sink:aggregate-push');
    expect(pluginNode).toBeDefined();
    expect(pluginNode!.source).toBe('plugin');
    expect(pluginNode!.pluginId).toBe('dhis2-sink');
  });

  it('GET /api/workflows/node-options/:source resolves fhir-resource-types', async () => {
    const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx(); registerWorkflowRoutes(app, ctx, { connectors: { list: async () => [{ id: 'c1', name: 'DHIS2 Demo', pluginId: 'dhis2-sink', type: null }] } });
    const res = await app.inject({ method: 'GET', url: '/api/workflows/node-options/fhir-resource-types' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.arrayContaining([{ value: 'Patient', label: 'Patient' }]));
  });

  it('GET /api/workflows/node-options/connectors maps the connector list', async () => {
    const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx(); registerWorkflowRoutes(app, ctx, { connectors: { list: async () => [{ id: 'c1', name: 'DHIS2 Demo', pluginId: 'dhis2-sink', type: null }] } });
    const res = await app.inject({ method: 'GET', url: '/api/workflows/node-options/connectors' });
    expect(res.json()).toEqual([{ value: 'c1', label: 'DHIS2 Demo' }]);
  });

  it('GET /api/workflows/node-options/connectors?pluginId= filters to the node plugin', async () => {
    const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx, { connectors: { list: async () => [
      { id: 'c1', name: 'DHIS2 Demo', pluginId: 'dhis2-sink', type: null },
      { id: 'c2', name: 'Other Sink', pluginId: 'foo-sink', type: null },
    ] } });
    const all = await app.inject({ method: 'GET', url: '/api/workflows/node-options/connectors' });
    expect(all.json()).toEqual([{ value: 'c1', label: 'DHIS2 Demo' }, { value: 'c2', label: 'Other Sink' }]);
    const scoped = await app.inject({ method: 'GET', url: '/api/workflows/node-options/connectors?pluginId=dhis2-sink' });
    expect(scoped.json()).toEqual([{ value: 'c1', label: 'DHIS2 Demo' }]);
  });

  it('GET /api/workflows/node-options/:source returns [] for unknown source', async () => {
    const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx(); registerWorkflowRoutes(app, ctx, { connectors: { list: async () => [] } });
    const res = await app.inject({ method: 'GET', url: '/api/workflows/node-options/unknown-source' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/workflows/node-options/:source is role-gated (technician 403)', async () => {
    const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = TECHNICIAN_USER; });
    const ctx = fakeCtx(); registerWorkflowRoutes(app, ctx, { connectors: { list: async () => [] } });
    const res = await app.inject({ method: 'GET', url: '/api/workflows/node-options/connectors' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/workflows/node-detail/dhis2-mapping returns {mapping,orgUnitMap} from plugin_data', async () => {
    const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    ctx.pluginData.get = vi.fn().mockResolvedValue({ id: 'm1', definition: { orgUnitColumn: 'facility', columns: [] } });
    ctx.pluginData.list = vi.fn().mockResolvedValue([{ doc: { facilityId: 'fac-1', orgUnitId: 'OU_AAA' } }]);
    registerWorkflowRoutes(app, ctx);
    const res = await app.inject({ method: 'GET', url: '/api/workflows/node-detail/dhis2-mapping?value=m1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mapping: { orgUnitColumn: 'facility', columns: [] }, orgUnitMap: { 'fac-1': 'OU_AAA' } });
  });

  it('GET /api/workflows/node-detail/:source is role-gated (technician 403)', async () => {
    const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = TECHNICIAN_USER; });
    registerWorkflowRoutes(app, fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/workflows/node-detail/dhis2-mapping?value=m1' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/workflows/nodes is role-gated (technician forbidden)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = TECHNICIAN_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);
    const res = await app.inject({ method: 'GET', url: '/api/workflows/nodes' });
    expect(res.statusCode).toBe(403);
  });

  // --- Binary upload route ---

  it('POST /uploads stores an octet-stream body and returns a BinaryRef', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/w1/uploads?filename=a.csv',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('hello'),
    });
    expect(res.statusCode).toBe(200);
    const ref = res.json();
    expect(ref).toMatchObject({ contentType: 'application/octet-stream', fileName: 'a.csv', byteSize: 5 });
    expect(ref.objectKey).toMatch(/^workflow-uploads\//);
    expect(ctx.blob.put).toHaveBeenCalled();
  });

  it('POST /uploads rejects an over-cap body with 413', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    ctx.cfg.WORKFLOW_FILE_MAX_BYTES = 2;
    registerWorkflowRoutes(app, ctx);
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/w1/uploads',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('toolong'),
    });
    expect(res.statusCode).toBe(413);
  });

  it('indexes a workflow with an event trigger on create', async () => {
    const app = Fastify();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        ...SAMPLE_WORKFLOW,
        id: 'wf-evt',
        definition: { nodes: [{ id: 'e', type: 'trigger', data: { triggerType: 'event', config: {} } }], edges: [] },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.__extras.getEventIds()).toContain('wf-evt');
  });
});
