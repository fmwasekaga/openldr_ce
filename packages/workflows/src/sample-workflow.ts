import type { Workflow } from './types';

// The seeded default workflows for a fresh install. Replaces the old node-showcase
// "Sample Workflow" with a real, honest form-validated ingestion loop built entirely
// from nodes that exist today, plus a reactive companion that demonstrates the
// data.persisted event loop.
//
//   Inbound  (wf-sample, DISABLED):
//     Webhook (POST /api/workflows/hooks/lab-orders, X-Webhook-Token)
//       → Code "Unwrap request body"  (webhook delivers {method,body,headers,query};
//                                       Form Validate wants the answers themselves)
//       → Form Validate (Lab order form → ServiceRequest)
//       → Persist Store (source: webhook-lab-orders → emits data.persisted)
//       → Log
//
//   Reactive (wf-sample-reactive, ENABLED):
//     Event Trigger (data.persisted, source: webhook-lab-orders) → Log
//
// The inbound ships DISABLED because it exposes a live HTTP endpoint — the operator
// opts in (enable + copy the secret). The reactive one ships ENABLED because it has no
// external surface; enabling both is a one-click demo of the whole loop.
//
// This is a pure builder: the form id and webhook secret are injected by the seed
// (packages/bootstrap/src/seed.ts) at seed time — the seeded "Lab order" form gets a
// fresh random id, and the secret is generated per-install so no secret is committed.

const WEBHOOK_PATH = 'lab-orders';
/** Persist Store `source` and the reactive Event Trigger `source` MUST match for the loop to fire. */
const PERSIST_SOURCE = 'webhook-lab-orders';

export interface DefaultWorkflowInput {
  /** Id of the seeded "Lab order" form the inbound loop validates against. */
  orderFormId: string;
  /** Per-install shared secret for the inbound webhook (sent as X-Webhook-Token). */
  webhookSecret: string;
}

export function buildDefaultWorkflows({ orderFormId, webhookSecret }: DefaultWorkflowInput): Workflow[] {
  const inbound: Workflow = {
    id: 'wf-sample',
    name: 'Ingest Lab Orders (Webhook)',
    description:
      'POST a lab order to /api/workflows/hooks/lab-orders with header X-Webhook-Token → validate ' +
      'against the "Lab order" form → persist a ServiceRequest → emit data.persisted. Disabled by ' +
      'default: enable it and copy the webhook secret to accept requests. A manual Run with no body ' +
      'validates to zero rows (no-op).',
    enabled: false,
    createdBy: null,
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'webhook',
          position: { x: 60, y: 220 },
          data: {
            label: 'Lab order received',
            path: WEBHOOK_PATH,
            method: 'POST',
            secret: webhookSecret,
            templateId: 'webhook-trigger',
            iconName: 'Webhook',
          },
        },
        {
          id: 'unwrap-1',
          type: 'code',
          position: { x: 300, y: 220 },
          data: {
            label: 'Unwrap request body',
            code: 'return $json.body ?? $json;',
            language: 'javascript',
            templateId: 'code',
            iconName: 'Code',
          },
        },
        {
          id: 'form-validate-1',
          type: 'action',
          position: { x: 540, y: 220 },
          data: {
            label: 'Validate lab order',
            action: 'form-validate',
            config: { formId: orderFormId },
            templateId: 'form-validate',
            iconName: 'ClipboardCheck',
          },
        },
        {
          id: 'persist-1',
          type: 'action',
          position: { x: 780, y: 220 },
          data: {
            label: 'Persist store',
            action: 'persist-store',
            config: { source: PERSIST_SOURCE },
            templateId: 'persist-store',
            iconName: 'Database',
          },
        },
        {
          id: 'log-1',
          type: 'action',
          position: { x: 1020, y: 220 },
          data: {
            label: 'Log persisted',
            action: 'log',
            message: 'Persisted lab order: {{ $json }}',
            level: 'info',
            config: {},
            templateId: 'log',
            iconName: 'Terminal',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'unwrap-1' },
        { id: 'e2', source: 'unwrap-1', target: 'form-validate-1' },
        { id: 'e3', source: 'form-validate-1', target: 'persist-1' },
        { id: 'e4', source: 'persist-1', target: 'log-1' },
      ],
    },
  };

  const reactive: Workflow = {
    id: 'wf-sample-reactive',
    name: 'On Lab Order Persisted → Log',
    description:
      'Reacts to the data.persisted event emitted when a lab order is stored (source ' +
      'webhook-lab-orders) and logs a summary. Demonstrates the event-driven half of the ' +
      'ingestion loop — enable "Ingest Lab Orders (Webhook)" and POST an order to see it fire.',
    enabled: true,
    createdBy: null,
    definition: {
      nodes: [
        {
          id: 'evt-1',
          type: 'trigger',
          position: { x: 60, y: 220 },
          data: {
            label: 'On data persisted',
            triggerType: 'event',
            config: { event: 'data.persisted', source: PERSIST_SOURCE, resourceType: '' },
            templateId: 'event-trigger',
            iconName: 'Radio',
          },
        },
        {
          id: 'log-1',
          type: 'action',
          position: { x: 300, y: 220 },
          data: {
            label: 'Log reaction',
            action: 'log',
            message: 'Reacted to {{ $json.count }} {{ $json.resourceTypes }} from {{ $json.source }}',
            level: 'info',
            config: {},
            templateId: 'log',
            iconName: 'Terminal',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'evt-1', target: 'log-1' }],
    },
  };

  return [inbound, reactive];
}
