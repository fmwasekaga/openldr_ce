import { useEffect, useRef, useState } from 'react';
import { SDK_BOOTSTRAP_V1, type PluginInitContext } from '@openldr/plugin-ui-sdk';
import { authFetch, pluginUiAssetUrl, pluginBrokerCall } from '@/api';
import { wireHostPort, type HostPortLike } from './host-bridge';

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** Wrap the plugin's body HTML in a host-controlled document: strict CSP + the injected SDK
 *  bootstrap as the FIRST script, then the plugin content. No same-origin, no network. */
function buildSrcdoc(pluginBodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body><script>${SDK_BOOTSTRAP_V1}</script>${pluginBodyHtml}</body></html>`;
}

export function PluginFrame({ pluginId, context }: { pluginId: string; context: PluginInitContext }): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authFetch(pluginUiAssetUrl(pluginId))
      .then(async (r) => { if (!r.ok) throw new Error(`asset ${r.status}`); return r.text(); })
      .then((html) => { if (!cancelled) setSrcdoc(buildSrcdoc(html)); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [pluginId]);

  function onLoad() {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const channel = new MessageChannel();
    wireHostPort(channel.port1 as unknown as HostPortLike, { call: (op) => pluginBrokerCall(pluginId, op) });
    channel.port1.start();
    win.postMessage({ type: 'openldr:init', context }, '*', [channel.port2]);
  }

  if (error) return <div className="p-6 text-sm text-destructive">Failed to load plugin UI: {error}</div>;
  if (!srcdoc) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  return (
    <iframe
      ref={iframeRef}
      title={`plugin-${pluginId}`}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      onLoad={onLoad}
      className="h-full w-full border-0"
    />
  );
}
