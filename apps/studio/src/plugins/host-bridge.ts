import type { PluginBrokerOp, PluginRpcResult } from '@openldr/plugin-ui-sdk';

export interface HostPortLike {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  start?(): void;
}

export interface HostBridgeDeps {
  /** Forward an op to the server broker; resolves to a structured result. The bridge also
   *  defends against a thrown call by replying ok:false. */
  call(op: PluginBrokerOp): Promise<PluginRpcResult>;
}

/** Wire the host end of the plugin MessagePort: plugin posts { id, op }; we call the broker
 *  and post back { id, result }. A thrown call becomes ok:false so the plugin RPC never hangs. */
export function wireHostPort(port: HostPortLike, deps: HostBridgeDeps): void {
  port.onmessage = (ev) => {
    const msg = ev.data as { id?: number; op?: PluginBrokerOp };
    if (typeof msg?.id !== 'number' || !msg.op) return;
    const id = msg.id;
    deps
      .call(msg.op)
      .then((result) => port.postMessage({ id, result }))
      .catch((err: unknown) => port.postMessage({ id, result: { ok: false, error: err instanceof Error ? err.message : String(err) } }));
  };
  port.start?.();
}
