import type { NodeHandler } from './types';
import { resolveTemplate, resolveTemplatesDeep } from '../template';

export const httpHandler: NodeHandler = async (node, ctx, upstream) => {
  if (!ctx.services) throw new Error('HTTP node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const url = resolveTemplate(String(config.url ?? ''), ctx, upstream);
  const method = String(config.method ?? 'GET');

  let headers: Record<string, string> = {};
  const rawHeaders = config.headers;
  if (typeof rawHeaders === 'string' && rawHeaders.trim()) {
    try { headers = JSON.parse(resolveTemplate(rawHeaders, ctx, upstream)); }
    catch { throw new Error('HTTP Request: headers must be valid JSON'); }
  } else if (rawHeaders && typeof rawHeaders === 'object') {
    headers = resolveTemplatesDeep(rawHeaders as Record<string, string>, ctx, upstream);
  }

  const body = config.body !== undefined ? resolveTemplate(String(config.body ?? ''), ctx, upstream) : undefined;
  return ctx.services.httpFetch({ url, method, headers, body });
};
