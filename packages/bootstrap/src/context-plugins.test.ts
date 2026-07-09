import { describe, it, expect } from 'vitest';
import { createPluginBroker } from './plugin-broker';
import { policyFromConfig } from './policy';

describe('context plugin wiring', () => {
  it('policyFromConfig + createPluginBroker compose into a handle()', () => {
    const broker = createPluginBroker({
      plugins: { list: async () => [], loadSink: async () => undefined } as any,
      pluginData: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => [], purge: async () => {} },
      reporting: { list: async () => [], columns: async () => [], run: async () => ({}), eventSources: () => [] },
      connectors: { list: async () => [], get: async () => null },
      policy: () => policyFromConfig({ PLUGIN_UI_ENABLED: true, PLUGIN_EGRESS_ENABLED: true } as any),
    });
    expect(typeof broker.handle).toBe('function');
  });
});
