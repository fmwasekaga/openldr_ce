import type { OpenLdrPluginApi } from '@openldr/plugin-ui-sdk';

/**
 * The host injects `window.openldr` (the versioned SDK over a MessagePort) before the
 * SPA runs. Resolve it lazily (at call time, not module-load time) so the binding is
 * picked up regardless of import order. Types are erased at build time, so the SDK
 * runtime is NOT bundled into ui.html.
 */
export function getOpenldr(): OpenLdrPluginApi {
  const api = (window as unknown as { openldr?: OpenLdrPluginApi }).openldr;
  if (!api) throw new Error('window.openldr is not available — host did not inject the plugin SDK');
  return api;
}
