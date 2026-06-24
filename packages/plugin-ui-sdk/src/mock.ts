import type { OpenLdrPluginApi } from './types';

export interface MockOptions {
  pluginId: string;
  capabilities?: string[];
  theme?: 'light' | 'dark';
  locale?: string;
  reports?: unknown[];
}

/** An in-memory implementation of OpenLdrPluginApi for local plugin development + tests. */
export function createMockOpenldr(opts: MockOptions): OpenLdrPluginApi {
  const mem = new Map<string, unknown>();
  const k = (c: string, key: string) => `${c} ${key}`;
  return {
    pluginId: opts.pluginId,
    capabilities: opts.capabilities ?? [],
    theme: opts.theme ?? 'light',
    locale: opts.locale ?? 'en',
    ready: Promise.resolve(),
    storage: {
      async get(c, key) { return mem.has(k(c, key)) ? mem.get(k(c, key)) : null; },
      async put(c, key, doc) { mem.set(k(c, key), doc); },
      async delete(c, key) { mem.delete(k(c, key)); },
      async list(c) {
        return [...mem.entries()]
          .filter(([kk]) => kk.startsWith(`${c} `))
          .map(([kk, doc]) => ({ collection: c, key: kk.split(' ')[1], doc }));
      },
    },
    async invoke(_e, input) { return { echoed: input }; },
    reports: {
      async list() { return opts.reports ?? []; },
      async columns() { return []; },
      async run() { return { columns: [], rows: [] }; },
      async eventSources() { return []; },
    },
    connectors: {
      async list() { return []; },
      async test() { return { ok: true }; },
      async metadata() { return {}; },
      async push() { return { ok: true, skipped: [] }; },
      async validate() { return { ok: true }; },
    },
    fhir: { async facilities() { return []; } },
    schedule: {
      async register() { return { ok: true }; },
      async list() { return []; },
      async remove() { return { ok: true }; },
    },
  };
}
