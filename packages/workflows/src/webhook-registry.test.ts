import { describe, it, expect } from 'vitest';
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

  it('sync reads path + secret from webhook nodes', () => {
    const reg = createWebhookRegistry();
    reg.sync('w1', [
      { type: 'trigger', data: { triggerType: 'webhook', path: 'orders', secret: 'abc' } },
      { type: 'action', data: {} },
    ]);
    expect(reg.resolve('orders')?.workflowId).toBe('w1');
    expect(reg.resolve('orders')?.secret).toBe('abc');
  });

  it('sync also accepts node type === "webhook"', () => {
    const reg = createWebhookRegistry();
    reg.sync('w2', [
      { type: 'webhook', data: { path: 'items', secret: null } },
    ]);
    expect(reg.resolve('items')?.workflowId).toBe('w2');
    expect(reg.resolve('items')?.secret).toBeNull();
  });

  it('clear drops a workflow’s paths', () => {
    const reg = createWebhookRegistry();
    reg.register('a', { workflowId: 'w1', secret: null });
    reg.register('b', { workflowId: 'w2', secret: null });
    reg.clear('w1');
    expect(reg.resolve('a')).toBeUndefined();
    expect(reg.resolve('b')?.workflowId).toBe('w2');
  });

  it('sync replaces previous paths for the same workflow', () => {
    const reg = createWebhookRegistry();
    reg.sync('w1', [{ type: 'webhook', data: { path: 'old', secret: null } }]);
    reg.sync('w1', [{ type: 'webhook', data: { path: 'new', secret: 's' } }]);
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
