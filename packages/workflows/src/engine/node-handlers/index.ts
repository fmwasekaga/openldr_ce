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
import { formValidateHandler } from './form-validate';
import { persistStoreHandler } from './persist-store';
import { stopErrorHandler } from './stop-error';
import { switchHandler } from './switch';
import { sortHandler } from './sort';
import { limitHandler } from './limit';
import { removeDuplicatesHandler } from './remove-duplicates';
import { renameKeysHandler } from './rename-keys';
import { splitOutHandler } from './split-out';
import { aggregateHandler } from './aggregate';
import { summarizeHandler } from './summarize';
import { dateTimeHandler } from './date-time';
import { compareDatasetsHandler } from './compare-datasets';
import { cryptoHandler } from './crypto';
import { jwtHandler } from './jwt';
import { xmlHandler } from './xml';
import { markdownHandler } from './markdown';
import { htmlExtractHandler } from './html-extract';
import { htmlHandler } from './html';
import { convertToFileHandler } from './convert-to-file';
import { extractFromFileHandler } from './extract-from-file';
import { spreadsheetFileHandler } from './spreadsheet-file';
import { readPdfHandler } from './read-pdf';
import { compressionHandler } from './compression';
import { connectorSqlHandler } from './connector-sql';
import { mongoHandler } from './mongo';
import { redisHandler } from './redis';
import { emailHandler } from './email';
import { ftpHandler } from './ftp';
import { waitHandler } from './wait';
import { executeWorkflowHandler } from './execute-workflow';
import { readWriteFileHandler } from './read-write-file';
import { excelTemplateHandler } from './excel-template';
import { pivotHandler } from './pivot';

/** Action subtype → handler. New actions (http-request, code, …) land in later slices. */
const ACTION_HANDLERS: Record<string, NodeHandler> = {
  log: logHandler,
  set: setHandler,
  merge: mergeHandler,
  'sql-query': sqlHandler,
  'fhir-query': fhirHandler,
  'http-request': httpHandler,
  'no-op': defaultHandler,
  'stop-error': stopErrorHandler,
  'wait': waitHandler,
  'execute-workflow': executeWorkflowHandler,
  'materialize-dataset': materializeHandler,
  'export-artifact': exportHandler,
  'load-dataset': loadDatasetHandler,
  'form-validate': formValidateHandler,
  'persist-store': persistStoreHandler,
  'sort': sortHandler,
  'limit': limitHandler,
  'remove-duplicates': removeDuplicatesHandler,
  'rename-keys': renameKeysHandler,
  'split-out': splitOutHandler,
  'aggregate': aggregateHandler,
  'summarize': summarizeHandler,
  'date-time': dateTimeHandler,
  'compare-datasets': compareDatasetsHandler,
  'crypto': cryptoHandler,
  'jwt': jwtHandler,
  'xml': xmlHandler,
  'markdown': markdownHandler,
  'html-extract': htmlExtractHandler,
  'html': htmlHandler,
  'convert-to-file': convertToFileHandler,
  'extract-from-file': extractFromFileHandler,
  'spreadsheet-file': spreadsheetFileHandler,
  'read-pdf': readPdfHandler,
  'compression': compressionHandler,
  'postgres': connectorSqlHandler,
  'microsoft-sql': connectorSqlHandler,
  'mysql': connectorSqlHandler,
  'mongodb': mongoHandler,
  'redis': redisHandler,
  'send-email': emailHandler,
  'gmail': emailHandler,
  'outlook': emailHandler,
  'ftp': ftpHandler,
  'read-write-file': readWriteFileHandler,
  'excel-template': excelTemplateHandler,
  'pivot': pivotHandler,
};

const TYPE_HANDLERS: Record<string, NodeHandler> = {
  trigger: triggerHandler,
  // A webhook node is a trigger entry point: the studio builder + webhook registry model it as
  // its own ReactFlow type ('webhook'), but at execution time it must behave exactly like a
  // trigger — emit the seeded ctx.input (the webhook request envelope) as the run's first items.
  // Without this the payload never enters the graph (defaultHandler would pass through []).
  webhook: triggerHandler,
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
    if (templateId === 'switch') return switchHandler;
    return ifHandler;
  }
  return TYPE_HANDLERS[node.type] ?? defaultHandler;
}

export type { NodeHandler, RunnerNode };
