import { randomUUID } from 'node:crypto';
import { parseWorkflowNodeDecls, type WorkflowNodeDecl } from '@openldr/marketplace';
import type { RunPluginNodeInput, RunPluginNodeOutput, WorkflowItem } from '@openldr/workflows';
import { assertNodeAllowed } from './plugin-node-policy';

interface SinkLike {
  invoke(entrypoint: string, input: unknown, opts?: { config?: Record<string, string>; allowedHosts?: string[] }): Promise<unknown>;
  invokeBytes(entrypoint: string, bytes: Uint8Array, opts?: { config?: Record<string, string>; allowedHosts?: string[] }): Promise<unknown>;
}

export interface PluginNodeServiceDeps {
  plugins: {
    list(): Promise<Array<{ id: string; version: string; enabled: boolean; manifest: Record<string, unknown> }>>;
    loadSink(id: string, version?: string): Promise<SinkLike | undefined>;
  };
  connectors: {
    get(id: string): Promise<{ pluginId: string | null; allowedHost: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  policy: () => { egressEnabled: boolean };
  blob: { get(key: string): Promise<Uint8Array>; put(key: string, body: Uint8Array, contentType?: string): Promise<void> };
  maxFileBytes: number;
}

function sanitizeOutName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'output';
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'output';
}

/** Replace any item binary entry carrying inline `dataBase64` with a blob-backed BinaryRef.
 *  Already-materialized refs (no dataBase64) pass through untouched. */
async function materializeEmittedBinary(
  items: WorkflowItem[],
  deps: { blob: { put(key: string, body: Uint8Array, contentType?: string): Promise<void> }; maxFileBytes: number },
): Promise<WorkflowItem[]> {
  for (const item of items) {
    if (!item.binary) continue;
    for (const [field, value] of Object.entries(item.binary)) {
      const inline = value as { contentType?: string; fileName?: string; dataBase64?: unknown };
      if (typeof inline.dataBase64 !== 'string') continue;
      // Reject before decoding: a base64 string of length N decodes to ~N*3/4 bytes, so this
      // bounds the allocation a hostile (but installed) plugin can force in `Buffer.from`.
      if (Math.floor((inline.dataBase64.length * 3) / 4) > deps.maxFileBytes) {
        throw new Error(`emitted file exceeds the ${deps.maxFileBytes}-byte limit`);
      }
      const bytes = Buffer.from(inline.dataBase64, 'base64');
      if (bytes.byteLength > deps.maxFileBytes) throw new Error(`emitted file exceeds the ${deps.maxFileBytes}-byte limit`);
      const fileName = sanitizeOutName(inline.fileName ?? 'output');
      const objectKey = `workflow-artifacts/${randomUUID()}/${fileName}`;
      const contentType = inline.contentType ?? 'application/octet-stream';
      await deps.blob.put(objectKey, new Uint8Array(bytes), contentType);
      item.binary[field] = { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    }
  }
  return items;
}

/** Reads workflowNodes from a persisted row manifest: artifact rows under payload.workflowNodes,
 *  flat/legacy rows at the top level. */
function extractWorkflowNodes(manifest: Record<string, unknown>): unknown {
  const payload = (manifest as { payload?: { workflowNodes?: unknown } }).payload;
  if (payload && payload.workflowNodes !== undefined) return payload.workflowNodes;
  return (manifest as { workflowNodes?: unknown }).workflowNodes;
}

/**
 * The host-side runPluginNode: resolve the plugin + node decl, enforce capabilities, resolve a
 * connector (config + pinned host) when one is referenced, and invoke the wasm entrypoint with the
 * unified { items, config } envelope. The decrypted connector map rides Extism opts.config (never
 * the JSON input); the declarative node config rides input.config minus the resolved connectorId.
 */
export function createPluginNodeService(deps: PluginNodeServiceDeps): (input: RunPluginNodeInput) => Promise<RunPluginNodeOutput> {
  return async ({ pluginId, nodeId, config, items }) => {
    const rows = await deps.plugins.list();
    const row = rows.find((r) => r.id === pluginId && r.enabled);
    if (!row) throw new Error(`plugin ${pluginId} is not installed or disabled`);

    const rawDecls = extractWorkflowNodes(row.manifest);
    if (rawDecls === undefined) throw new Error(`plugin ${pluginId} contributes no workflow nodes`);
    let decls: WorkflowNodeDecl[];
    try {
      decls = parseWorkflowNodeDecls(rawDecls);
    } catch (err) {
      throw new Error(`plugin ${pluginId} has invalid workflow nodes: ${err instanceof Error ? err.message : String(err)}`);
    }
    const decl = decls.find((d) => d.id === nodeId);
    if (!decl) throw new Error(`plugin ${pluginId} has no workflow node '${nodeId}'`);

    assertNodeAllowed(decl, row, deps.policy());

    // Resolve a connector (decrypted config + pinned host) only when the node touches connectors
    // and one is configured.
    let connConfig: Record<string, string> = {};
    let allowedHost: string | null = null;
    const connectorId = typeof config.connectorId === 'string' ? config.connectorId : undefined;
    if (decl.capabilities.includes('host:connectors') && connectorId) {
      const c = await deps.connectors.get(connectorId);
      if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
      connConfig = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
      allowedHost = c.allowedHost;
    }

    const dryRun = Boolean(config.dryRun);
    const allowedHosts = decl.capabilities.includes('net-egress') && !dryRun && allowedHost ? [allowedHost] : [];

    const sink = await deps.plugins.loadSink(pluginId, row.version);
    if (!sink) throw new Error(`plugin ${pluginId} exposes no invokable wasm`);

    // connectorId is resolved host-side; strip it from the wire config (the wasm never needs it,
    // and the JSON input is echoed into run history).
    const wireConfig: Record<string, unknown> = { ...config };
    delete wireConfig.connectorId;

    let raw: unknown;
    if (decl.abi === 'bytes') {
      const field = (typeof config.binaryField === 'string' && config.binaryField) || decl.binaryField || 'file';
      const ref = items[0]?.binary?.[field];
      if (!ref) throw new Error(`plugin ${pluginId} node ${nodeId}: no file on the input item (field '${field}')`);
      if (ref.byteSize > deps.maxFileBytes) throw new Error(`plugin ${pluginId} node ${nodeId}: file exceeds the ${deps.maxFileBytes}-byte limit`);
      const bytes = await deps.blob.get(ref.objectKey);
      if (bytes.byteLength > deps.maxFileBytes) throw new Error(`plugin ${pluginId} node ${nodeId}: file exceeds the ${deps.maxFileBytes}-byte limit`);
      // No JSON input on the bytes path — declarative config (minus connectorId) rides Extism opts.config alongside the connector secrets.
      const bytesConfig: Record<string, string> = { ...connConfig };
      for (const [k, v] of Object.entries(wireConfig)) bytesConfig[k] = typeof v === 'string' ? v : JSON.stringify(v);
      raw = await sink.invokeBytes(decl.entrypoint, bytes, { config: bytesConfig, allowedHosts });
    } else {
      raw = await sink.invoke(decl.entrypoint, { items, config: wireConfig }, { config: connConfig, allowedHosts });
    }
    const out = (raw && typeof raw === 'object' ? raw : {}) as { items?: unknown; meta?: unknown };
    const outItems = Array.isArray(out.items) ? (out.items as WorkflowItem[]) : [];
    const materialized = await materializeEmittedBinary(outItems, { blob: deps.blob, maxFileBytes: deps.maxFileBytes });
    return { items: materialized, meta: out.meta as Record<string, unknown> | undefined };
  };
}
