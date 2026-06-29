import type { Workflow } from './types';

// Example workflow showcasing the core node library — seeded so the Workflows list isn't
// empty on a fresh install (the builder used to render this from hardcoded state before the
// list page existed). Mirrors apps/web/src/workflows/lib/sample-workflow.ts; the server stores
// `definition` as opaque JSON, so the node `data` shapes (templateId/iconName/config) are
// preserved as-is. Edges omit the web-only `type:'custom'` (the persisted schema drops it).
//
// Flow: Manual trigger → Set fields → HTTP request → If(premium?)
//   ├ true  → Log → Wait → Code ─┐
//   └ false → Loop ──────────────┴→ Merge → Filter → No-Op
export const sampleWorkflow: Workflow = {
  id: 'wf-sample',
  name: 'Sample Workflow',
  description: 'Example workflow showcasing the core node library (trigger, set, HTTP, if, log, wait, code, loop, merge, filter).',
  enabled: true,
  createdBy: null,
  definition: {
    nodes: [
      { id: 'trigger-1', type: 'trigger', position: { x: 60, y: 260 }, data: { label: 'When clicked', triggerType: 'manual', config: {}, templateId: 'manual-trigger', iconName: 'Play' } },
      { id: 'set-1', type: 'action', position: { x: 220, y: 260 }, data: { label: 'Set user data', action: 'set', config: { keepExisting: false, fields: [{ name: 'userId', value: '42' }, { name: 'role', value: 'admin' }, { name: 'plan', value: 'premium' }] }, templateId: 'set', iconName: 'Pencil' } },
      { id: 'http-1', type: 'action', position: { x: 380, y: 260 }, data: { label: 'Fetch profile', action: 'http-request', config: { url: 'https://jsonplaceholder.typicode.com/users/1', method: 'GET', headers: '', body: '', responseType: 'json' }, templateId: 'http-request', iconName: 'Send' } },
      { id: 'if-1', type: 'condition', position: { x: 540, y: 260 }, data: { label: 'Is premium?', condition: '$json.data && $json.data.id > 0', templateId: 'if', iconName: 'GitBranch' } },
      { id: 'log-1', type: 'action', position: { x: 720, y: 140 }, data: { label: 'Log premium', action: 'log', message: 'Premium user: {{ $json.data.name }}', level: 'info', config: {}, templateId: 'log', iconName: 'Terminal' } },
      { id: 'wait-1', type: 'action', position: { x: 880, y: 140 }, data: { label: 'Wait 1s', action: 'wait', config: { duration: 1, unit: 's' }, templateId: 'wait', iconName: 'Hourglass' } },
      { id: 'code-1', type: 'code', position: { x: 1040, y: 140 }, data: { label: 'Build report', code: 'console.log("Building report for", $json);\nreturn { report: "done", ts: Date.now() };', language: 'javascript', templateId: 'code', iconName: 'Code' } },
      { id: 'loop-1', type: 'loop', position: { x: 720, y: 400 }, data: { label: 'Retry 3x', iterations: 3, loopMode: 'count', templateId: 'loop', iconName: 'Repeat' } },
      { id: 'merge-1', type: 'action', position: { x: 1220, y: 260 }, data: { label: 'Merge results', action: 'merge', config: { mode: 'append' }, templateId: 'merge', iconName: 'Combine' } },
      { id: 'filter-1', type: 'condition', position: { x: 1400, y: 260 }, data: { label: 'Has data?', condition: '$items && $items.length > 0', templateId: 'filter', iconName: 'Filter' } },
      { id: 'noop-1', type: 'action', position: { x: 1580, y: 260 }, data: { label: 'Done', action: 'no-op', config: {}, templateId: 'no-op', iconName: 'CircleDot' } },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'set-1' },
      { id: 'e2', source: 'set-1', target: 'http-1' },
      { id: 'e3', source: 'http-1', target: 'if-1' },
      { id: 'e4', source: 'if-1', sourceHandle: 'true', target: 'log-1' },
      { id: 'e5', source: 'log-1', target: 'wait-1' },
      { id: 'e6', source: 'wait-1', target: 'code-1' },
      { id: 'e7', source: 'code-1', target: 'merge-1' },
      { id: 'e8', source: 'if-1', sourceHandle: 'false', target: 'loop-1' },
      { id: 'e9', source: 'loop-1', target: 'merge-1' },
      { id: 'e10', source: 'merge-1', target: 'filter-1' },
      { id: 'e11', source: 'filter-1', sourceHandle: 'true', target: 'noop-1' },
    ],
  },
};
