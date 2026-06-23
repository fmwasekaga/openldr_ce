import { type Kysely, sql } from 'kysely';
import { seal, open, parseSecretKey, ConfigError, OpenLdrError } from '@openldr/core';
import type { InternalSchema } from './schema/internal';

/** A connector as exposed to callers — NEVER carries the secret config. */
export interface ConnectorRecord {
  id: string;
  name: string;
  pluginId: string;
  kind: string;
  allowedHost: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewConnector {
  id: string;
  name: string;
  pluginId: string;
  kind: string;
  /** Secret connection config (e.g. { baseUrl, username, password }) — sealed at rest. */
  config: Record<string, string>;
  /** Derived from baseUrl; kept in clear so egress can be pinned without decrypting. */
  allowedHost?: string | null;
}

export interface ConnectorPatch {
  name?: string;
  config?: Record<string, string>;
  allowedHost?: string | null;
  enabled?: boolean;
}

export interface ConnectorStore {
  create(input: NewConnector, key: string | undefined): Promise<void>;
  get(id: string): Promise<ConnectorRecord | null>;
  list(): Promise<ConnectorRecord[]>;
  update(id: string, patch: ConnectorPatch, key: string | undefined): Promise<void>;
  remove(id: string): Promise<void>;
  getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
}

// Columns returned to callers — config_encrypted is deliberately excluded so secrets
// (even ciphertext) never leave the store except via getDecryptedConfig.
const SAFE_COLUMNS = ['id', 'name', 'plugin_id', 'kind', 'allowed_host', 'enabled', 'created_at', 'updated_at'] as const;

function keyOf(key: string | undefined): Buffer {
  if (!key) {
    throw new ConfigError('SECRETS_ENCRYPTION_KEY is required to use secret-bearing connectors but is not set');
  }
  return parseSecretKey(key);
}

function toRecord(r: {
  id: string; name: string; plugin_id: string; kind: string;
  allowed_host: string | null; enabled: boolean; created_at: Date; updated_at: Date;
}): ConnectorRecord {
  return {
    id: r.id, name: r.name, pluginId: r.plugin_id, kind: r.kind,
    allowedHost: r.allowed_host, enabled: r.enabled, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function createConnectorStore(db: Kysely<InternalSchema>): ConnectorStore {
  return {
    async create(input, key) {
      const sealed = seal(JSON.stringify(input.config), keyOf(key));
      await db.insertInto('connectors').values({
        id: input.id, name: input.name, plugin_id: input.pluginId, kind: input.kind,
        config_encrypted: sealed, allowed_host: input.allowedHost ?? null,
      }).execute();
    },

    async get(id) {
      const r = await db.selectFrom('connectors').select(SAFE_COLUMNS).where('id', '=', id).executeTakeFirst();
      return r ? toRecord(r) : null;
    },

    async list() {
      const rows = await db.selectFrom('connectors').select(SAFE_COLUMNS).orderBy('name').execute();
      return rows.map(toRecord);
    },

    async update(id, patch, key) {
      const set: Record<string, unknown> = { updated_at: sql`now()` };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.allowedHost !== undefined) set.allowed_host = patch.allowedHost;
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      // Only the secret path needs the key — a non-secret patch must not fail closed.
      if (patch.config !== undefined) set.config_encrypted = seal(JSON.stringify(patch.config), keyOf(key));
      await db.updateTable('connectors').set(set).where('id', '=', id).execute();
    },

    async remove(id) {
      await db.deleteFrom('connectors').where('id', '=', id).execute();
    },

    async getDecryptedConfig(id, key) {
      const r = await db.selectFrom('connectors').select('config_encrypted').where('id', '=', id).executeTakeFirst();
      if (!r) throw new OpenLdrError(`connector ${id} not found`);
      return JSON.parse(open(r.config_encrypted, keyOf(key))) as Record<string, string>;
    },
  };
}
