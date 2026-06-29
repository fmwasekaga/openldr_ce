import { readGrant, parseWorkflowNodeDecls, type Grant, type WorkflowNodeDecl } from '@openldr/marketplace';
import type { WorkflowNodeDescriptor } from './host-nodes';

/** Minimal plugin-row shape the registry scans (matches PluginRuntime.list() / the broker's view). */
export interface NodeRegistryPluginRow {
  id: string;
  enabled: boolean;
  manifest: Record<string, unknown>;
}

export interface WorkflowNodeRegistryDeps {
  plugins: { list(): Promise<NodeRegistryPluginRow[]> };
  hostNodes: WorkflowNodeDescriptor[];
  /** Optional structured logger; discovery failures are logged + the node dropped, never thrown. */
  logger?: { warn(obj: unknown, msg: string): void };
}

export interface WorkflowNodeRegistry {
  list(): Promise<WorkflowNodeDescriptor[]>;
}

/** Reads the workflowNodes declaration from a persisted row manifest: artifact rows carry it under
 *  `payload.workflowNodes`; a flat/legacy manifest carries it at the top level. */
function readNodeDecls(manifest: Record<string, unknown>): unknown {
  const payload = (manifest as { payload?: { workflowNodes?: unknown } }).payload;
  if (payload && payload.workflowNodes !== undefined) return payload.workflowNodes;
  return (manifest as { workflowNodes?: unknown }).workflowNodes;
}

/** A node's declared capability kinds must be a subset of the plugin's grant. Legacy (pre-capability)
 *  rows are grandfathered — same posture the broker takes. */
function capsSubset(nodeCaps: string[], grant: Grant): boolean {
  if (grant.legacy) return true;
  const granted: Set<string> = new Set(grant.capabilities.map((c) => c.kind));
  return nodeCaps.every((c) => granted.has(c));
}

export function createWorkflowNodeRegistry(deps: WorkflowNodeRegistryDeps): WorkflowNodeRegistry {
  return {
    async list(): Promise<WorkflowNodeDescriptor[]> {
      const out: WorkflowNodeDescriptor[] = [...deps.hostNodes];
      const seen = new Set(out.map((n) => n.id));

      let rows: NodeRegistryPluginRow[];
      try {
        rows = await deps.plugins.list();
      } catch (err) {
        deps.logger?.warn({ err: String(err) }, 'workflow node discovery: plugin list failed; returning host nodes only');
        return out;
      }

      for (const row of rows) {
        if (!row.enabled) continue;

        const rawDecls = readNodeDecls(row.manifest);
        if (rawDecls === undefined) continue;

        let grant: Grant;
        try {
          grant = readGrant(row.manifest);
        } catch (err) {
          deps.logger?.warn({ pluginId: row.id, err: String(err) }, 'workflow node discovery: unreadable capability grant; skipping plugin');
          continue;
        }

        let decls: WorkflowNodeDecl[];
        try {
          decls = parseWorkflowNodeDecls(rawDecls);
        } catch (err) {
          deps.logger?.warn({ pluginId: row.id, err: String(err) }, 'workflow node discovery: invalid workflowNodes; skipping plugin');
          continue;
        }

        for (const decl of decls) {
          const id = `${row.id}:${decl.id}`;
          if (seen.has(id)) {
            deps.logger?.warn({ id }, 'workflow node discovery: duplicate node id; dropping');
            continue;
          }
          if (decl.kind === 'source' && decl.ports.inputs.length > 0) {
            deps.logger?.warn({ id }, 'workflow node discovery: source node declares inputs; dropping');
            continue;
          }
          if (!capsSubset(decl.capabilities, grant)) {
            deps.logger?.warn({ id, caps: decl.capabilities }, 'workflow node discovery: node capabilities exceed plugin grant; dropping');
            continue;
          }
          seen.add(id);
          out.push({
            id,
            source: 'plugin',
            pluginId: row.id,
            label: decl.label,
            kind: decl.kind,
            description: decl.description,
            entrypoint: decl.entrypoint,
            ports: decl.ports,
            capabilities: decl.capabilities,
            config: decl.config,
            abi: decl.abi,
            binaryField: decl.binaryField,
          });
        }
      }

      return out;
    },
  };
}
