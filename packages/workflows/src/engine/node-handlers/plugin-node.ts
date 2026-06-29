import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/**
 * Generic handler for a plugin-contributed node (node.type === 'plugin-node'). The saved node
 * carries { pluginId, nodeId, kind, config }. Execution is delegated to the injected
 * ctx.services.runPluginNode (implemented at bootstrap) so the engine stays free of plugin code.
 * Source-kind nodes ignore upstream and send items:[]; others pass input items through.
 */
export const pluginNodeHandler: NodeHandler = async (node, ctx, input) => {
  const data = node.data as { pluginId?: unknown; nodeId?: unknown; kind?: unknown; config?: unknown };
  const pluginId = String(data.pluginId ?? '').trim();
  const nodeId = String(data.nodeId ?? '').trim();
  if (!pluginId || !nodeId) throw new Error('plugin node: pluginId and nodeId are required');
  if (!ctx.services?.runPluginNode) throw new Error('plugin node execution is not available');

  const kind = String(data.kind ?? 'transform');
  const config = (data.config && typeof data.config === 'object' && !Array.isArray(data.config)
    ? (data.config as Record<string, unknown>) : {});
  const items: WorkflowItem[] = kind === 'source' ? [] : input;
  const result = await ctx.services.runPluginNode({ pluginId, nodeId, config, items });
  if (result.meta && Object.keys(result.meta).length > 0) {
    const entry = { nodeId: node.id, level: 'info' as const, message: `plugin meta: ${JSON.stringify(result.meta)}`, ts: Date.now() };
    (ctx.logs[node.id] ??= []).push(entry);
    ctx.emit({ type: 'node:log', entry });
  }
  return result.items;
};
