import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createWorkflowSecretStore } from './workflow-secret-store';

const key = randomBytes(32).toString('base64');

describe('workflow secret store', () => {
  it('put → resolve round-trips the plaintext', async () => {
    const db = await makeMigratedDb();
    const store = createWorkflowSecretStore(db);
    const id = await store.put('wf1', 's3cr3t-token', key);
    expect(id).toMatch(/^wsec_/);
    expect(await store.resolve(id, key)).toBe('s3cr3t-token');
    await db.destroy();
  });

  it('resolve throws for an unknown id', async () => {
    const db = await makeMigratedDb();
    const store = createWorkflowSecretStore(db);
    await expect(store.resolve('wsec_nope', key)).rejects.toThrow(/not found/i);
    await db.destroy();
  });

  it('resolve throws on a wrong key', async () => {
    const db = await makeMigratedDb();
    const store = createWorkflowSecretStore(db);
    const id = await store.put('wf1', 's3cr3t', key);
    await expect(store.resolve(id, randomBytes(32).toString('base64'))).rejects.toThrow(/decrypt/i);
    await db.destroy();
  });

  it('put fails closed when the encryption key is unset', async () => {
    const db = await makeMigratedDb();
    const store = createWorkflowSecretStore(db);
    await expect(store.put('wf1', 's3cr3t', undefined)).rejects.toThrow(/SECRETS_ENCRYPTION_KEY/);
    await db.destroy();
  });

  it('resolve fails closed when the encryption key is unset', async () => {
    const db = await makeMigratedDb();
    const store = createWorkflowSecretStore(db);
    const id = await store.put('wf1', 's3cr3t', key);
    await expect(store.resolve(id, undefined)).rejects.toThrow(/SECRETS_ENCRYPTION_KEY/);
    await db.destroy();
  });

  it('deleteForWorkflow removes every secret for that workflow', async () => {
    const db = await makeMigratedDb();
    const store = createWorkflowSecretStore(db);
    const a = await store.put('wf1', 'one', key);
    const b = await store.put('wf1', 'two', key);
    const other = await store.put('wf2', 'keep', key);

    await store.deleteForWorkflow('wf1');
    await expect(store.resolve(a, key)).rejects.toThrow(/not found/i);
    await expect(store.resolve(b, key)).rejects.toThrow(/not found/i);
    // A different workflow's secret is untouched.
    expect(await store.resolve(other, key)).toBe('keep');
    await db.destroy();
  });

  it('deleteExcept keeps the listed ids and drops the rest (orphan GC)', async () => {
    const db = await makeMigratedDb();
    const store = createWorkflowSecretStore(db);
    const keep = await store.put('wf1', 'keep', key);
    const drop = await store.put('wf1', 'drop', key);

    await store.deleteExcept('wf1', [keep]);
    expect(await store.resolve(keep, key)).toBe('keep');
    await expect(store.resolve(drop, key)).rejects.toThrow(/not found/i);
    await db.destroy();
  });

  it('deleteExcept with no keepIds removes all of the workflow secrets', async () => {
    const db = await makeMigratedDb();
    const store = createWorkflowSecretStore(db);
    const a = await store.put('wf1', 'one', key);
    await store.deleteExcept('wf1', []);
    await expect(store.resolve(a, key)).rejects.toThrow(/not found/i);
    await db.destroy();
  });
});
