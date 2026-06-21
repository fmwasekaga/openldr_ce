import type { FastifyInstance } from 'fastify';
import type { AppContext, Dhis2Context } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { requireRole } from './rbac';

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDhis2Routes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, dhis2: Dhis2Context | null): void {
  const cfg = ctx.cfg;
  const configured =
    cfg.REPORTING_TARGET_ADAPTER === 'dhis2' && !!cfg.DHIS2_BASE_URL && !!cfg.DHIS2_USERNAME && !!cfg.DHIS2_PASSWORD;

  app.get('/api/dhis2/status', { preHandler: requireRole('lab_admin') }, async () => {
    const base = { configured, syncEnabled: cfg.DHIS2_SYNC_ENABLED, host: hostOf(cfg.DHIS2_BASE_URL) };
    if (!configured || !dhis2) {
      return { ...base, reachable: null, counts: null, recentPushes: [] };
    }
    let reachable;
    try {
      reachable = await dhis2.target.healthCheck();
    } catch (e) {
      reachable = { status: 'down' as const, latencyMs: 0, detail: redact(e instanceof Error ? e.message : String(e)) };
    }
    const [mappings, orgUnitMappings, schedules] = await Promise.all([
      dhis2.mappings.list(),
      dhis2.orgUnits.list(),
      dhis2.schedules.list(),
    ]);
    const recentPushes = await dhis2.recentPushes(10);
    return {
      ...base,
      reachable,
      counts: { mappings: mappings.length, orgUnitMappings: orgUnitMappings.length, schedules: schedules.length },
      recentPushes,
    };
  });
}
