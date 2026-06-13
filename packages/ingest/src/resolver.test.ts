import { describe, it, expect } from 'vitest';
import { ConverterRegistry } from './converter';
import { registryResolver, chainResolvers, type ConverterResolver } from './resolver';

const conv = (id: string) => ({ id, version: '1', convert: async () => [] });

describe('registryResolver', () => {
  it('resolves a registered converter and undefined otherwise', async () => {
    const reg = new ConverterRegistry();
    reg.register(conv('a'));
    const r = registryResolver(reg);
    expect((await r.resolve('a'))?.id).toBe('a');
    expect(await r.resolve('missing')).toBeUndefined();
  });
});

describe('chainResolvers', () => {
  it('returns the first match in order', async () => {
    const first: ConverterResolver = { resolve: async (id) => (id === 'x' ? conv('first') : undefined) };
    const second: ConverterResolver = { resolve: async () => conv('second') };
    const chained = chainResolvers(first, second);
    expect((await chained.resolve('x'))?.id).toBe('first');
    expect((await chained.resolve('y'))?.id).toBe('second');
  });
});
