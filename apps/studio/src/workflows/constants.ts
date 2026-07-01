import type { NodeCategory, NodeTemplate, WorkflowNodeData } from './lib/types';

/**
 * Template ids whose handlers exist in SP-1. Everything else renders disabled
 * ("coming soon") in the palette until later slices add the handler.
 */
export const IMPLEMENTED_TEMPLATE_IDS = new Set<string>([
  // triggers
  'manual-trigger',
  'schedule-trigger',
  'webhook-trigger',
  'ingest',
  'event-trigger',
  'postgres-trigger', 'email-trigger',
  // code
  'code',
  // actions
  'set', 'log', 'merge', 'no-op', 'stop-error',
  'sql-query', 'fhir-query', 'http-request',
  'load-dataset',
  // engine control-flow
  'wait', 'execute-workflow', 'loop',
  // conditions
  'if', 'filter', 'switch',
  // data transforms
  'sort', 'limit', 'remove-duplicates', 'rename-keys', 'split-out',
  'aggregate', 'summarize', 'pivot', 'date-time', 'compare-datasets',
  // sinks
  'materialize-dataset', 'export-artifact',
  'form-validate', 'persist-store',
  // codecs (slice B)
  'crypto', 'jwt', 'xml', 'markdown', 'html-extract', 'html',
  // binary/file (slice C)
  'convert-to-file', 'extract-from-file', 'spreadsheet-file', 'excel-template', 'read-pdf', 'compression',
  // databases (slice D)
  'postgres', 'microsoft-sql', 'mysql',
  // databases (slice E)
  'mongodb', 'redis',
  // communication (slice F)
  'send-email', 'gmail', 'outlook', 'ftp',
  // host filesystem (slice J)
  'read-write-file',
]);

/**
 * Node library catalog — inspired by n8n's categorized node palette.
 *
 * Each entry has:
 *  - `type`: the ReactFlow node type ('trigger' | 'action' | 'condition' | 'loop' | 'code' | 'webhook').
 *  - `icon`: the lucide-react icon name used in the sidebar (used as default if defaultData.iconName is unset).
 *  - `defaultData.iconName`: propagated onto the rendered node on the canvas.
 *  - optional `iconUrl`: if you drop brand SVGs/PNGs into `apps/studio/public/node-icons/`,
 *    set this to `/node-icons/<file>` and the sidebar + canvas node will use the real logo.
 *
 * To add a brand logo later: download e.g. `slack.svg` to `apps/studio/public/node-icons/`
 * then set `iconUrl: '/node-icons/slack.svg'` on that template (and mirror it on defaultData).
 */

type NodeType = 'trigger' | 'action' | 'condition' | 'loop' | 'code' | 'webhook';

/**
 * Compact factory — builds a NodeTemplate whose defaultData carries the icon
 * metadata so the canvas node picks up the same visual as the sidebar card.
 */
function node(
  id: string,
  type: NodeType,
  label: string,
  icon: string,
  description: string,
  opts: {
    keywords?: string[];
    iconUrl?: string;
    subtitle?: string;
    /** Extra fields merged on top of the type-default defaultData. */
    data?: Partial<WorkflowNodeData>;
  } = {},
): NodeTemplate {
  const { keywords, iconUrl, subtitle, data: dataOverrides } = opts;

  let defaultData: WorkflowNodeData;
  switch (type) {
    case 'trigger':
      defaultData = {
        label,
        triggerType: 'manual',
        config: {},
        iconName: icon,
        iconUrl,
      };
      break;
    case 'webhook':
      defaultData = {
        label,
        path: '',
        url: '',
        method: 'POST',
        iconName: icon,
        iconUrl,
      };
      break;
    case 'condition':
      defaultData = {
        label,
        condition: '',
        iconName: icon,
        iconUrl,
      };
      break;
    case 'loop':
      defaultData = {
        label,
        iterations: 10,
        iconName: icon,
        iconUrl,
      };
      break;
    case 'code':
      defaultData = {
        label,
        code: '// Write your code here\nreturn {};',
        language: 'javascript',
        iconName: icon,
        iconUrl,
      };
      break;
    case 'action':
    default:
      defaultData = {
        label,
        action: subtitle ?? id,
        config: {},
        iconName: icon,
        iconUrl,
      };
      break;
  }

  if (dataOverrides) {
    defaultData = { ...defaultData, ...dataOverrides } as WorkflowNodeData;
  }

  return {
    id,
    type,
    label,
    description,
    icon,
    iconUrl,
    keywords,
    defaultData,
  };
}

