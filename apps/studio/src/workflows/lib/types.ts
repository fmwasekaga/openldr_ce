import type { Node, Edge } from '@xyflow/react';
import type { SecretRef } from '@/api';

/** Shared visual metadata present on every node's `data`. */
export interface NodeVisualMeta {
  /** Name of a lucide-react icon, resolved at render time. */
  iconName?: string;
  /** Optional public path (e.g. `/node-icons/slack.svg`) rendered as an <img>. Takes priority over iconName. */
  iconUrl?: string;
}

export interface TriggerNodeData extends NodeVisualMeta {
  label: string;
  triggerType: 'manual' | 'webhook' | 'schedule' | 'ingest' | 'event' | 'postgres' | 'email';
  config: Record<string, unknown>;
  /** For schedule triggers — cron expression read by the server scheduler. */
  cron?: string;
  /** For schedule triggers — IANA timezone (empty = UTC). */
  tz?: string;
  /** For webhook triggers — path segment under /api/workflows/hooks/ that routes here. */
  path?: string;
  /**
   * For webhook triggers — generated shared secret, sent back as X-Webhook-Token.
   * The detail fetch returns a write-only `{ secretRef }` for a saved secret (SEC-06);
   * a freshly typed/generated value is the plaintext string.
   */
  secret?: string | SecretRef;
  /** For webhook triggers — HTTP method to accept. */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  [key: string]: unknown;
}

export interface ActionNodeData extends NodeVisualMeta {
  label: string;
  action: string;
  config: Record<string, unknown>;
  /** For `action: 'log'` nodes — template message, e.g. `got {{ $json.body.name }}`. */
  message?: string;
  level?: 'log' | 'info' | 'warn' | 'error';
  [key: string]: unknown;
}

export interface ConditionNodeData extends NodeVisualMeta {
  label: string;
  condition: string;
  /** Switch node: ordered rules evaluated top-to-bottom. */
  rules?: Array<{ name: string; condition: string }>;
  /** Switch node: output name when no rule matches. */
  fallbackOutput?: string;
  [key: string]: unknown;
}

export interface LoopNodeData extends NodeVisualMeta {
  label: string;
  iterations: number;
  loopMode?: 'count' | 'items';
  /** items mode — number of items per iteration (default 1). */
  batchSize?: number;
  [key: string]: unknown;
}

export interface WebhookNodeData extends NodeVisualMeta {
  label: string;
  /** Path segment under /api/workflows/hooks/ that triggers this workflow (e.g. "hello"). */
  path?: string;
  /**
   * Generated shared secret; callers must send it as the X-Webhook-Token header.
   * A saved secret comes back as a write-only `{ secretRef }` (SEC-06); a freshly
   * typed/generated value is the plaintext string.
   */
  secret?: string | SecretRef;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  [key: string]: unknown;
}

export interface CodeNodeData extends NodeVisualMeta {
  label: string;
  code: string;
  language: 'javascript' | 'typescript';
  [key: string]: unknown;
}

export type WorkflowNodeData =
  | TriggerNodeData
  | ActionNodeData
  | ConditionNodeData
  | LoopNodeData
  | WebhookNodeData
  | CodeNodeData;

export type WorkflowNode = Node<WorkflowNodeData>;
export type WorkflowEdge = Edge;

export interface WorkflowDefinition {
  id?: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface NodeCategory {
  name: string;
  /** Lucide icon name shown next to the category title in the sidebar. */
  icon?: string;
  items: NodeTemplate[];
}

export interface NodeTemplate {
  /** Stable id used for React keys + filtering. */
  id: string;
  /** ReactFlow node type ('trigger' | 'action' | 'condition' | 'loop' | 'webhook' | 'code'). */
  type: string;
  label: string;
  description: string;
  /** Lucide icon name (sidebar fallback when defaultData has no iconUrl). */
  icon: string;
  /** Optional custom asset path under public/, takes priority over the lucide icon. */
  iconUrl?: string;
  /** Searchable keywords (brand names, aliases) — not displayed. */
  keywords?: string[];
  defaultData: WorkflowNodeData;
}
