import { useEffect, useRef, useState } from 'react';
import { SDK_BOOTSTRAP_V1, type PluginInitContext } from '@openldr/plugin-ui-sdk';
import { authFetch, pluginUiAssetUrl, pluginBrokerCall } from '@/api';
import { wireHostPort, type HostPortLike } from './host-bridge';

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** The host's current theme (the app sets data-theme on <html> via useTheme; dark default). */
function hostTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** Wrap the plugin's body HTML in a host-controlled document: strict CSP + the injected SDK
 *  bootstrap as the FIRST script, then the plugin content. No same-origin, no network. The
 *  theme is stamped on <html> so the plugin's CSS renders correctly from first paint. */
function buildSrcdoc(pluginBodyHtml: string, theme: 'light' | 'dark'): string {
  return `<!doctype html><html data-openldr-theme="${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body><script>${SDK_BOOTSTRAP_V1}</script>${pluginBodyHtml}</body></html>`;
}

export function PluginFrame({ pluginId, context }: { pluginId: string; context: PluginInitContext }): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authFetch(pluginUiAssetUrl(pluginId))
      .then(async (r) => { if (!r.ok) throw new Error(`asset ${r.status}`); return r.text(); })
      // Stamp the host theme at mount; later changes are pushed via postMessage below.
      .then((html) => { if (!cancelled) setSrcdoc(buildSrcdoc(html, hostTheme())); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [pluginId]);

  // The sandboxed iframe can't see host CSS, so push host dark/light toggles into it.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'openldr:theme', theme: hostTheme() }, '*');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  function onLoad() {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const channel = new MessageChannel();
    wireHostPort(channel.port1 as unknown as HostPortLike, { call: (op) => pluginBrokerCall(pluginId, op) });
    channel.port1.start();
    win.postMessage({ type: 'openldr:init', context: { ...context, theme: hostTheme() } }, '*', [channel.port2]);
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
