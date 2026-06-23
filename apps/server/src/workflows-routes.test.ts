import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerWorkflowRoutes } from './workflows-routes';

function fakeCtx() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = [];
  const auditEvents: any[] = [];
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
    },
    audit: { record: async (e: unknown) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    __auditEvents: auditEvents,
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
    const ctx = {
      workflows: {
        store: {
          list: async () => [],
          get: async (id: string) => id === 'wf-run' ? workflowWithGraph : undefined,
          create: async (w: unknown) => w,
          update: async (_id: string, w: unknown) => w,
          remove: async () => {},
        },
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
  });
});
