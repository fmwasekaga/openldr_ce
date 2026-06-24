import type { PluginBrokerOp, PluginRpcResult } from './types';

/** Minimal MessagePort surface used by the RPC core (works for real ports + test fakes). */
export interface PortLike {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  start?(): void;
}

/** Promise-based, id-correlated RPC over a MessagePort. The host replies { id, result }. */
export function makeRpc(port: PortLike): { call(op: PluginBrokerOp): Promise<unknown> } {
  let seq = 0;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  port.onmessage = (ev) => {
    const msg = ev.data as { id?: number; result?: PluginRpcResult };
    if (typeof msg?.id !== 'number') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    const r = msg.result;
    if (r && r.ok) waiter.resolve(r.data);
    else waiter.reject(new Error(r && !r.ok ? r.error : 'plugin host call failed'));
  };
  port.start?.();
  return {
    call(op) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        port.postMessage({ id, op });
      });
    },
  };
}

/** The in-iframe runtime, authored as a function so it is reviewable + lintable, then
 *  serialized into SDK_BOOTSTRAP_V1. It references only browser globals (window) + locals —
 *  it must NOT reference module-scope identifiers (it cannot import at runtime in the iframe).
 *  Keep its RPC logic behaviorally identical to makeRpc above. */
function pluginBootstrapV1(): void {
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => { resolveReady = r; });
  let port: MessagePort | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

  function call(op: unknown): Promise<unknown> {
    if (!port) return Promise.reject(new Error('openldr: not initialized'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port!.postMessage({ id, op });
    });
  }

  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as { type?: string; context?: Record<string, unknown> } | undefined;
    if (!data || data.type !== 'openldr:init' || port) return;
    port = ev.ports[0];
    if (!port) return;
    port.onmessage = (e: MessageEvent) => {
      const m = e.data as { id?: number; result?: { ok: boolean; data?: unknown; error?: string } };
      if (typeof m?.id !== 'number') return;
      const w = pending.get(m.id);
      if (!w) return;
      pending.delete(m.id);
      if (m.result && m.result.ok) w.resolve(m.result.data);
      else w.reject(new Error(m.result?.error ?? 'plugin host call failed'));
    };
    port.start();
    const ctx = (data.context ?? {}) as { pluginId?: string; capabilities?: string[]; theme?: string; locale?: string };
    (window as unknown as { openldr: unknown }).openldr = {
      pluginId: ctx.pluginId ?? '',
      capabilities: ctx.capabilities ?? [],
      theme: ctx.theme ?? 'light',
      locale: ctx.locale ?? 'en',
      ready,
      storage: {
        get: (c: string, k: string) => call({ kind: 'storage.get', collection: c, key: k }),
        put: (c: string, k: string, doc: unknown) => call({ kind: 'storage.put', collection: c, key: k, doc }),
        delete: (c: string, k: string) => call({ kind: 'storage.delete', collection: c, key: k }),
        list: (c: string, o?: unknown) => call({ kind: 'storage.list', collection: c, ...((o as object) ?? {}) }),
      },
      invoke: (entrypoint: string, input: unknown) => call({ kind: 'invoke', entrypoint, input }),
      reports: {
        list: () => call({ kind: 'reports.list' }),
        columns: (id: string) => call({ kind: 'reports.columns', id }),
        run: (id: string, params?: Record<string, unknown>) => call({ kind: 'reports.run', id, params }),
        eventSources: () => call({ kind: 'reports.eventSources' }),
      },
      connectors: {
        list: () => call({ kind: 'connectors.list' }),
        test: (id: string) => call({ kind: 'connectors.test', id }),
        metadata: (id: string) => call({ kind: 'connectors.metadata', id }),
        push: (input: unknown) => call({ kind: 'connectors.push', ...(input as object) }),
        validate: (input: unknown) => call({ kind: 'connectors.validate', ...(input as object) }),
      },
      fhir: { facilities: () => call({ kind: 'fhir.facilities' }) },
      schedule: {
        register: (schedule: unknown) => call({ kind: 'schedule.register', schedule }),
        list: () => call({ kind: 'schedule.list' }),
        remove: (id: string) => call({ kind: 'schedule.remove', id }),
      },
    };
    resolveReady();
  });
}

/** The bootstrap source the host inlines as the first <script> in the iframe document. */
export const SDK_BOOTSTRAP_V1: string = `(${pluginBootstrapV1.toString()})();`;
