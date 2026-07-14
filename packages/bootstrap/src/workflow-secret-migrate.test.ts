import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createWorkflowSecretStore, type InternalSchema, type WorkflowSecretStore } from '@openldr/db';
import { isSecretRef } from '@openldr/workflows';
import { migrateWorkflowSecrets } from './workflow-secret-migrate';

const key = randomBytes(32).toString('base64');

// A silent logger with spy-able warn (best-effort skips log via warn).
function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
}

// Minimal in-memory workflow store: list()/update() are all the migration needs. Each stored
// workflow keeps its full shape so `{ ...w, definition }` round-trips like the real store.
function fakeWorkflowStore(initial: Array<{ id: string; definition: unknown; [k: string]: unknown }> = []) {
  const rows = new Map(initial.map((w) => [w.id, { ...w }]));
  const updates: Array<{ id: string; next: unknown }> = [];
  return {
    updates,
    rows,
    async list() {
      return [...rows.values()].map((w) => ({ ...w }));
    },
    async update(id: string, next: unknown) {
      updates.push({ id, next });
      rows.set(id, { ...(next as { id: string; definition: unknown; [k: string]: unknown }) });
      return next;
    },
  };
}

// A webhook-trigger node with a plaintext `secret` + an HTTP node with a plaintext auth-header blob.
function definitionWithPlaintext() {
  return {
    nodes: [
      { id: 'hook', type: 'webhook', data: { secret: 's3cret-token' } },
      {
        id: 'http',
        type: 'http',
        data: { config: { url: 'https://x', headers: { Authorization: 'Bearer abc123' } } },
      },
    ],
    edges: [],
  };
}

async function newSecretStore(): Promise<{ store: WorkflowSecretStore; db: Kysely<InternalSchema> }> {
  const db = (await makeMigratedDb()) as unknown as Kysely<InternalSchema>;
  return { store: createWorkflowSecretStore(db), db };
}

