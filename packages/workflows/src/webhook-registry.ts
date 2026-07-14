/**
 * In-memory registry mapping webhook paths → { workflowId, secret }.
 * Paths are normalized to strip leading/trailing slashes so `/hello/` and
 * `hello` both resolve to the same entry.
 *
 * A factory is used instead of a module singleton so the registry is owned by
 * the app context and can be swapped/reset in tests.
 *
 * SEC-06: since save-time extraction seals a webhook node's `data.secret` into
 * the secret store (the persisted value is an opaque `{ secretRef }`), `sync`
 * must RESOLVE that ref to plaintext before registering it. Resolution is
 * injected (`opts.resolveRef`) so this package stays crypto-key-free — the
 * resolved plaintext is held in memory and the constant-time verify path
 * (secretEquals in the route) is unchanged.
 */
import { isSecretRef } from './secret-fields';

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
  /** Walk a workflow's nodes, clear old paths, register webhook trigger paths.
   *  Async because a webhook secret may be a sealed `{ secretRef }` resolved via
   *  the injected `resolveRef`. */
  sync(workflowId: string, nodes: unknown[]): Promise<void>;
  list(): Array<{ path: string; workflowId: string }>;
}

interface MaybeNode {
  type?: string;
  data?: { triggerType?: string; path?: string; secret?: unknown };
}

export interface WebhookRegistryOptions {
  /** Resolve a sealed secret ref → plaintext (or null if it cannot be resolved).
   *  Injected at bootstrap; absent in pure tests (a ref then registers as null). */
  resolveRef?: (ref: string) => Promise<string | null>;
}

export function createWebhookRegistry(opts: WebhookRegistryOptions = {}): WebhookRegistry {
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

    async sync(workflowId, nodes) {
      reg.clear(workflowId);
      for (const raw of nodes) {
        const node = raw as MaybeNode;
        const isWebhook =
          node?.type === 'webhook' ||
          (node?.type === 'trigger' && node.data?.triggerType === 'webhook');
        if (!isWebhook) continue;
        const path = node.data?.path;
        if (typeof path === 'string' && path.trim()) {
          // Resolve the secret to a plaintext string (or null). A sealed
          // `{ secretRef }` is opened via the injected resolver; a plain string
          // (legacy / not-yet-migrated) is used as-is; anything else → null.
          const rawSecret = node.data?.secret;
          let secret: string | null;
          if (isSecretRef(rawSecret)) {
            secret = (await opts.resolveRef?.(rawSecret.secretRef)) ?? null;
          } else if (typeof rawSecret === 'string') {
            secret = rawSecret;
          } else {
            secret = null;
          }
          reg.register(path, { workflowId, secret });
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
