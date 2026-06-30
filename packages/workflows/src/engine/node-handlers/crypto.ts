import nodeCrypto from 'node:crypto';
import type { NodeHandler } from './types';

/** Hash or HMAC a field value into outputField. Pure CPU; no key-pair management. */
export const cryptoHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'hash';
  const algorithm = (config.algorithm as string) || 'sha256';
  const field = (config.field as string) ?? '';
  const outputField = (config.outputField as string) || 'digest';
  const encoding = ((config.encoding as string) || 'hex') as 'hex' | 'base64';
  const secret = (config.secret as string) ?? '';

  return input.map((item) => {
    const value = String(item.json[field] ?? '');
    const digest = operation === 'hmac'
      ? nodeCrypto.createHmac(algorithm, secret).update(value).digest(encoding)
      : nodeCrypto.createHash(algorithm).update(value).digest(encoding);
    return { json: { ...item.json, [outputField]: digest } };
  });
};