describe('migrateWorkflowSecrets', () => {
  it('seals plaintext webhook secret + headers blob into refs; resolve returns the originals', async () => {
    const { store: secretStore, db } = await newSecretStore();
    const wfStore = fakeWorkflowStore([
      { id: 'wf1', name: 'W', enabled: true, definition: definitionWithPlaintext() },
    ]);

    await migrateWorkflowSecrets({ store: wfStore, secretStore, key, logger: fakeLogger() });

    // store.update called once with a ref-only definition.
    expect(wfStore.updates).toHaveLength(1);
    const def = (wfStore.updates[0].next as { definition: { nodes: { id: string; data: Record<string, unknown> }[] } }).definition;
    const hook = def.nodes.find((n) => n.id === 'hook')!;
    const http = def.nodes.find((n) => n.id === 'http')!;
    expect(isSecretRef(hook.data.secret)).toBe(true);
    const headers = (http.data.config as { headers: unknown }).headers;
    expect(isSecretRef(headers)).toBe(true);
    // No plaintext survives in the persisted definition.
    expect(JSON.stringify(def)).not.toContain('s3cret-token');
    expect(JSON.stringify(def)).not.toContain('Bearer abc123');

    // The secretStore holds the sealed values; resolve returns the originals.
    const secretRef = (hook.data.secret as { secretRef: string }).secretRef;
    const headersRef = (headers as { secretRef: string }).secretRef;
    expect(await secretStore.resolve(secretRef, key)).toBe('s3cret-token');
    // Headers blob is sealed as a JSON string (the HTTP node re-parses it at use).
    expect(JSON.parse(await secretStore.resolve(headersRef, key))).toEqual({ Authorization: 'Bearer abc123' });

    await db.destroy();
  });

  it('is idempotent: a second run over an all-refs definition makes no change', async () => {
    const { store: secretStore, db } = await newSecretStore();
    const wfStore = fakeWorkflowStore([
      { id: 'wf1', name: 'W', enabled: true, definition: definitionWithPlaintext() },
    ]);

    await migrateWorkflowSecrets({ store: wfStore, secretStore, key, logger: fakeLogger() });
    expect(wfStore.updates).toHaveLength(1); // sealed on the first pass

    // Count sealed rows after the first run.
    const before = await db.selectFrom('workflow_secrets').select('id').execute();

    // Second run: the definition is already all-refs → changed stays false → no update.
    await migrateWorkflowSecrets({ store: wfStore, secretStore, key, logger: fakeLogger() });
    expect(wfStore.updates).toHaveLength(1); // still just the one update

    // No new secret rows were minted.
    const after = await db.selectFrom('workflow_secrets').select('id').execute();
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());

    await db.destroy();
  });

  it('no key → skips, logs a warning, throws nothing, store untouched', async () => {
    const { store: secretStore, db } = await newSecretStore();
    const wfStore = fakeWorkflowStore([
      { id: 'wf1', name: 'W', enabled: true, definition: definitionWithPlaintext() },
    ]);
    const logger = fakeLogger();

    await expect(
      migrateWorkflowSecrets({ store: wfStore, secretStore, key: undefined, logger }),
    ).resolves.toBeUndefined();

    expect(wfStore.updates).toHaveLength(0);
    expect((logger as unknown as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalledWith(
      expect.stringContaining('SECRETS_ENCRYPTION_KEY'),
    );
    const rows = await db.selectFrom('workflow_secrets').select('id').execute();
    expect(rows).toHaveLength(0);

    await db.destroy();
  });

  it('best-effort: one malformed workflow is logged + skipped, others still migrate', async () => {
    const { store: secretStore, db } = await newSecretStore();
    const wfStore = fakeWorkflowStore([
      { id: 'bad', name: 'Bad', enabled: true, definition: 42 }, // non-object definition
      { id: 'wf1', name: 'W', enabled: true, definition: definitionWithPlaintext() },
    ]);
    const logger = fakeLogger();

    await migrateWorkflowSecrets({ store: wfStore, secretStore, key, logger });

    // The malformed workflow (a non-object definition) yields no secret fields → no update; a
    // scalar definition can't be mutated but also doesn't throw, so it's a benign no-op here.
    // The GOOD workflow is still sealed.
    const wf1Update = wfStore.updates.find((u) => u.id === 'wf1');
    expect(wf1Update).toBeDefined();
    // 'bad' never gets an update (nothing to seal / no throw path).
    expect(wfStore.updates.find((u) => u.id === 'bad')).toBeUndefined();

    await db.destroy();
  });

  it('best-effort: a throwing secretStore.put on one workflow does not abort the loop', async () => {
    const { store: realStore, db } = await newSecretStore();
    const wfStore = fakeWorkflowStore([
      { id: 'wf-boom', name: 'Boom', enabled: true, definition: definitionWithPlaintext() },
      { id: 'wf-ok', name: 'Ok', enabled: true, definition: definitionWithPlaintext() },
    ]);
    const logger = fakeLogger();
    // put throws for wf-boom, succeeds (delegates to the real store) for wf-ok.
    const secretStore: WorkflowSecretStore = {
      ...realStore,
      put: vi.fn(async (workflowId: string, plaintext: string, k: string | undefined) => {
        if (workflowId === 'wf-boom') throw new Error('seal failed');
        return realStore.put(workflowId, plaintext, k);
      }),
    };

    await migrateWorkflowSecrets({ store: wfStore, secretStore, key, logger });

    // wf-boom aborted mid-seal (logged, skipped, no update); wf-ok still migrated.
    expect(wfStore.updates.find((u) => u.id === 'wf-boom')).toBeUndefined();
    expect(wfStore.updates.find((u) => u.id === 'wf-ok')).toBeDefined();
    expect((logger as unknown as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-boom' }),
      expect.stringContaining('skipped one workflow'),
    );

    await db.destroy();
  });

  it('a workflow with no secrets is not updated (changed stays false)', async () => {
    const { store: secretStore, db } = await newSecretStore();
    const wfStore = fakeWorkflowStore([
      {
        id: 'wf1',
        name: 'W',
        enabled: true,
        definition: { nodes: [{ id: 'log', type: 'log', data: { level: 'info' } }], edges: [] },
      },
    ]);

    await migrateWorkflowSecrets({ store: wfStore, secretStore, key, logger: fakeLogger() });

    expect(wfStore.updates).toHaveLength(0);
    const rows = await db.selectFrom('workflow_secrets').select('id').execute();
    expect(rows).toHaveLength(0);

    await db.destroy();
  });
});
