import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';

interface UiPluginRow {
  id: string;
  version: string;
  enabled: boolean;
  manifest: {
    payload?: {
      kind?: string;
      ui?: {
        entry: string;
        sha256: string;
        nav: { label: string; icon: string; section: string };
        uiSdkVersion: string;
        declarative?: unknown;
      };
    };
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerPluginUiRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  // Any authenticated user may list plugin UIs — the sidebar uses this to build nav entries.
  // The broker (per-op) is the real security boundary, enforcing capability + role checks.
  app.get('/api/plugins/ui', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!ctx.cfg.PLUGIN_UI_ENABLED) return [];
    const rows = (await ctx.plugins.list()) as unknown as UiPluginRow[];
    return rows
      .filter((r) => r.enabled && r.manifest.payload?.kind === 'plugin' && r.manifest.payload.ui)
      .map((r) => {
        const ui = r.manifest.payload!.ui!;
        return {
          id: r.id,
          version: r.version,
          nav: ui.nav,
          uiSdkVersion: ui.uiSdkVersion,
          hasDeclarative: ui.declarative !== undefined,
        };
      });
  });

  // Serve the stored ui.html bytes — the web iframe sandbox loads this URL as its srcdoc source.
  app.get<{ Params: { id: string } }>('/api/plugins/:id/ui/asset', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!ctx.cfg.PLUGIN_UI_ENABLED) {
      reply.code(404);
      return reply.send({ error: 'plugin UI disabled' });
    }
    const bytes = await ctx.plugins.loadUi(req.params.id);
    if (!bytes) {
      reply.code(404);
      return reply.send({ error: 'no ui asset' });
    }
    reply.header('content-type', 'text/html; charset=utf-8');
    // Prevent browsers from sniffing away from text/html into something executable.
    reply.header('x-content-type-options', 'nosniff');
    // Defense-in-depth: if this URL is opened directly (not via the host's sandboxed iframe),
    // the CSP sandbox keeps the plugin HTML inert (no scripts, no same-origin) at the host origin.
    reply.header('content-security-policy', 'sandbox');
    return reply.send(Buffer.from(bytes));
  });

  // Broker RPC endpoint — the iframe posts messages via the host SDK which relays them here.
  // The broker itself enforces capability + global policy + role-gate; this route just
  // authenticates the caller and forwards. It never throws (broker returns ok/error shapes).
  app.post<{ Params: { id: string }; Body: { op?: unknown } }>('/api/plugins/:id/broker', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    const op = (req.body as { op?: unknown } | undefined)?.op as never;
    if (!op || typeof op !== 'object') {
      reply.code(400);
      return reply.send({ ok: false, error: 'missing op' });
    }
    const principal = { id: req.user.id, roles: req.user.roles };
    return ctx.pluginBroker.handle(req.params.id, principal, op);
  });
}
