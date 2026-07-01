import type { ComponentType } from 'react';
import type { WorkflowNode, WorkflowNodeData } from '../../lib/types';
import { DefaultForm } from './default-form';
import { CodeForm } from './code-form';
import { LogForm } from './log-form';
import { WebhookForm } from './webhook-form';
import { ScheduleForm } from './schedule-form';
import { IngestForm } from './ingest-form';
import { EventTriggerForm } from './event-trigger-form';
import { PostgresTriggerForm } from './postgres-trigger-form';
import { EmailTriggerForm } from './email-trigger-form';
import { HttpRequestForm } from './http-request-form';
import { SqlForm } from './sql-form';
import { FhirForm } from './fhir-form';
import { SetForm } from './set-form';
import { MergeForm } from './merge-form';
import { WaitForm } from './wait-form';
import { StopErrorForm } from './stop-error-form';
import { FilterForm } from './filter-form';
import { SwitchForm } from './switch-form';
import { LoopForm } from './loop-form';
import { ExecuteWorkflowForm } from './execute-workflow-form';
import { MaterializeForm } from './materialize-form';
import { ExportForm } from './export-form';
import { LoadDatasetForm } from './load-dataset-form';
import { DeclarativeNodeForm } from './plugin-node-form';
import { ReadWriteFileForm } from './read-write-file-form';
import { ExcelTemplateForm } from './excel-template-form';

export interface NodeFormProps {
  node: WorkflowNode;
  update: (patch: Partial<WorkflowNodeData>) => void;
}

/**
 * Registry keyed by the **template id** (the `id` field on a `NodeTemplate`
 * in constants.ts). Falls back to `DefaultForm` for anything unregistered.
 *
 * To identify the template id of a node on the canvas, we stash it on the
 * node's data via `templateId` at drop time (see sidebar.tsx). For legacy
 * nodes that don't have one yet, we try to match on obvious data shape.
 */
const FORMS: Record<string, ComponentType<NodeFormProps>> = {
  code: CodeForm,
  log: LogForm,
  'webhook-trigger': WebhookForm,
  'schedule-trigger': ScheduleForm,
  ingest: IngestForm,
  'event-trigger': EventTriggerForm,
  'postgres-trigger': PostgresTriggerForm,
  'email-trigger': EmailTriggerForm,
  'http-request': HttpRequestForm,
  'sql-query': SqlForm,
  'fhir-query': FhirForm,
  set: SetForm,
  merge: MergeForm,
  wait: WaitForm,
  'stop-error': StopErrorForm,
  filter: FilterForm,
  switch: SwitchForm,
  loop: LoopForm,
  'execute-workflow': ExecuteWorkflowForm,
  'materialize-dataset': MaterializeForm,
  'export-artifact': ExportForm,
  'load-dataset': LoadDatasetForm,
  'plugin-node': DeclarativeNodeForm,
  'form-validate': DeclarativeNodeForm,
  'persist-store': DeclarativeNodeForm,
  'read-write-file': ReadWriteFileForm,
  'excel-template': ExcelTemplateForm,
};

export function pickForm(node: WorkflowNode): ComponentType<NodeFormProps> {
  const data = node.data as Record<string, unknown>;

  const templateId = (data.templateId as string | undefined) ?? '';
  if (templateId && FORMS[templateId]) return FORMS[templateId];

  // Heuristic fallbacks so existing saved workflows / the sample workflow
  // still get the right form even without a templateId stamp.
  if (node.type === 'code') return CodeForm;
  if (node.type === 'webhook') return WebhookForm;
  if (node.type === 'loop') return LoopForm;
  if (node.type === 'action' && data.action === 'log') return LogForm;
  if (node.type === 'plugin-node') return DeclarativeNodeForm;

  // Any unregistered host action node renders its descriptor config[] declaratively
  // (and degrades to label-only if it has none).
  if (node.type === 'action') return DeclarativeNodeForm;

  return DefaultForm;
}
