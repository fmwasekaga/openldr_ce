import { probe } from '@openldr/core';
import type { WasmSink } from '@openldr/plugins';
import type { ReportingTargetPort, TargetMetadata, TargetPushArgs, TargetPushResult } from '@openldr/ports';

/** Wrap a loaded sink plugin as a ReportingTargetPort bound to one connector's
 *  decrypted config + pinned egress host. Dry-runs pin no host (no egress); real
 *  pushes pin [allowedHost] → the runner's worker-path HTTP egress. */
export function createPluginTarget(
  sink: WasmSink,
  config: Record<string, string>,
  allowedHost: string | null,
): ReportingTargetPort {
  const hosts = allowedHost ? [allowedHost] : [];
  return {
    async healthCheck() {
      return probe(async () => {
        const out = (await sink.invoke('health_check', {}, { config, allowedHosts: hosts })) as { ok?: boolean; error?: string };
        if (!out.ok) throw new Error(out.error ?? 'health check returned not-ok');
      });
    },
    async pullMetadata() {
      return (await sink.invoke('pull_metadata', {}, { config, allowedHosts: hosts })) as TargetMetadata;
    },
    async pushAggregate({ rows, mapping, orgUnitMap, period, dryRun }: TargetPushArgs) {
      const input = { rows, mapping, orgUnitMap, period, dryRun };
      return (await sink.invoke('push_aggregate', input, { config, allowedHosts: dryRun ? [] : hosts })) as TargetPushResult;
    },
    async pushEvents({ rows, mapping, orgUnitMap, period, dryRun }: TargetPushArgs) {
      const input = { rows, mapping, orgUnitMap, period, dryRun };
      return (await sink.invoke('push_tracker', input, { config, allowedHosts: dryRun ? [] : hosts })) as TargetPushResult;
    },
  };
}
