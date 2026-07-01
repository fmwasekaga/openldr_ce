import { Client } from 'pg';
import type { Notification } from 'pg';
import { buildPgUrl } from './connector-db';
import type { ListenerDriver, ListenerHandle, ListenerSpec, OnFire } from './workflow-listeners';

const CHANNEL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateChannel(channel: string): string {
  if (!CHANNEL_RE.test(channel)) throw new Error(`Postgres trigger: invalid channel: ${channel}`);
  return channel;
}

/** NOTIFY payload → run input. JSON objects are spread; anything else is wrapped. `channel` is always attached. */
export function parseNotifyPayload(channel: string, payload: string): Record<string, unknown> {
  try {
    const v = JSON.parse(payload);
    if (v && typeof v === 'object' && !Array.isArray(v)) return { channel, ...(v as Record<string, unknown>) };
  } catch { /* not JSON */ }
  return { channel, payload };
}

export interface PostgresDriverDeps {
  connectors: {
    get(id: string): Promise<{ type: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  logger: { error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
  makeClient?: (connectionString: string) => Client;
}

const BACKOFF_START = 1000;
const BACKOFF_MAX = 30_000;

export function createPostgresListenerDriver(deps: PostgresDriverDeps): ListenerDriver {
  const make = deps.makeClient ?? ((cs: string) => new Client({ connectionString: cs }));
  return {
    async start(spec: ListenerSpec, onFire: OnFire): Promise<ListenerHandle> {
      const connectorId = String(spec.config.connectorId ?? '');
      const channel = validateChannel(String(spec.config.channel ?? ''));
      const c = await deps.connectors.get(connectorId);
      if (!c || !c.enabled) throw new Error(`Postgres trigger: connector ${connectorId} not found or disabled`);
      if (c.type !== 'postgres') throw new Error(`Postgres trigger: connector ${connectorId} is not a postgres connector`);
      const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
      const url = buildPgUrl(config);

      let client: Client | null = null;
      let stopped = false;
      let backoff = BACKOFF_START;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      const scheduleReconnect = (): void => {
        if (stopped || retryTimer) return;
        const old = client; client = null;
        if (old) { old.removeAllListeners(); old.end().catch(() => {}); }
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect().catch((err) => { deps.logger.warn({ err, workflowId: spec.workflowId }, 'postgres listener reconnect failed'); scheduleReconnect(); });
        }, backoff);
        backoff = Math.min(backoff * 2, BACKOFF_MAX);
      };

      const connect = async (): Promise<void> => {
        if (stopped) return;
        const cl = make(url);
        client = cl;
        cl.on('notification', (msg: Notification) => {
          void onFire(parseNotifyPayload(msg.channel ?? channel, msg.payload ?? ''), undefined)
            .catch((err) => deps.logger.error({ err, workflowId: spec.workflowId }, 'postgres trigger run failed'));
        });
        cl.on('error', (err: Error) => { deps.logger.warn({ err, workflowId: spec.workflowId }, 'postgres listener error'); scheduleReconnect(); });
        cl.on('end', () => scheduleReconnect());
        await cl.connect();
        await cl.query(`LISTEN "${channel}"`);
        backoff = BACKOFF_START;
      };

      await connect();
      return {
        async stop() {
          stopped = true;
          if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
          const cl = client; client = null;
          if (cl) { cl.removeAllListeners(); await cl.end().catch(() => {}); }
        },
      };
    },
  };
}
