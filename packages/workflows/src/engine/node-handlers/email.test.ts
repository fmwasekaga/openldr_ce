import { describe, it, expect } from 'vitest';
import { emailHandler } from './email';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

const node = (cfg: Record<string, unknown>) => ({ id: 'e1', type: 'action', data: { action: 'send-email', config: cfg } });

describe('emailHandler', () => {
  it('reads item binaries and forwards them as attachments', async () => {
    const calls: any[] = [];
    const bytes = new Uint8Array([1, 2, 3]);
    const services = {
      readBinary: async (_k: string) => bytes,
      runConnectorEmail: async (i: unknown) => { calls.push(i); return { messageId: 'm', accepted: ['a@b'], rejected: [] }; },
    } as unknown as import('../services').WorkflowServices;
    const ctx = createContext(undefined, () => {}, [], undefined, services);
    const ref: BinaryRef = { objectKey: 'k', contentType: 'application/xlsx', fileName: 'report.xlsx', byteSize: 3 };
    await emailHandler(node({ connectorId: 'c1', to: 'a@b', subject: 's', body: 'b', attachBinaryField: 'file' }), ctx, [{ json: {}, binary: { file: ref } }]);
    expect(calls[0].attachments).toEqual([{ filename: 'report.xlsx', content: bytes, contentType: 'application/xlsx' }]);
  });

  it('sends with no attachments when the field is absent', async () => {
    const calls: any[] = [];
    const services = { runConnectorEmail: async (i: unknown) => { calls.push(i); return { messageId: 'm', accepted: [], rejected: [] }; } } as unknown as import('../services').WorkflowServices;
    const ctx = createContext(undefined, () => {}, [], undefined, services);
    await emailHandler(node({ connectorId: 'c1', to: 'a@b', subject: 's', body: 'b' }), ctx, [{ json: {} }]);
    expect(calls[0].attachments).toBeUndefined();
  });

  it('throws without services', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(emailHandler(node({ connectorId: 'c1', to: 'a@b', subject: 's', body: 'b' }), ctx, [{ json: {} }])).rejects.toThrow(/requires server services/);
  });
});
