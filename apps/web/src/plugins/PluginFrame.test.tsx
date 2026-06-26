import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { PluginFrame } from './PluginFrame';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    pluginUiAssetUrl: (id: string) => `/api/plugins/${id}/ui/asset`,
    pluginBrokerCall: vi.fn(async () => ({ ok: true, data: null })),
  };
});

describe('PluginFrame', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '<div id="panel">hi</div>' })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders a sandboxed iframe (allow-scripts, NOT allow-same-origin) with the wrapped doc', async () => {
    const { container } = render(<PluginFrame pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
    const iframe = await waitFor(() => {
      const f = container.querySelector('iframe');
      if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
      return f as HTMLIFrameElement;
    });
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    const srcdoc = iframe.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('<div id="panel">hi</div>');
    expect(srcdoc).toContain('openldr:init');
    expect(srcdoc).toContain('Content-Security-Policy');
  });

  it('uses a hardened CSP: no remote (https) images, plus base-uri/form-action lockdown', async () => {
    const { container } = render(<PluginFrame pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
    const iframe = await waitFor(() => {
      const f = container.querySelector('iframe');
      if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
      return f as HTMLIFrameElement;
    });
    const srcdoc = iframe.getAttribute('srcdoc') ?? '';
    // The CSP content lives in the <meta http-equiv="Content-Security-Policy" content="..."> tag.
    const m = /Content-Security-Policy"\s+content="([^"]*)"/.exec(srcdoc);
    expect(m).not.toBeNull();
    const csp = m![1];
    // SEC-02: data: images only — remote https images would be an exfiltration channel.
    expect(csp).toContain('img-src data:');
    const imgSrc = /img-src[^;]*/.exec(csp)?.[0] ?? '';
    expect(imgSrc).not.toContain('https:');
    // SEC-02: close base-tag + form-post exfil/navigation paths.
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    // Unchanged hardening still present.
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
  });
});
