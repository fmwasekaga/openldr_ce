import type { BinaryRef } from '@openldr/workflows';

export interface ListenerSpec {
  workflowId: string;
  nodeId: string;
  triggerType: 'postgres' | 'email';
  config: Record<string, unknown>;
}
export type OnFire = (input: unknown, files?: Record<string, BinaryRef>) => Promise<unknown>;
export interface ListenerHandle { stop(): Promise<void>; }
export interface ListenerDriver { start(spec: ListenerSpec, onFire: OnFire): Promise<ListenerHandle>; }

interface WorkflowRow { id: string; enabled: boolean; definition: unknown }

/** Pull every postgres/email trigger node out of the enabled workflows. */
export function extractListenerSpecs(rows: WorkflowRow[]): ListenerSpec[] {
  const out: ListenerSpec[] = [];
  for (const w of rows) {
    if (!w.enabled) continue;
    const nodes = ((w.definition as { nodes?: unknown[] } | null)?.nodes ?? []) as Array<{
      id?: string; type?: string; data?: { triggerType?: string; config?: Record<string, unknown> };
    }>;
    for (const n of nodes) {
      const tt = n.data?.triggerType;
      if (n.type === 'trigger' && (tt === 'postgres' || tt === 'email') && n.id) {
        out.push({ workflowId: w.id, nodeId: n.id, triggerType: tt, config: n.data?.config ?? {} });
      }
    }
  }
  return out;
}

export interface ListenerManagerDeps {
  store: { list(): Promise<WorkflowRow[]> };
  runAndRecord: (workflowId: string, source: 'postgres' | 'email', input: unknown, files?: Record<string, BinaryRef>) => Promise<unknown>;
  logger: { error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
  /** Live read of the `workflow.listeners_enabled` feature flag; checked each reconcile
   * so toggling it in Settings starts/stops listeners without a restart. */
  isEnabled: () => Promise<boolean>;
  drivers: { postgres: ListenerDriver; email: ListenerDriver };
}

export interface WorkflowListenerManager {
  reconcile(): Promise<void>;
  stopAll(): Promise<void>;
}

const keyOf = (s: ListenerSpec) => `${s.workflowId}:${s.nodeId}`;

export function createWorkflowListenerManager(deps: ListenerManagerDeps): WorkflowListenerManager {
  const active = new Map<string, { hash: string; handle: ListenerHandle }>();

  async function startOne(spec: ListenerSpec): Promise<void> {
    const driver = deps.drivers[spec.triggerType];
    try {
      const handle = await driver.start(spec, (input, files) =>
        deps.runAndRecord(spec.workflowId, spec.triggerType, input, files));
      active.set(keyOf(spec), { hash: JSON.stringify(spec.config), handle });
    } catch (err) {
      deps.logger.error({ err, workflowId: spec.workflowId, nodeId: spec.nodeId }, 'listener start failed');
    }
  }

  async function stopKey(key: string): Promise<void> {
    const cur = active.get(key);
    if (!cur) return;
    active.delete(key);
    try { await cur.handle.stop(); } catch (err) { deps.logger.warn({ err, key }, 'listener stop failed'); }
  }

  async function stopAll(): Promise<void> {
    for (const key of [...active.keys()]) await stopKey(key);
  }

  return {
    async reconcile() {
      if (!(await deps.isEnabled())) { await stopAll(); return; }
      const specs = extractListenerSpecs(await deps.store.list());
      const desired = new Map(specs.map((s) => [keyOf(s), s]));
      for (const [key, cur] of [...active]) {
        const want = desired.get(key);
        if (!want || JSON.stringify(want.config) !== cur.hash) await stopKey(key);
      }
      for (const [key, spec] of desired) {
        if (!active.has(key)) await startOne(spec);
      }
    },
    stopAll,
  };
}
