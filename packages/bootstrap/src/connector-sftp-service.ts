import Client from 'ssh2-sftp-client';

export interface SftpLike {
  connect(opts: { host: string; port: number; username: string; password: string }): Promise<unknown>;
  get(remotePath: string): Promise<string | Buffer | NodeJS.WritableStream>;
  put(input: Buffer, remotePath: string): Promise<string>;
  list(remotePath: string): Promise<Array<{ name: string; size: number; type: string }>>;
  delete(remotePath: string): Promise<string>;
  rename(from: string, to: string): Promise<string>;
  end(): Promise<void>;
}

function validatePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`invalid connector port: ${raw}`);
  return port;
}

async function defaultConnect(config: Record<string, string>): Promise<SftpLike> {
  const client = new Client() as unknown as SftpLike;
  await client.connect({ host: config.host || 'localhost', port: validatePort(config.port, 22), username: config.user ?? '', password: config.password ?? '' });
  return client;
}

export interface ConnectorSftpDeps {
  connectors: { get(id: string): Promise<{ type: string | null; enabled: boolean } | null>; getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>> };
  secretsKey: string | undefined;
  connect?: (config: Record<string, string>) => Promise<SftpLike>;
}

export function createConnectorSftpRunner(deps: ConnectorSftpDeps) {
  const connect = deps.connect ?? defaultConnect;
  return async ({ connectorId, operation, remotePath, toPath, bytes }: { connectorId: string; operation: string; remotePath: string; toPath?: string; bytes?: Uint8Array }) => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (c.type !== 'sftp') throw new Error(`connector ${connectorId} is not an sftp connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const client = await connect(config);
    try {
      if (operation === 'upload') {
        await client.put(Buffer.from(bytes ?? new Uint8Array()), remotePath);
        return { ok: true };
      }
      if (operation === 'list') {
        const rows = await client.list(remotePath);
        return { entries: rows.map((r) => ({ name: r.name, size: r.size, type: r.type })) };
      }
      if (operation === 'delete') {
        await client.delete(remotePath);
        return { ok: true };
      }
      if (operation === 'rename') {
        if (!toPath) throw new Error('sftp rename requires toPath');
        await client.rename(remotePath, toPath);
        return { ok: true };
      }
      const data = await client.get(remotePath);
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as string);
      const fileName = remotePath.split('/').pop() || 'download';
      return { bytes: new Uint8Array(buf), fileName };
    } finally {
      await client.end();
    }
  };
}
