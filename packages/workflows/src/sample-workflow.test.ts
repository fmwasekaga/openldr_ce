import { describe, it, expect } from 'vitest';
import { buildDefaultWorkflows } from './sample-workflow';

describe('buildDefaultWorkflows', () => {
  const [form, raw, reactive] = buildDefaultWorkflows({
    orderFormId: 'form-xyz',
    formWebhookSecret: 'form-secret',
    rawWebhookSecret: 'raw-secret',
  });

  it('returns Ingest-form + Ingest-raw + reactive with stable ids', () => {
    expect(form.id).toBe('wf-ingest-form');
    expect(raw.id).toBe('wf-ingest-raw');
    expect(reactive.id).toBe('wf-sample-reactive');
    expect(form.name).toBe('Ingest-form');
    expect(raw.name).toBe('Ingest-raw');
  });

  it('ships both ingest webhooks disabled and the reactive enabled', () => {
    expect(form.enabled).toBe(false);
    expect(raw.enabled).toBe(false);
    expect(reactive.enabled).toBe(true);
  });

  it('Ingest-form validates against the injected form; Ingest-raw splits the body', () => {
    const fv = form.definition.nodes.find((n) => n.data.action === 'form-validate');
    expect(fv?.data.config).toMatchObject({ formId: 'form-xyz', sourcePath: 'body' });
    const split = raw.definition.nodes.find((n) => n.data.action === 'split-out');
    expect(split?.data.config).toMatchObject({ field: 'body' });
    // Ingest-raw must NOT form-validate (it persists pre-built FHIR).
    expect(raw.definition.nodes.some((n) => n.data.action === 'form-validate')).toBe(false);
  });

  it('injects each secret + path onto its own webhook node', () => {
    const formHook = form.definition.nodes.find((n) => n.type === 'webhook');
    expect(formHook?.data).toMatchObject({ secret: 'form-secret', path: 'lab-orders', method: 'POST' });
    const rawHook = raw.definition.nodes.find((n) => n.type === 'webhook');
    expect(rawHook?.data).toMatchObject({ secret: 'raw-secret', path: 'cdr-ingest', method: 'POST' });
  });

  it('wires each persist source; the reactive listens to the form source', () => {
    const formPersist = form.definition.nodes.find((n) => n.data.action === 'persist-store');
    const rawPersist = raw.definition.nodes.find((n) => n.data.action === 'persist-store');
    const evt = reactive.definition.nodes.find((n) => n.data.triggerType === 'event');
    expect(formPersist?.data.config).toMatchObject({ source: 'webhook-lab-orders' });
    expect(rawPersist?.data.config).toMatchObject({ source: 'webhook-cdr-ingest' });
    expect(evt?.data.config).toMatchObject({ source: 'webhook-lab-orders' });
  });

  it('connects each ingest chain trigger→(validate|split)→persist→log', () => {
    expect(form.definition.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      'trigger-1->form-validate-1',
      'form-validate-1->persist-1',
      'persist-1->log-1',
    ]);
    expect(raw.definition.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      'trigger-1->split-1',
      'split-1->persist-1',
      'persist-1->log-1',
    ]);
  });
});
