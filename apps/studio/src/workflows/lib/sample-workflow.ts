import type { WorkflowNode, WorkflowEdge } from './types';

/**
 * Sample workflow showcasing the Core node library. The flow:
 *
 *   Manual Trigger
 *       │
 *   Edit Fields (set user data)
 *       │
 *   HTTP Request (fetch user profile)
 *       │
 *   If (is premium?)
 *      ├─ true ──► Log ("Premium user") ──► Wait (1s) ──► Code (build report)
 *      │                                                       │
 *      │                                                   Merge ◄──┐
 *      │                                                     │      │
 *      │                                                   Filter   │
 *      │                                                     │      │
 *      │                                                   No-Op    │
 *      │                                                            │
 *      └─ false ─► Loop (3 retries) ────────────────────────────────┘
 */

export const sampleNodes: WorkflowNode[] = [
  // ── Trigger ────────────────────────────────────────────────
  {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 60, y: 260 },
    data: {
      label: 'When clicked',
      triggerType: 'manual',
      config: {},
      templateId: 'manual-trigger',
      iconName: 'Play',
    },
  },

  // ── Edit Fields ────────────────────────────────────────────
  {
    id: 'set-1',
    type: 'action',
    position: { x: 220, y: 260 },
    data: {
      label: 'Set user data',
      action: 'set',
      config: {
        keepExisting: false,
        fields: [
          { name: 'userId', value: '42' },
          { name: 'role', value: 'admin' },
          { name: 'plan', value: 'premium' },
        ],
      },
      templateId: 'set',
      iconName: 'Pencil',
    },
  },

  // ── HTTP Request ───────────────────────────────────────────
  {
    id: 'http-1',
    type: 'action',
    position: { x: 380, y: 260 },
    data: {
      label: 'Fetch profile',
      action: 'http-request',
      config: {
        url: 'https://jsonplaceholder.typicode.com/users/1',
        method: 'GET',
        headers: '',
        body: '',
        responseType: 'json',
      },
      templateId: 'http-request',
      iconName: 'Send',
    },
  },

  // ── If (condition) ─────────────────────────────────────────
  {
    id: 'if-1',
    type: 'condition',
    position: { x: 540, y: 260 },
    data: {
      label: 'Is premium?',
      condition: '$json.data && $json.data.id > 0',
      templateId: 'if',
      iconName: 'GitBranch',
    },
  },

  // ── True branch ────────────────────────────────────────────

  // Log
  {
    id: 'log-1',
    type: 'action',
    position: { x: 720, y: 140 },
    data: {
      label: 'Log premium',
      action: 'log',
      message: 'Premium user: {{ $json.data.name }}',
      level: 'info',
      config: {},
      templateId: 'log',
      iconName: 'Terminal',
    },
  },

  // Wait
  {
    id: 'wait-1',
    type: 'action',
    position: { x: 880, y: 140 },
    data: {
      label: 'Wait 1s',
      action: 'wait',
      config: { duration: 1, unit: 's' },
      templateId: 'wait',
      iconName: 'Hourglass',
    },
  },

  // Code
  {
    id: 'code-1',
    type: 'code',
    position: { x: 1040, y: 140 },
    data: {
      label: 'Build report',
      code: 'console.log("Building report for", $json);\nreturn { report: "done", ts: Date.now() };',
      language: 'javascript',
      templateId: 'code',
      iconName: 'Code',
    },
  },

  // ── False branch ───────────────────────────────────────────

  // Loop
  {
    id: 'loop-1',
    type: 'loop',
    position: { x: 720, y: 400 },
    data: {
      label: 'Retry 3x',
      iterations: 3,
      loopMode: 'count',
      templateId: 'loop',
      iconName: 'Repeat',
    },
  },

  // ── Merge (both branches converge) ─────────────────────────
  {
    id: 'merge-1',
    type: 'action',
    position: { x: 1220, y: 260 },
    data: {
      label: 'Merge results',
      action: 'merge',
      config: { mode: 'append' },
      templateId: 'merge',
      iconName: 'Combine',
    },
  },

  // ── Filter ─────────────────────────────────────────────────
  {
    id: 'filter-1',
    type: 'condition',
    position: { x: 1400, y: 260 },
    data: {
      label: 'Has data?',
      condition: '$items && $items.length > 0',
      templateId: 'filter',
      iconName: 'Filter',
    },
  },

  // ── No-Op (end) ────────────────────────────────────────────
  {
    id: 'noop-1',
    type: 'action',
    position: { x: 1580, y: 260 },
    data: {
      label: 'Done',
      action: 'no-op',
      config: {},
      templateId: 'no-op',
      iconName: 'CircleDot',
    },
  },
];

export const sampleEdges: WorkflowEdge[] = [
  // Trigger → Set
  { id: 'e1', source: 'trigger-1', target: 'set-1', type: 'custom' },
  // Set → HTTP Request
  { id: 'e2', source: 'set-1', target: 'http-1', type: 'custom' },
  // HTTP Request → If
  { id: 'e3', source: 'http-1', target: 'if-1', type: 'custom' },

  // If true → Log
  { id: 'e4', source: 'if-1', sourceHandle: 'true', target: 'log-1', type: 'custom' },
  // Log → Wait
  { id: 'e5', source: 'log-1', target: 'wait-1', type: 'custom' },
  // Wait → Code
  { id: 'e6', source: 'wait-1', target: 'code-1', type: 'custom' },
  // Code → Merge
  { id: 'e7', source: 'code-1', target: 'merge-1', type: 'custom' },

  // If false → Loop
  { id: 'e8', source: 'if-1', sourceHandle: 'false', target: 'loop-1', type: 'custom' },
  // Loop → Merge
  { id: 'e9', source: 'loop-1', target: 'merge-1', type: 'custom' },

  // Merge → Filter
  { id: 'e10', source: 'merge-1', target: 'filter-1', type: 'custom' },
  // Filter → No-Op (pass handle)
  { id: 'e11', source: 'filter-1', sourceHandle: 'true', target: 'noop-1', type: 'custom' },
];
