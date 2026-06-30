import { describe, it, expect } from 'vitest';
import { emailHandler } from './email';
import { createContext } from '../execution-context';

function fakeCtx(result = { messageId: 'm', accepted: ['t'], rejected: [] }) {
  const calls: unknown[] = [];
  const services = { runConnectorEmail: async (i: unknown) => { calls.push(i); return result; } } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), calls };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'em1', type: 'action', data: { action: 'send-email', config: cfg } });

describe('emailHandler', () => {
  it('templates to/subject/body and returns the send result', async () => {
    const { ctx, calls } = fakeCtx();
    const result = await emailHandler(node({ connectorId: 'c1', to: '{{ $json.email }}', subject: 'Re: {{ $json.id }}', body: 'Hi {{ $json.name }}' }), ctx, [{ json: { email: 'a@x.com', id: '7', name: 'Ann' } }]);
    expect(calls[0]).toEqual({ connectorId: 'c1', to: 'a@x.com', subject: 'Re: 7', body: 'Hi Ann', html: false, cc: undefined });
    expect(result).toEqual([{ json: { messageId: 'm', accepted: ['t'], rejected: [] } }]);
  });
  it('passes html=true and cc', async () => {
    const { ctx, calls } = fakeCtx();
    await emailHandler(node({ connectorId: 'c1', to: 't@x.com', subject: 's', body: '<b>x</b>', html: true, cc: 'c@x.com' }), ctx, []);
    expect(calls[0]).toEqual({ connectorId: 'c1', to: 't@x.com', subject: 's', body: '<b>x</b>', html: true, cc: 'c@x.com' });
  });
  it('throws without connector / to / subject / services', async () => {
    const { ctx } = fakeCtx();
    await expect(emailHandler(node({ connectorId: '', to: 't', subject: 's', body: 'b' }), ctx, [])).rejects.toThrow(/connector is required/);
    await expect(emailHandler(node({ connectorId: 'c1', to: '', subject: 's', body: 'b' }), ctx, [])).rejects.toThrow(/recipient/);
    await expect(emailHandler(node({ connectorId: 'c1', to: 't', subject: '', body: 'b' }), ctx, [])).rejects.toThrow(/subject/);
    const bare = createContext(undefined, () => {});
    await expect(emailHandler(node({ connectorId: 'c1', to: 't', subject: 's', body: 'b' }), bare, [])).rejects.toThrow(/requires server services/);
  });
});
