import type { Workflow } from './types';

// The seeded default workflows for a fresh install. Two INGESTION patterns (split by the SHAPE of
// the data the sender posts, NOT by resource type) plus one reactive demo:
//
//   Ingest-form (wf-ingest-form, DISABLED):
//     Webhook (POST /api/workflows/hooks/lab-orders, X-Webhook-Token)
//       → Form Validate ("Lab order" form; sourcePath 'body' unwraps the webhook envelope
//                        {method,body,headers,query} → answers → ServiceRequest/Observation)
//       → Persist Store (source: webhook-lab-orders → emits data.persisted)
//       → Log
//     Use this when the sender posts FORM ANSWERS (a form/UI-driven source), not FHIR.
//
//   Ingest-raw (wf-ingest-raw, DISABLED):
//     Webhook (POST /api/workflows/hooks/cdr-ingest, X-Webhook-Token)
//       → Split Out (field 'body' — unwraps the webhook envelope's body array into one item per
//                   FHIR resource)
//       → Persist Store (source: webhook-cdr-ingest → emits data.persisted)
//       → Log
//     Use this when the sender posts a BARE ARRAY of pre-built FHIR resources (e.g. the CDR
//     toolchain). ONE webhook handles tests AND questionnaires together: Persist stores every
//     resource and the projection routes each by resourceType (Observation → lab_results,
//     ServiceRequest → lab_requests, QuestionnaireResponse → questionnaire_responses, …).
//
//   Reactive (wf-sample-reactive, ENABLED):
//     Event Trigger (data.persisted, source: webhook-lab-orders) → Log
//
// Both ingest webhooks ship DISABLED because each exposes a live HTTP endpoint — the operator opts
// in (enable + copy the per-install secret). The reactive one ships ENABLED because it has no
// external surface.
//
// This is a pure builder: the form id and the two webhook secrets are injected by the seed
// (packages/bootstrap/src/seed.ts) at seed time — the seeded "Lab order" form gets a fresh random
// id, and each secret is generated per-install so no secret is committed.

/** Ingest-form webhook path. */
const FORM_WEBHOOK_PATH = 'lab-orders';
/** Ingest-raw webhook path — matches the CDR toolchain's default OPENLDR_CE_HOOK_PATH so the
 *  toolchain works against a fresh install once the operator copies the secret. */
const RAW_WEBHOOK_PATH = 'cdr-ingest';
/** Ingest-form Persist Store `source` — MUST match the reactive Event Trigger `source`. */
const FORM_PERSIST_SOURCE = 'webhook-lab-orders';
/** Ingest-raw Persist Store `source`. */
const RAW_PERSIST_SOURCE = 'webhook-cdr-ingest';

export interface DefaultWorkflowInput {
  /** Id of the seeded "Lab order" form the Ingest-form loop validates against. */
  orderFormId: string;
  /** Per-install shared secret for the Ingest-form webhook (sent as X-Webhook-Token). */
  formWebhookSecret: string;
  /** Per-install shared secret for the Ingest-raw webhook (sent as X-Webhook-Token). */
  rawWebhookSecret: string;
}

