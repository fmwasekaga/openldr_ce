import { describe, it, expect } from 'vitest';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runAndRecordCalls: any[] = [];
  return {
    runRecords, scheduleRows, webhookEntries, runAndRecordCalls,
    getIngestIds: () => ingestIds,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runAndRecord: async (workflowId: string, source: string, input: unknown) => { runAndRecordCalls.push({ workflowId, source, input }); },
      registerRunner: async () => {},
      reconcile: async () => {},
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
    },
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
      },
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
});
