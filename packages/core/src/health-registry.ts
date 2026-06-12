import type { HealthCheck, HealthResult, HealthStatus } from '@openldr/ports';
import { errorMessage } from './errors';
import { redact } from './redact';

export interface AggregatedHealth {
  status: HealthStatus;
  checks: Record<string, HealthResult>;
}

export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();

  register(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  async runAll(): Promise<AggregatedHealth> {
    const items = [...this.checks.values()];
    const settled = await Promise.all(
      items.map(async (c): Promise<readonly [string, HealthResult]> => {
        try {
          return [c.name, await c.check()] as const;
        } catch (err) {
          return [c.name, { status: 'down', latencyMs: 0, detail: redact(errorMessage(err)) }] as const;
        }
      }),
    );

    const checks: Record<string, HealthResult> = {};
    let status: HealthStatus = 'up';
    for (const [name, result] of settled) {
      checks[name] = result;
      if (result.status === 'down') status = 'down';
      else if (result.status === 'degraded' && status === 'up') status = 'degraded';
    }
    return { status, checks };
  }
}
