import { describe, it, expect, vi } from 'vitest';
import { createWebhookRegistry } from './webhook-registry';

describe('WebhookRegistry', () => {
  it('register and resolve by normalized path', () => {
    const reg = createWebhookRegistry();
    reg.register('/hello/', { workflowId: 'w1', secret: 's1' });
    expect(reg.resolve('hello')?.workflowId).toBe('w1');
    expect(reg.resolve('/hello/')?.workflowId).toBe('w1');
    expect(reg.resolve('nope')).toBeUndefined();
  });

  it('resolve returns the secret', () => {
    const reg = createWebhookRegistry();
    reg.register('my/path', { workflowId: 'w2', secret: 'tok123' });
    expect(reg.resolve('my/path')?.secret).toBe('tok123');
  });

  it('sync reads path + secret from webhook nodes', async () => {
    const reg = createWebhookRegistry();
    await reg.sync('w1', [
      { type: 'trigger', data: { triggerType: 'webhook', path: 'orders', secret: 'abc' } },
      { type: 'action', data: {} },
    ]);
    expect(reg.resolve('orders')?.workflowId).toBe('w1');
    expect(reg.resolve('orders')?.secret).toBe('abc');
  });

  it('sync also accepts node type === "webhook"', async () => {
    const reg = createWebhookRegistry();
    await reg.sync('w2', [
      { type: 'webhook', data: { path: 'items', secret: null } },
    ]);
    expect(reg.resolve('items')?.workflowId).toBe('w2');
    expect(reg.resolve('items')?.secret).toBeNull();
  });

  it('sync resolves a {secretRef} secret to plaintext via the injected resolveRef (SEC-06)', async () => {
    const resolveRef = vi.fn(async (ref: string) => (ref === 'wsec_1' ? 'resolved-plain' : null));
    const reg = createWebhookRegistry({ resolveRef });
    await reg.sync('w1', [
      { type: 'trigger', data: { triggerType: 'webhook', path: 'orders', secret: { secretRef: 'wsec_1' } } },
    ]);
    expect(resolveRef).toHaveBeenCalledWith('wsec_1');
    expect(reg.resolve('orders')?.secret).toBe('resolved-plain');
  });

  it('sync registers a plain-string secret directly (no resolver call)', async () => {
    const resolveRef = vi.fn(async () => 'unused');
    const reg = createWebhookRegistry({ resolveRef });
    await reg.sync('w1', [
      { type: 'webhook', data: { path: 'orders', secret: 'plain-token' } },
    ]);
    expect(resolveRef).not.toHaveBeenCalled();
    expect(reg.resolve('orders')?.secret).toBe('plain-token');
  });

  it('sync registers secret:null when a ref resolves to null (unresolvable)', async () => {
    const resolveRef = vi.fn(async () => null);
    const reg = createWebhookRegistry({ resolveRef });
    await reg.sync('w1', [
      { type: 'webhook', data: { path: 'orders', secret: { secretRef: 'wsec_missing' } } },
    ]);
    expect(reg.resolve('orders')?.secret).toBeNull();
  });

  it('sync registers secret:null for a {secretRef} when no resolver is configured', async () => {
    const reg = createWebhookRegistry();
    await reg.sync('w1', [
      { type: 'webhook', data: { path: 'orders', secret: { secretRef: 'wsec_1' } } },
    ]);
    expect(reg.resolve('orders')?.secret).toBeNull();
  });

  it('clear drops a workflow’s paths', () => {
    const reg = createWebhookRegistry();
    reg.register('a', { workflowId: 'w1', secret: null });
    reg.register('b', { workflowId: 'w2', secret: null });
    reg.clear('w1');
    expect(reg.resolve('a')).toBeUndefined();
    expect(reg.resolve('b')?.workflowId).toBe('w2');
  });

  it('sync replaces previous paths for the same workflow', async () => {
    const reg = createWebhookRegistry();
    await reg.sync('w1', [{ type: 'webhook', data: { path: 'old', secret: null } }]);
    await reg.sync('w1', [{ type: 'webhook', data: { path: 'new', secret: 's' } }]);
    expect(reg.resolve('old')).toBeUndefined();
    expect(reg.resolve('new')?.workflowId).toBe('w1');
  });

  it('list returns all registered paths', () => {
    const reg = createWebhookRegistry();
    reg.register('p1', { workflowId: 'w1', secret: null });
    reg.register('p2', { workflowId: 'w2', secret: null });
    const paths = reg.list().map((e) => e.path).sort();
    expect(paths).toEqual(['p1', 'p2']);
  });
});
