import type { APIRequestContext } from '@playwright/test';

export interface DocsFixtureResult {
  formId: string;
}

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>, label: string): Promise<T> {
  if (!response.ok()) throw new Error(`${label} -> ${response.status()}`);
  return response.json() as Promise<T>;
}

async function post<T>(api: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await api.post(url, { data });
  return json<T>(response, `POST ${url}`);
}

async function put<T>(api: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await api.put(url, { data });
  return json<T>(response, `PUT ${url}`);
}

const workflowPayload = {
  id: 'docs-training-workflow',
  name: 'Training workflow',
  description: 'Documentation fixture workflow',
  enabled: true,
  definition: {
    nodes: [
      {
        id: 'docs-trigger',
        type: 'trigger',
        position: { x: 0, y: 80 },
        data: { label: 'Manual trigger', triggerType: 'manual', config: {} },
      },
      {
        id: 'docs-set',
        type: 'action',
        position: { x: 320, y: 80 },
        data: {
          label: 'Set specimen result',
          action: 'set',
          config: { specimen: 'Blood', organism: 'E. coli', result: 'Resistant' },
        },
      },
      {
        id: 'docs-materialize',
        type: 'action',
        position: { x: 640, y: 80 },
        data: {
          label: 'Materialize dataset',
          action: 'materialize',
          config: { datasetName: 'docs-training-results' },
        },
      },
    ],
    edges: [
      { id: 'docs-trigger-docs-set', source: 'docs-trigger', target: 'docs-set' },
      { id: 'docs-set-docs-materialize', source: 'docs-set', target: 'docs-materialize' },
    ],
  },
};

const formSchema = {
  id: 'training-intake',
  name: 'Training intake',
  fields: [
    {
      id: 'patientIdentifier',
      fhirPath: null,
      displayLabel: 'Patient identifier',
      description: 'Training patient identifier for documentation screenshots',
      fieldType: 'text',
      required: true,
      enabled: true,
      order: 0,
      cardinality: { min: 1, max: '1' },
      section: 'main',
    },
    {
      id: 'specimenDate',
      fhirPath: null,
      displayLabel: 'Specimen date',
      description: null,
      fieldType: 'date',
      required: true,
      enabled: true,
      order: 1,
      cardinality: { min: 1, max: '1' },
      section: 'main',
    },
    {
      id: 'specimenType',
      fhirPath: null,
      displayLabel: 'Specimen type',
      description: null,
      fieldType: 'select',
      required: false,
      enabled: true,
      order: 2,
      cardinality: { min: 0, max: '1' },
      section: 'main',
      valueSetOptions: [
        { code: 'blood', display: 'Blood' },
        { code: 'urine', display: 'Urine' },
        { code: 'sputum', display: 'Sputum' },
      ],
    },
    {
      id: 'notes',
      fhirPath: null,
      displayLabel: 'Notes',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 3,
      cardinality: { min: 0, max: '1' },
      section: 'main',
    },
  ],
  sections: [{ id: 'main', label: 'Main', order: 0 }],
  targetPages: ['forms'],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

async function ensureWorkflow(api: APIRequestContext): Promise<void> {
  const workflows = await json<Array<{ id: string }>>(await api.get('/api/workflows'), 'GET /api/workflows');
  const existing = workflows.find((workflow) => workflow.id === workflowPayload.id);
  if (existing) await put(api, `/api/workflows/${workflowPayload.id}`, workflowPayload);
  else await post(api, '/api/workflows', workflowPayload);
}

async function ensureForm(api: APIRequestContext): Promise<string> {
  const forms = await json<Array<{ id: string; name: string }>>(await api.get('/api/forms'), 'GET /api/forms');
  const payload = {
    name: 'Training intake',
    versionLabel: 'docs',
    schema: formSchema,
    targetPages: ['forms'],
  };
  const existing = forms.find((form) => form.name === 'Training intake');
  const form = existing
    ? await put<{ id: string }>(api, `/api/forms/${existing.id}`, payload)
    : await post<{ id: string }>(api, '/api/forms', payload);
  await post(api, `/api/forms/${form.id}/status`, { status: 'published' });
  return form.id;
}

async function ensureUser(api: APIRequestContext): Promise<void> {
  const users = await json<Array<{ id: string; username: string }>>(await api.get('/api/users'), 'GET /api/users');
  const payload = {
    username: 'docs.user',
    email: 'docs.user@example.org',
    firstName: 'Docs',
    lastName: 'User',
    displayName: 'Docs User',
    roles: ['lab_technician'],
    enabled: true,
  };
  const existing = users.find((user) => user.username === payload.username);
  if (existing) await put(api, `/api/users/${existing.id}`, payload);
  else await post(api, '/api/users', payload);
}

async function ensureConnector(api: APIRequestContext): Promise<void> {
  const connectors = await json<Array<{ id: string; name: string }>>(await api.get('/api/connectors'), 'GET /api/connectors');
  const payload = {
    name: 'Training destination',
    pluginId: 'test-sink',
    config: { mode: 'training' },
    enabled: true,
  };
  const existing = connectors.find((connector) => connector.name === payload.name);
  if (existing) await put(api, `/api/connectors/${existing.id}`, payload);
  else await post(api, '/api/connectors', payload);
}

async function ensureMarketplaceRegistry(api: APIRequestContext): Promise<void> {
  const registries = await json<Array<{ id: string; name: string; enabled?: boolean }>>(
    await api.get('/api/marketplace/registries'),
    'GET /api/marketplace/registries',
  );
  const payload = {
    name: 'Documentation samples',
    kind: 'local',
    location: '.docs-marketplace/bundles',
    enabled: true,
  };
  const existing = registries.find((registry) => registry.name === payload.name);
  if (existing) await put(api, `/api/marketplace/registries/${existing.id}`, payload);
  else await post(api, '/api/marketplace/registries', payload);
  for (const registry of registries) {
    if (registry.name !== payload.name && registry.enabled !== false) {
      await put(api, `/api/marketplace/registries/${registry.id}`, { enabled: false });
    }
  }
  await api.post('/api/marketplace/refresh');
}

export async function ensureDocsFixtures(api: APIRequestContext): Promise<DocsFixtureResult> {
  await ensureWorkflow(api);
  const formId = await ensureForm(api);
  await ensureUser(api);
  await ensureConnector(api);
  await ensureMarketplaceRegistry(api);
  return { formId };
}
