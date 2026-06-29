import type { NodeHandler, RunnerNode } from './types';
import { triggerHandler } from './trigger';
import { logHandler } from './log';
import { setHandler } from './set';
import { mergeHandler } from './merge';
import { ifHandler } from './if';
import { filterHandler } from './filter';
import { codeHandler } from './code';
import { defaultHandler } from './default';
import { sqlHandler } from './sql';
import { fhirHandler } from './fhir';
import { httpHandler } from './http';
import { materializeHandler } from './materialize';
import { exportHandler } from './export';
import { loadDatasetHandler } from './load-dataset';
import { pluginNodeHandler } from './plugin-node';

/** Action subtype → handler. New actions (http-request, code, …) land in later slices. */
const ACTION_HANDLERS: Record<string, NodeHandler> = {
  log: logHandler,
  set: setHandler,
  merge: mergeHandler,
  'sql-query': sqlHandler,
  'fhir-query': fhirHandler,
  'http-request': httpHandler,
  'no-op': defaultHandler,
  'materialize-dataset': materializeHandler,
  'export-artifact': exportHandler,
  'load-dataset': loadDatasetHandler,
};

const TYPE_HANDLERS: Record<string, NodeHandler> = {
  trigger: triggerHandler,
  code: codeHandler,
  'plugin-node': pluginNodeHandler,
};

export function pickHandler(node: RunnerNode): NodeHandler {
  if (node.type === 'action') {
    const subtype = (node.data.action as string | undefined) ?? '';
    return ACTION_HANDLERS[subtype] ?? defaultHandler;
  }
  if (node.type === 'condition') {
    const templateId = (node.data.templateId as string | undefined) ?? '';
    if (templateId === 'filter') return filterHandler;
    return ifHandler;
  }
  return TYPE_HANDLERS[node.type] ?? defaultHandler;
}

export type { NodeHandler, RunnerNode };
