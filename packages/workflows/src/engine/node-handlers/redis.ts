import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/** Run a Redis op (get/set/del). key/value support {{ }} templates. */
export const redisHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.runConnectorRedis) throw new Error('Redis node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const connectorId = (config.connectorId as string) ?? '';
  if (!connectorId) throw new Error('Redis node: a connector is required');
  const operation = (config.operation as string) || 'get';
  const key = resolveTemplate(String(config.key ?? ''), ctx, input);
  if (!key) throw new Error('Redis node: a key is required');
  const value = config.value !== undefined ? resolveTemplate(String(config.value), ctx, input) : undefined;
  const ttlRaw = config.ttlSeconds;
  const ttlSeconds = ttlRaw === undefined || ttlRaw === '' ? undefined : Number(ttlRaw);
  const { result } = await ctx.services.runConnectorRedis({ connectorId, operation, key, value, ttlSeconds });
  if (operation === 'set') return [{ json: { ok: result } }];
  if (operation === 'del') return [{ json: { deleted: result } }];
  return [{ json: { value: result } }];
};
