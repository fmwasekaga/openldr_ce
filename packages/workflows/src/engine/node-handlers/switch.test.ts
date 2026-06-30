import { describe, it, expect } from 'vitest';
import { switchHandler } from './switch';
import { createContext } from '../execution-context';

const node = (rules: Array<{ name: string; condition: string }>, fallbackOutput = 'fallback') => ({
  id: 'sw1', type: 'condition', data: { templateId: 'switch', rules, fallbackOutput },
});

describe('switchHandler', () => {
  it('selects the first matching rule and passes items through', async () => {
    const ctx = createContext(undefined, () => {});
    const input = [{ json: { status: 200 } }];
    const result = await switchHandler(
      node([
        { name: 'ok', condition: '$json.status === 200' },
        { name: 'err', condition: '$json.status >= 400' },
      ]),
      ctx,
      input,
    );
    expect(ctx.branches['sw1']).toBe('ok');
    expect(result).toBe(input);
  });

  it('falls back when no rule matches', async () => {
    const ctx = createContext(undefined, () => {});
    await switchHandler(node([{ name: 'ok', condition: '$json.status === 200' }]), ctx, [{ json: { status: 500 } }]);
    expect(ctx.branches['sw1']).toBe('fallback');
  });

  it('skips empty conditions and uses fallback', async () => {
    const ctx = createContext(undefined, () => {});
    await switchHandler(node([{ name: 'ok', condition: '' }]), ctx, [{ json: {} }]);
    expect(ctx.branches['sw1']).toBe('fallback');
  });

  it('throws a descriptive error when a rule expression is invalid', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      switchHandler(node([{ name: 'bad', condition: 'this is not js (' }]), ctx, [{ json: {} }]),
    ).rejects.toThrow(/Switch rule "bad"/);
  });
});
