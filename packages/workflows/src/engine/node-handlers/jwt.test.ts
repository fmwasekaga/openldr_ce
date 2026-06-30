import { describe, it, expect } from 'vitest';
import { jwtHandler } from './jwt';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'jw1', type: 'action', data: { action: 'jwt', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('jwtHandler', () => {
  it('signs then verifies a payload round-trip', async () => {
    const signed = await jwtHandler(node({ operation: 'sign', secret: 's3cr3t', algorithm: 'HS256', payloadField: 'claims', outputField: 'token' }), ctx(), [{ json: { claims: { sub: 'u1', role: 'admin' } } }]);
    const token = (signed[0].json as Record<string, unknown>).token as string;
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
    const verified = await jwtHandler(node({ operation: 'verify', secret: 's3cr3t', tokenField: 'token', outputField: 'payload' }), ctx(), [{ json: { token } }]);
    const out = verified[0].json as Record<string, unknown>;
    expect(out.valid).toBe(true);
    expect((out.payload as Record<string, unknown>).sub).toBe('u1');
  });
  it('marks an invalid signature as not valid', async () => {
    const signed = await jwtHandler(node({ operation: 'sign', secret: 'right', payloadField: 'claims', outputField: 'token' }), ctx(), [{ json: { claims: { a: 1 } } }]);
    const token = (signed[0].json as Record<string, unknown>).token as string;
    const verified = await jwtHandler(node({ operation: 'verify', secret: 'wrong', tokenField: 'token', outputField: 'payload' }), ctx(), [{ json: { token } }]);
    expect((verified[0].json as Record<string, unknown>).valid).toBe(false);
  });
  it('decodes without verifying', async () => {
    const signed = await jwtHandler(node({ operation: 'sign', secret: 's', payloadField: 'claims', outputField: 'token' }), ctx(), [{ json: { claims: { hello: 'world' } } }]);
    const token = (signed[0].json as Record<string, unknown>).token as string;
    const decoded = await jwtHandler(node({ operation: 'decode', tokenField: 'token', outputField: 'payload' }), ctx(), [{ json: { token } }]);
    expect(((decoded[0].json as Record<string, unknown>).payload as Record<string, unknown>).hello).toBe('world');
  });
});
