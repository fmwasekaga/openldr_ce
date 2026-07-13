import type pg from 'pg';

export interface ProjectionWorkerDeps {
  runCycle: () => Promise<number>;
  intervalMs?: number;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
  // Optional dedicated pg client for LISTEN 'fhir_changes' wakeups (interval polling works without it).
  listenClient?: pg.Client;
}

export interface ProjectionWorker {
  tickOnce(): Promise<void>;
  stop(): Promise<void>;
}

export function createProjectionWorker(deps: ProjectionWorkerDeps): ProjectionWorker {
  const intervalMs = deps.intervalMs ?? 2000;
  let stopped = false;
  let running = false;

  async function tickOnce(): Promise<void> {
    if (running) return; // never overlap cycles
    running = true;
    try {
      await deps.runCycle();
    } catch (err) {
      deps.logger.error({ err }, 'projection cycle failed');
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);
  if (deps.listenClient) {
    deps.listenClient.query('listen fhir_changes').catch(() => undefined);
    deps.listenClient.on('notification', () => { if (!stopped) void tickOnce(); });
  }

  return {
    tickOnce,
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (deps.listenClient) {
        try { await deps.listenClient.query('unlisten fhir_changes'); } catch { /* ignore */ }
      }
    },
  };
}
