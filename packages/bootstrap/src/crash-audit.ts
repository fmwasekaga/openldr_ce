import { drainCrashMarkers, type Logger } from '@openldr/core';
import { safeRecord, type AuditStore } from '@openldr/audit';

/**
 * Drain any pending plugin-crash markers (written synchronously by the process crash handler
 * before the process died — see `@openldr/core` crash-log) into the durable audit store on the
 * next boot, so a process-FATAL plugin crash surfaces in /api/audit and the CLI `audit list`.
 *
 * Best-effort: `safeRecord` never throws, the drain is destructive (markers are cleared as they
 * are read), and a failure here must never block startup. Returns the number of markers drained.
 */
export async function drainCrashMarkersToAudit(opts: { dir: string; audit: AuditStore; logger: Logger }): Promise<number> {
  let markers;
  try {
    markers = drainCrashMarkers(opts.dir);
  } catch (err) {
    opts.logger.warn({ err }, 'crash-marker drain failed (continuing)');
    return 0;
  }
  for (const m of markers) {
    // The first in-flight op is the most likely culprit; attribute the row to its plugin.
    const culprit = m.inFlight[0];
    await safeRecord(opts.audit, opts.logger, {
      actorType: 'system',
      actorName: 'system',
      action: culprit ? 'plugin.crash' : 'system.crash',
      entityType: culprit ? 'plugin' : 'system',
      entityId: culprit?.pluginId ?? 'process',
      metadata: {
        kind: m.kind,
        error: m.error,
        at: m.at,
        inFlight: m.inFlight,
        ...(m.stack ? { stack: m.stack } : {}),
      },
    });
  }
  if (markers.length) opts.logger.warn({ count: markers.length }, 'drained plugin crash markers into the audit trail');
  return markers.length;
}
