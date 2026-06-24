/** The init context the host mints and transfers to the plugin iframe. */
export interface PluginInitContext {
  pluginId: string;
  capabilities: string[];
  theme: 'light' | 'dark';
  locale: string;
  sessionId: string;
}

/** Operations the plugin may request (mirror of the host broker's BrokerOp). */
export type PluginBrokerOp =
  | { kind: 'storage.get'; collection: string; key: string }
  | { kind: 'storage.put'; collection: string; key: string; doc: unknown }
  | { kind: 'storage.delete'; collection: string; key: string }
  | { kind: 'storage.list'; collection: string; where?: { field: string; eq: unknown }; limit?: number }
  | { kind: 'invoke'; entrypoint: string; input: unknown }
  | { kind: 'reports.list' }
  | { kind: 'reports.columns'; id: string }
  | { kind: 'reports.run'; id: string; params?: Record<string, unknown> }
  | { kind: 'connectors.list' }
  | { kind: 'connectors.test'; id: string };

export type PluginRpcResult = { ok: true; data: unknown } | { ok: false; error: string };

/** The `window.openldr` surface available to plugin code inside the iframe. */
export interface OpenLdrPluginApi {
  readonly pluginId: string;
  readonly capabilities: readonly string[];
  readonly theme: 'light' | 'dark';
  readonly locale: string;
  readonly ready: Promise<void>;
  storage: {
    get(collection: string, key: string): Promise<unknown>;
    put(collection: string, key: string, doc: unknown): Promise<void>;
    delete(collection: string, key: string): Promise<void>;
    list(collection: string, opts?: { where?: { field: string; eq: unknown }; limit?: number }): Promise<Array<{ collection: string; key: string; doc: unknown }>>;
  };
  invoke(entrypoint: string, input: unknown): Promise<unknown>;
  reports: {
    list(): Promise<unknown>;
    columns(id: string): Promise<unknown>;
    run(id: string, params?: Record<string, unknown>): Promise<unknown>;
  };
  connectors: {
    list(): Promise<unknown>;
    test(id: string): Promise<unknown>;
  };
}

declare global {
  interface Window { openldr?: OpenLdrPluginApi }
}
