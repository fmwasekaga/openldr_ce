import { describe, it, expect } from 'vitest';
import { buildDefaultWorkflows } from './sample-workflow';

describe('buildDefaultWorkflows', () => {
  const [inbound, reactive] = buildDefaultWorkflows({
    orderFormId: 'form-xyz',
    webhookSecret: 'secret-abc',
  });

  it('returns the inbound + reactive pair with stable ids', () => {
    expect(inbound.id).toBe('wf-sample');
    expect(reactive.id).toBe('wf-sample-reactive');
  });

  it('ships the inbound disabled and the reactive enabled', () => {
    expect(inbound.enabled).toBe(false);
    expect(reactive.enabled).toBe(true);
  });

  it('injects the form id onto the Form Validate node', () => {
    const fv = inbound.definition.nodes.find((n) => n.data.action === 'form-validate');
    expect(fv?.data.config).toMatchObject({ formId: 'form-xyz', sourcePath: 'body' });
  });

  it('injects the secret + path + method onto the webhook node', () => {
    const hook = inbound.definition.nodes.find((n) => n.type === 'webhook');
    expect(hook?.data).toMatchObject({ secret: 'secret-abc', path: 'lab-orders', method: 'POST' });
  });

  it('wires the persist source to match the event-trigger source', () => {
    const persist = inbound.definition.nodes.find((n) => n.data.action === 'persist-store');
    const evt = reactive.definition.nodes.find((n) => n.data.triggerType === 'event');
    expect(persist?.data.config).toMatchObject({ source: 'webhook-lab-orders' });
    expect(evt?.data.config).toMatchObject({ source: 'webhook-lab-orders' });
  });

  it('connects the inbound chain trigger→validate→persist→log', () => {
    const hops = inbound.definition.edges.map((e) => `${e.source}->${e.target}`);
    expect(hops).toEqual([
      'trigger-1->form-validate-1',
      'form-validate-1->persist-1',
      'persist-1->log-1',
    ]);
  });
});
