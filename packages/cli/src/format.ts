import type { AggregatedHealth } from '@openldr/core';

export function exitCodeFor(health: AggregatedHealth): number {
  return health.status === 'down' ? 1 : 0;
}

export function formatHealthTable(health: AggregatedHealth): string {
  const rows = Object.entries(health.checks).map(([name, r]) => {
    const detail = r.detail ? `  ${r.detail}` : '';
    return `  ${name.padEnd(14)} ${r.status.padEnd(9)} ${String(r.latencyMs).padStart(5)}ms${detail}`;
  });
  return [`overall: ${health.status}`, ...rows].join('\n');
}
