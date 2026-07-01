import { describe, it, expect, vi } from 'vitest';
import { wireHostPort, type HostPortLike } from './host-bridge';

// Hand-rolled linked port pair (no MessageChannel polyfill needed).
function linkedPorts(): [HostPortLike, { post(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null }] {
  let aOnmessage: ((e: { data: unknown }) => void) | null = null;
  const peer = { onmessage: null as null | ((e: { data: unknown }) => void), post(m: unknown) { aOnmessage?.({ data: m }); } };
  const host: HostPortLike = {
    set onmessage(fn) { aOnmessage = fn; },
    get onmessage() { return aOnmessage; },
    postMessage(m: unknown) { peer.onmessage?.({ data: m }); },
    start() {},
  };
  return [host, peer];
}

describe('wireHostPort', () => {
  it('forwards a plugin op to the broker call and replies with the result, correlated by id', async () => {
    const [host, peer] = linkedPorts();
    const call = vi.fn(async () => ({ ok: true as const, data: [{ id: 'r1' }] }));
    wireHostPort(host, { call });
    const replies: any[] = [];
    peer.onmessage = (e) => replies.push(e.data);
    peer.post({ id: 7, op: { kind: 'reports.list' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(call).toHaveBeenCalledWith({ kind: 'reports.list' });
    expect(replies).toEqual([{ id: 7, result: { ok: true, data: [{ id: 'r1' }] } }]);
  });

  it('a thrown/rejected call still replies ok:false (never leaves the plugin hanging)', async () => {
    const [host, peer] = linkedPorts();
    const call = vi.fn(async () => { throw new Error('boom'); });
    wireHostPort(host, { call });
    const replies: any[] = [];
    peer.onmessage = (e) => replies.push(e.data);
    peer.post({ id: 1, op: { kind: 'reports.list' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(replies[0]).toEqual({ id: 1, result: { ok: false, error: 'boom' } });
  });

  it('ignores malformed messages (no id)', async () => {
    const [host, peer] = linkedPorts();
    const call = vi.fn(async () => ({ ok: true as const, data: null }));
    wireHostPort(host, { call });
    peer.post({ op: { kind: 'reports.list' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(call).not.toHaveBeenCalled();
  });
});
