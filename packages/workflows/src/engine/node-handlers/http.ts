import type { NodeHandler } from './types';
import { resolveTemplate, resolveTemplatesDeep } from '../template';
import { isSecretRef } from '../../secret-fields';

export const httpHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('HTTP node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const url = resolveTemplate(String(config.url ?? ''), ctx, input);
  const method = String(config.method ?? 'GET');

  let headers: Record<string, string> = {};
  let rawHeaders = config.headers;
  // SEC-06: the headers blob may have been sealed into the secret store on save
  // (persisted as an opaque `{ secretRef }`). Resolve it to the plaintext JSON
  // string BEFORE the string/object branches below. The resolver is injected via
  // services so this package stays crypto-key-free.
  if (isSecretRef(rawHeaders)) {
    const resolver = ctx.services.resolveWorkflowSecret;
    if (!resolver) {
      throw new Error('HTTP Request: cannot resolve sealed headers — no workflow secret resolver configured');
    }
    const resolved = await resolver(rawHeaders.secretRef);
    if (resolved == null) {
      throw new Error('HTTP Request: sealed headers could not be resolved');
    }
    rawHeaders = resolved; // a JSON string — the string-parse path below handles it
  }
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
