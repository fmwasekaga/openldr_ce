import type { NodeHandler } from './types';
import { resolveTemplate, resolveTemplatesDeep } from '../template';

export const httpHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('HTTP node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const url = resolveTemplate(String(config.url ?? ''), ctx, input);
  const method = String(config.method ?? 'GET');

  let headers: Record<string, string> = {};
  const rawHeaders = config.headers;
  if (typeof rawHeaders === 'string' && rawHeaders.trim()) {
    try { headers = JSON.parse(resolveTemplate(rawHeaders, ctx, input)); }
    catch { throw new Error('HTTP Request: headers must be valid JSON'); }
  } else if (rawHeaders && typeof rawHeaders === 'object') {
    headers = resolveTemplatesDeep(rawHeaders as Record<string, string>, ctx, input);
  }

  const body = config.body !== undefined ? resolveTemplate(String(config.body ?? ''), ctx, input) : undefined;
  const response = await ctx.services.httpFetch({ url, method, headers, body });
  return [{ json: { status: response.status, headers: response.headers, data: response.data } }];
};
