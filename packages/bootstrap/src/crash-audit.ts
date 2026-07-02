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
  // Group by fingerprint so a restart loop of the SAME crash collapses into one row that carries
  // an occurrence count + first/last-seen span, instead of thousands of near-identical rows.
  const groups = new Map<string, typeof markers>();
  for (const m of markers) {
    // fingerprint is always set by buildCrashMarker; the fallback only guards legacy/malformed
    // on-disk markers parsed loosely from the crash log.
    const key = m.fingerprint ?? `${m.kind}:${m.error}`;
    const g = groups.get(key);
    if (g) g.push(m); else groups.set(key, [m]);
  }
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const rep = sorted[sorted.length - 1]; // most recent as representative
    const culprit = rep.inFlight[0];
    const isLoop = rep.kind === 'crash.loop';
    await safeRecord(opts.audit, opts.logger, {
      actorType: 'system',
      actorName: 'system',
      action: isLoop ? 'system.crash_loop' : culprit ? 'plugin.crash' : 'system.crash',
      entityType: culprit ? 'plugin' : 'system',
      entityId: culprit?.pluginId ?? 'process',
      metadata: {
        kind: rep.kind,
        error: rep.error,
        fingerprint: rep.fingerprint,
        occurrenceCount: sorted.length,
        firstSeen: sorted[0].at,
        lastSeen: rep.at,
        inFlight: rep.inFlight,
        ...(rep.stack ? { stack: rep.stack } : {}),
      },
    });
  }
  if (markers.length) opts.logger.warn({ count: markers.length }, 'drained plugin crash markers into the audit trail');
  return markers.length;
}