export const nodeCategories: NodeCategory[] = [
  {
    name: 'Core',
    icon: 'Workflow',
    items: [
      node('manual-trigger', 'trigger', 'Manual Trigger', 'Play', 'Start workflow manually'),
      node('schedule-trigger', 'trigger', 'Schedule', 'Clock', 'Run on a cron schedule', {
        keywords: ['cron', 'timer', 'interval'],
        // Field names match the server's `syncWorkflowTriggers` contract:
        // schedule node → data.triggerType:'schedule', data.cron, data.tz.
        data: { triggerType: 'schedule', cron: '', tz: '', config: {} },
      }),
      node('webhook-trigger', 'webhook', 'Webhook', 'Webhook', 'Trigger via HTTP webhook', {
        keywords: ['http', 'incoming', 'listener'],
      }),
      node('ingest', 'trigger', 'On Data Ingest', 'Database', 'Run when a lab data batch is ingested', {
        keywords: ['ingest', 'batch', 'whonet', 'import'],
        // Field names match the server's `syncWorkflowTriggers` contract:
        // ingest node → data.triggerType:'ingest', data.config.sourceFilter.
        data: { triggerType: 'ingest', config: {} },
      }),
      node('event-trigger', 'trigger', 'Event Trigger', 'Radio', 'Run when a domain event fires (e.g. data persisted)', {
        keywords: ['event', 'trigger', 'data.persisted', 'notify'],
        data: { triggerType: 'event', config: { event: 'data.persisted', source: '', resourceType: '' } },
      }),
      node('log', 'action', 'Log', 'Terminal', 'Print a templated message to the console', {
        keywords: ['print', 'console', 'debug'],
        data: { message: '{{ $json }}', level: 'log' },
      }),
      node('http-request', 'action', 'HTTP Request', 'Send', 'Call any REST API', {
        keywords: ['api', 'rest', 'fetch'],
        data: { config: { url: '', method: 'GET', headers: '', body: '', responseType: 'json' } },
      }),
      node('sql-query', 'action', 'SQL Query', 'Database', 'Run a SELECT over the reporting schema', {
        keywords: ['sql', 'query', 'database', 'select'],
        data: { action: 'sql-query', config: { sql: '' } },
      }),
      node('fhir-query', 'action', 'FHIR Query', 'Activity', 'Fetch FHIR resources by type', {
        keywords: ['fhir', 'hl7', 'resource', 'observation'],
        data: { action: 'fhir-query', config: { resourceType: '', limit: 100 } },
      }),
      node('load-dataset', 'action', 'Load Dataset', 'FolderInput', 'Load a previously materialized dataset into this workflow', {
        keywords: ['dataset', 'load', 'read', 'source'],
        data: { action: 'load-dataset', config: { datasetName: '' } },
      }),
      node('if', 'condition', 'If', 'GitBranch', 'Conditional branching'),
      node('switch', 'condition', 'Switch', 'Shuffle', 'Route to one of many branches', {
        data: { rules: [{ name: 'case-0', condition: '' }], fallbackOutput: 'fallback' },
      }),
      node('loop', 'loop', 'Loop Over Items', 'Repeat', 'Iterate over items', {
        data: { loopMode: 'count', iterations: 10, batchSize: 1 },
      }),
      node('code', 'code', 'Code', 'Code', 'Run JavaScript / Python'),
      node('set', 'action', 'Edit Fields', 'Pencil', 'Set / transform field values', {
        keywords: ['set', 'map', 'assign'],
        data: { config: { fields: [], keepExisting: false } },
      }),
      node('merge', 'action', 'Merge', 'Combine', 'Merge data from multiple branches', {
        data: { config: { mode: 'append' } },
      }),
      node('wait', 'action', 'Wait', 'Hourglass', 'Pause the workflow', {
        data: { config: { duration: 1, unit: 's' } },
      }),
      node('stop-error', 'action', 'Stop and Error', 'OctagonX', 'Halt with an error', {
        keywords: ['throw', 'abort'],
        data: { config: { errorMessage: 'Workflow stopped' } },
      }),
      node('filter', 'condition', 'Filter', 'Filter', 'Drop items that fail a test'),
      node('execute-workflow', 'action', 'Execute Workflow', 'PlayCircle', 'Call another workflow', {
        keywords: ['subflow', 'sub-workflow'],
        data: { config: { workflowId: '', waitForCompletion: true } },
      }),
      node('no-op', 'action', 'No Operation', 'CircleDot', 'Passthrough / placeholder'),
      node('materialize-dataset', 'action', 'Materialize Dataset', 'Save', 'Write results to an internal dataset', {
        keywords: ['save', 'dataset', 'store', 'sink'],
        data: { action: 'materialize-dataset', config: { datasetName: '' } },
      }),
      node('form-validate', 'action', 'Form Validate', 'ClipboardCheck', 'Validate items against a form → FHIR resources', {
        keywords: ['form', 'validate', 'fhir', 'ingest'],
        data: { action: 'form-validate', config: {} },
      }),
      node('persist-store', 'action', 'Persist Store', 'Database', 'Persist FHIR resources and emit data.persisted', {
        keywords: ['persist', 'save', 'fhir', 'store', 'sink'],
        data: { action: 'persist-store', config: {} },
      }),
      node('export-artifact', 'action', 'Export File', 'Download', 'Export results as CSV, XLSX, or PDF', {
        keywords: ['csv', 'xlsx', 'pdf', 'download', 'export', 'sink'],
        data: { action: 'export-artifact', config: { format: 'csv', filename: '' } },
      }),
    ],
  },

  {
    name: 'Communication',
    icon: 'MessageSquare',
    items: [
      node('gmail', 'action', 'Gmail', 'Mail', 'Send & read Gmail messages', {
        keywords: ['email', 'google'],
        data: { config: { connectorId: '', to: '', subject: '', body: '', cc: '', html: false } },
      }),
      node('outlook', 'action', 'Microsoft Outlook', 'Mail', 'Send & read Outlook mail', {
        keywords: ['email', 'microsoft'],
        data: { config: { connectorId: '', to: '', subject: '', body: '', cc: '', html: false } },
      }),
      node('send-email', 'action', 'Send Email (SMTP)', 'AtSign', 'Send email over SMTP', {
        data: { config: { connectorId: '', to: '', subject: '', body: '', cc: '', html: false } },
      }),
      node('email-trigger', 'trigger', 'Email Trigger (IMAP)', 'Inbox', 'Trigger on new emails (IMAP poll)', {
        data: { triggerType: 'email', config: { connectorId: '', folder: 'INBOX', pollSeconds: 60, markSeen: true } },
      }),
    ],
  },

  {
    name: 'Developer Tools',
    icon: 'Wrench',
    items: [
      node('ftp', 'action', 'FTP / SFTP', 'FolderUp', 'File transfer', {
        data: { config: { connectorId: '', operation: 'download', remotePath: '', toPath: '', binaryField: 'file' } },
      }),
    ],
  },

  {
    name: 'Databases',
    icon: 'Database',
    items: [
      node('postgres', 'action', 'Postgres', 'Database', 'Run SQL on Postgres', {
        data: { config: { connectorId: '', sql: '' } },
      }),
      node('postgres-trigger', 'trigger', 'Postgres Trigger', 'Database', 'Listen on a NOTIFY channel', {
        data: { triggerType: 'postgres', config: { connectorId: '', channel: '' } },
      }),
      node('mysql', 'action', 'MySQL', 'Database', 'Run SQL on MySQL', {
        data: { config: { connectorId: '', sql: '' } },
      }),
      node('microsoft-sql', 'action', 'Microsoft SQL', 'Database', 'Run queries on MSSQL', {
        data: { config: { connectorId: '', sql: '' } },
      }),
      node('mongodb', 'action', 'MongoDB', 'Database', 'Documents & aggregations', {
        data: { config: { connectorId: '', operation: 'find', collection: '', query: {} } },
      }),
      node('redis', 'action', 'Redis', 'Database', 'Key/value, pub-sub, streams', {
        data: { config: { connectorId: '', operation: 'get', key: '', value: '', ttlSeconds: '' } },
      }),
    ],
  },

  {
    name: 'Files & Storage',
    icon: 'FolderOpen',
    items: [
      node('read-write-file', 'action', 'Read/Write File', 'FileCog', 'Sandboxed host disk file operations', {
        data: { action: 'read-write-file', config: { operation: 'read', path: '', asText: false } },
      }),
      node('read-pdf', 'action', 'Read PDF', 'FileText', 'Extract PDF text', {
        data: { config: { sourceField: 'file', outputField: 'text' } },
      }),
      node('convert-to-file', 'action', 'Convert to File', 'FileOutput', 'Encode data to a file', {
        keywords: ['csv', 'xlsx', 'json'],
        data: { config: { format: 'json', binaryField: 'data', fileName: '', textField: '' } },
      }),
      node('extract-from-file', 'action', 'Extract from File', 'FileInput', 'Parse file contents', {
        data: { config: { format: 'json', sourceField: 'file', outputField: 'data' } },
      }),
      node('spreadsheet-file', 'action', 'Spreadsheet File', 'Sheet', 'Read / write CSV, XLSX', {
        data: { config: { operation: 'read', format: 'xlsx', sourceField: 'file', binaryField: 'data', fileName: '' } },
      }),
      node('excel-template', 'action', 'Excel Template', 'Sheet', 'Fill a branded .xlsx template + autofilter + password', {
        keywords: ['xlsx', 'template', 'report', 'password'],
        data: { action: 'excel-template', config: { templateRef: '', sheetIndex: 0, startCell: 'A2', columns: [], autoFilter: '', fileName: '', binaryField: 'file' } },
      }),
      node('compression', 'action', 'Compression', 'FileArchive', 'Zip / unzip', {
        data: { config: { operation: 'zip', sourceField: 'file', binaryField: 'zip', fileName: '' } },
      }),
      node('crypto', 'action', 'Crypto', 'KeyRound', 'Hash, HMAC', {
        data: { config: { operation: 'hash', algorithm: 'sha256', field: '', secret: '', encoding: 'hex', outputField: 'digest' } },
      }),
    ],
  },

  {
    name: 'Data Transformation',
    icon: 'Shuffle',
    items: [
      node('split-out', 'action', 'Split Out', 'SplitSquareHorizontal', 'Split array into items', {
        data: { config: { field: '' } },
      }),
      node('aggregate', 'action', 'Aggregate', 'Combine', 'Collect items into one', {
        data: { config: { field: '', outputField: '' } },
      }),
      node('summarize', 'action', 'Summarize', 'Sigma', 'Sum, avg, min, max, count', {
        data: { config: { groupBy: '', field: '', operation: 'count' } },
      }),
      node('pivot', 'action', 'Pivot', 'Table2', 'Reshape long rows into wide columns', {
        keywords: ['pivot', 'crosstab', 'wide', 'transpose'],
        data: { action: 'pivot', config: { groupBy: [], pivotColumn: '', valueColumn: '', columns: [], carry: [], aggregate: 'max' } },
      }),
      node('remove-duplicates', 'action', 'Remove Duplicates', 'CopyMinus', 'Drop duplicate items', {
        data: { config: { field: '' } },
      }),
      node('sort', 'action', 'Sort', 'ArrowDownUp', 'Order items by field', {
        data: { config: { field: '', order: 'asc' } },
      }),
      node('limit', 'action', 'Limit', 'Minimize2', 'Keep first N items', {
        data: { config: { maxItems: 50, keep: 'first' } },
      }),
      node('compare-datasets', 'action', 'Compare Datasets', 'GitCompare', 'Diff two item lists', {
        data: { config: { key: '' } },
      }),
      node('rename-keys', 'action', 'Rename Keys', 'TextCursorInput', 'Rename object fields', {
        data: { config: { renames: [] } },
      }),
      node('html', 'action', 'HTML', 'Code2', 'Convert HTML to text', {
        data: { config: { field: 'html', outputField: 'text' } },
      }),
      node('html-extract', 'action', 'HTML Extract', 'CodeXml', 'Parse HTML with CSS selectors', {
        data: { config: { sourceField: 'html', extractions: [] } },
      }),
      node('markdown', 'action', 'Markdown', 'FileText', 'Convert to/from Markdown', {
        data: { config: { operation: 'markdownToHtml', field: 'md', outputField: 'html' } },
      }),
      node('xml', 'action', 'XML', 'FileCode', 'Parse & build XML', {
        data: { config: { operation: 'parse', field: 'xml', outputField: 'data' } },
      }),
      node('date-time', 'action', 'Date & Time', 'Clock4', 'Format, parse, offset dates', {
        data: { config: { operation: 'format', field: '', amount: 0, unit: 'days', outputField: 'date' } },
      }),
      node('jwt', 'action', 'JWT', 'KeyRound', 'Sign / verify JSON Web Tokens', {
        data: { config: { operation: 'sign', secret: '', algorithm: 'HS256', payloadField: '', tokenField: 'token', outputField: 'token' } },
      }),
    ],
  },
];

/** Flat list for search. */
export const allNodeTemplates: NodeTemplate[] = nodeCategories.flatMap((c) => c.items);
