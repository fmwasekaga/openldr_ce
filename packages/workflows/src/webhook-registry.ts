/**
 * In-memory registry mapping webhook paths → { workflowId, secret }.
 * Paths are normalized to strip leading/trailing slashes so `/hello/` and
 * `hello` both resolve to the same entry.
 *
 * A factory is used instead of a module singleton so the registry is owned by
 * the app context and can be swapped/reset in tests.
 */

function normalize(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

export interface WebhookEntry {
  workflowId: string;
  secret: string | null;
}

export interface WebhookRegistry {
  register(path: string, entry: WebhookEntry): void;
  resolve(path: string): WebhookEntry | undefined;
  /** Drop every path owned by this workflow. */
  clear(workflowId: string): void;
  /** Walk a workflow's nodes, clear old paths, register webhook trigger paths. */
  sync(workflowId: string, nodes: unknown[]): void;
  list(): Array<{ path: string; workflowId: string }>;
}

interface MaybeNode {
  type?: string;
  data?: { triggerType?: string; path?: string; secret?: string };
}

export function createWebhookRegistry(): WebhookRegistry {
  const pathToEntry = new Map<string, WebhookEntry>();
  const workflowToPaths = new Map<string, Set<string>>();

  const reg: WebhookRegistry = {
    register(path, entry) {
      const key = normalize(path);
      if (!key) return;
      pathToEntry.set(key, entry);
      if (!workflowToPaths.has(entry.workflowId)) {
        workflowToPaths.set(entry.workflowId, new Set());
      }
      workflowToPaths.get(entry.workflowId)!.add(key);
    },

    resolve(path) {
      return pathToEntry.get(normalize(path));
    },

    clear(workflowId) {
      for (const p of workflowToPaths.get(workflowId) ?? []) pathToEntry.delete(p);
      workflowToPaths.delete(workflowId);
    },

    sync(workflowId, nodes) {
      reg.clear(workflowId);
      for (const raw of nodes) {
        const node = raw as MaybeNode;
        const isWebhook =
          node?.type === 'webhook' ||
          (node?.type === 'trigger' && node.data?.triggerType === 'webhook');
        if (!isWebhook) continue;
        const path = node.data?.path;
        if (typeof path === 'string' && path.trim()) {
          reg.register(path, { workflowId, secret: node.data?.secret ?? null });
        }
      }
    },

    list() {
      return Array.from(pathToEntry.entries()).map(([path, e]) => ({
        path,
        workflowId: e.workflowId,
      }));
    },
  };

  return reg;
}