export function buildDefaultWorkflows({ orderFormId, formWebhookSecret, rawWebhookSecret }: DefaultWorkflowInput): Workflow[] {
  const ingestForm: Workflow = {
    id: 'wf-ingest-form',
    name: 'Ingest-form',
    description:
      'Form-driven ingestion. POST form ANSWERS to /api/workflows/hooks/lab-orders with header ' +
      'X-Webhook-Token → validate against the "Lab order" form → persist the extracted FHIR ' +
      '(ServiceRequest/Observation) → emit data.persisted. Use this when the sender posts form ' +
      'answers, not FHIR. Disabled by default: enable it and copy the webhook secret to accept requests.',
    enabled: false,
    createdBy: null,
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'webhook',
          position: { x: 60, y: 220 },
          data: {
            label: 'Form ingest received',
            path: FORM_WEBHOOK_PATH,
            method: 'POST',
            secret: formWebhookSecret,
            templateId: 'webhook-trigger',
            iconName: 'Webhook',
          },
        },
        {
          id: 'form-validate-1',
          type: 'action',
          position: { x: 360, y: 220 },
          data: {
            label: 'Validate form answers',
            action: 'form-validate',
            config: { formId: orderFormId, sourcePath: 'body' },
            templateId: 'form-validate',
            iconName: 'ClipboardCheck',
          },
        },
        {
          id: 'persist-1',
          type: 'action',
          position: { x: 660, y: 220 },
          data: {
            label: 'Persist store',
            action: 'persist-store',
            config: { source: FORM_PERSIST_SOURCE },
            templateId: 'persist-store',
            iconName: 'Database',
          },
        },
        {
          id: 'log-1',
          type: 'action',
          position: { x: 960, y: 220 },
          data: {
            label: 'Log persisted',
            action: 'log',
            message: 'Persisted form ingest: {{ $json }}',
            level: 'info',
            config: {},
            templateId: 'log',
            iconName: 'Terminal',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'form-validate-1' },
        { id: 'e2', source: 'form-validate-1', target: 'persist-1' },
        { id: 'e3', source: 'persist-1', target: 'log-1' },
      ],
    },
  };

  const ingestRaw: Workflow = {
    id: 'wf-ingest-raw',
    name: 'Ingest-raw',
    description:
      'Raw FHIR ingestion. POST a BARE ARRAY of FHIR resources to /api/workflows/hooks/cdr-ingest ' +
      'with header X-Webhook-Token → Split Out unwraps the request body → persist each resource → ' +
      'emit data.persisted. One webhook handles tests AND questionnaires: the projection routes each ' +
      'by type (Observation→lab_results, QuestionnaireResponse→questionnaire_responses, …). Use this ' +
      'when the sender posts pre-built FHIR (e.g. the CDR toolchain). Disabled by default: enable it ' +
      'and copy the webhook secret to accept requests.',
    enabled: false,
    createdBy: null,
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'webhook',
          position: { x: 60, y: 220 },
          data: {
            label: 'Raw FHIR ingest received',
            path: RAW_WEBHOOK_PATH,
            method: 'POST',
            secret: rawWebhookSecret,
            templateId: 'webhook-trigger',
            iconName: 'Webhook',
          },
        },
        {
          id: 'split-1',
          type: 'action',
          position: { x: 360, y: 220 },
          data: {
            label: 'Split body',
            action: 'split-out',
            config: { field: 'body' },
            templateId: 'split-out',
            iconName: 'Split',
          },
        },
        {
          id: 'persist-1',
          type: 'action',
          position: { x: 660, y: 220 },
          data: {
            label: 'Persist store',
            action: 'persist-store',
            config: { source: RAW_PERSIST_SOURCE },
            templateId: 'persist-store',
            iconName: 'Database',
          },
        },
        {
          id: 'log-1',
          type: 'action',
          position: { x: 960, y: 220 },
          data: {
            label: 'Log persisted',
            action: 'log',
            message: 'Persisted raw FHIR: {{ $json }}',
            level: 'info',
            config: {},
            templateId: 'log',
            iconName: 'Terminal',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'split-1' },
        { id: 'e2', source: 'split-1', target: 'persist-1' },
        { id: 'e3', source: 'persist-1', target: 'log-1' },
      ],
    },
  };

  const reactive: Workflow = {
    id: 'wf-sample-reactive',
    name: 'On Lab Order Persisted → Log',
    description:
      'Reacts to the data.persisted event emitted when the Ingest-form loop stores a record (source ' +
      'webhook-lab-orders) and logs a summary. Demonstrates the event-driven half of the ingestion ' +
      'loop — enable "Ingest-form" and POST to see it fire.',
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
            config: { event: 'data.persisted', source: FORM_PERSIST_SOURCE, resourceType: '' },
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

  return [ingestForm, ingestRaw, reactive];
}
