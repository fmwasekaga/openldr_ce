import { describe, it, expect, vi } from 'vitest';
import { createConnectorEmailRunner } from './connector-email-service';

const connectorsFake = (rec: unknown) => ({
  get: vi.fn(async () => rec as never),
  getDecryptedConfig: vi.fn(async () => ({ user: 'from@x.com', host: 'mail', port: '587', password: 'p' })),
});
function fakeTransport() {
  let closed = false;
  const calls: unknown[] = [];
  return { t: { sendMail: async (m: unknown) => { calls.push(m); return { messageId: 'mid', accepted: ['to@x.com'], rejected: [] }; }, close: () => { closed = true; } }, calls, isClosed: () => closed };
}

describe('createConnectorEmailRunner', () => {
  it('sends text mail and closes', async () => {
    const f = fakeTransport();
    const run = createConnectorEmailRunner({ connectors: connectorsFake({ type: 'smtp', enabled: true }), secretsKey: 'k', makeTransport: () => f.t as never });
    const res = await run({ connectorId: 'e1', to: 'to@x.com', subject: 'hi', body: 'hello' });
    expect(res).toEqual({ messageId: 'mid', accepted: ['to@x.com'], rejected: [] });
    expect(f.calls[0]).toEqual(expect.objectContaining({ from: 'from@x.com', to: 'to@x.com', subject: 'hi', text: 'hello' }));
    expect(f.isClosed()).toBe(true);
  });
  it('sends html when html=true', async () => {
    const f = fakeTransport();
    const run = createConnectorEmailRunner({ connectors: connectorsFake({ type: 'smtp', enabled: true }), secretsKey: 'k', makeTransport: () => f.t as never });
    await run({ connectorId: 'e1', to: 't', subject: 's', body: '<b>x</b>', html: true });
    expect(f.calls[0]).toEqual(expect.objectContaining({ html: '<b>x</b>' }));
    expect((f.calls[0] as Record<string, unknown>).text).toBeUndefined();
  });
  it('forwards attachments to sendMail', async () => {
    const f = fakeTransport();
    const run = createConnectorEmailRunner({ connectors: connectorsFake({ type: 'smtp', enabled: true }), secretsKey: 'k', makeTransport: () => f.t as never });
    await run({ connectorId: 'e1', to: 't@x', subject: 's', body: 'b', attachments: [{ filename: 'r.xlsx', content: new Uint8Array([1]), contentType: 'application/xlsx' }] });
    expect((f.calls[0] as Record<string, unknown>).attachments).toEqual([{ filename: 'r.xlsx', content: Buffer.from([1]), contentType: 'application/xlsx' }]);
  });
  it('throws for a non-email connector', async () => {
    const run = createConnectorEmailRunner({ connectors: connectorsFake({ type: 'postgres', enabled: true }), secretsKey: 'k', makeTransport: () => ({}) as never });
    await expect(run({ connectorId: 'x', to: 't', subject: 's', body: 'b' })).rejects.toThrow(/not an email connector/);
  });
});
