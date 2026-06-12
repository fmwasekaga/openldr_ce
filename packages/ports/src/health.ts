export type HealthStatus = 'up' | 'down' | 'degraded';

export interface HealthResult {
  status: HealthStatus;
  latencyMs: number;
  detail?: string;
}

export interface HealthCheck {
  readonly name: string;
  check(): Promise<HealthResult>;
}

export const PORT_NAMES = ['auth', 'blob', 'eventing', 'target-store'] as const;
export type PortName = (typeof PORT_NAMES)[number];
