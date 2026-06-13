import type { Converter, ConverterRegistry } from './converter';

export interface ConverterResolver {
  resolve(id: string): Promise<Converter | undefined>;
}

/** Adapt a synchronous built-in registry to the async resolver interface. */
export function registryResolver(registry: ConverterRegistry): ConverterResolver {
  return {
    async resolve(id) {
      return registry.get(id);
    },
  };
}

/**
 * Compose resolvers: the first to return a Converter wins. Used by the
 * composition root to put built-in converters ahead of WASM plugins.
 */
export function chainResolvers(...resolvers: ConverterResolver[]): ConverterResolver {
  return {
    async resolve(id) {
      for (const r of resolvers) {
        const found = await r.resolve(id);
        if (found) return found;
      }
      return undefined;
    },
  };
}
