import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/**
 * Sign / verify / decode JWTs (HS* shared-secret algorithms).
 *  - sign:   payloadField (object) → signed token in outputField
 *  - verify: tokenField → { [outputField]: payload, valid: boolean }
 *  - decode: tokenField → { [outputField]: payload } (no signature check)
 */
export const jwtHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'sign';
  const secret = (config.secret as string) ?? '';
  const algorithm = (config.algorithm as string) || 'HS256';
  const payloadField = (config.payloadField as string) ?? '';
  const tokenField = (config.tokenField as string) || 'token';
  const outputField = (config.outputField as string) || (operation === 'sign' ? 'token' : 'payload');
  const key = new TextEncoder().encode(secret);

  const out: WorkflowItem[] = [];
  for (const item of input) {
    if (operation === 'sign') {
      const payload = (payloadField ? item.json[payloadField] : item.json) as Record<string, unknown>;
      const token = await new SignJWT(payload ?? {}).setProtectedHeader({ alg: algorithm }).sign(key);
      out.push({ json: { ...item.json, [outputField]: token } });
    } else if (operation === 'verify') {
      const token = String(item.json[tokenField] ?? '');
      try {
        const { payload } = await jwtVerify(token, key);
        out.push({ json: { ...item.json, [outputField]: payload, valid: true } });
      } catch {
        out.push({ json: { ...item.json, [outputField]: null, valid: false } });
      }
    } else {
      const token = String(item.json[tokenField] ?? '');
      try {
        out.push({ json: { ...item.json, [outputField]: decodeJwt(token) } });
      } catch {
        out.push({ json: { ...item.json, [outputField]: null } });
      }
    }
  }
  return out;
};
