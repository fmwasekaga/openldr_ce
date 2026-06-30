import { describe, it, expect } from 'vitest';
import nodeCrypto from 'node:crypto';
import { cryptoHandler } from './crypto';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'cy1', type: 'action', data: { action: 'crypto', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('cryptoHandler', () => {
  it('hashes a field with sha256 hex by default', async () => {
    const expected = nodeCrypto.createHash('sha256').update('hello').digest('hex');
    const result = await cryptoHandler(node({ operation: 'hash', algorithm: 'sha256', field: 'v', outputField: 'digest', encoding: 'hex' }), ctx(), [{ json: { v: 'hello' } }]);
    expect((result[0].json as Record<string, unknown>).digest).toBe(expected);
  });
  it('computes an hmac with a secret', async () => {
    const expected = nodeCrypto.createHmac('sha256', 'k').update('hello').digest('hex');
    const result = await cryptoHandler(node({ operation: 'hmac', algorithm: 'sha256', secret: 'k', field: 'v', outputField: 'sig', encoding: 'hex' }), ctx(), [{ json: { v: 'hello' } }]);
    expect((result[0].json as Record<string, unknown>).sig).toBe(expected);
  });
  it('supports base64 encoding', async () => {
    const expected = nodeCrypto.createHash('sha256').update('x').digest('base64');
    const result = await cryptoHandler(node({ operation: 'hash', algorithm: 'sha256', field: 'v', outputField: 'd', encoding: 'base64' }), ctx(), [{ json: { v: 'x' } }]);
    expect((result[0].json as Record<string, unknown>).d).toBe(expected);
  });
});
