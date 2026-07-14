import { mapSecretFieldsAsync, isSecretRef } from '@openldr/workflows';
import type { WorkflowSecretStore } from '@openldr/db';
import type { Logger } from '@openldr/core';

/**
 * One-time, boot-time seal of PLAINTEXT workflow secrets (SEC-06).
 *
 * Workflows saved before SEC-06 still hold plaintext secrets (the webhook `secret`
 * string, an auth-bearing `config.headers` blob) inline in their definitions. New
 * saves are already sealed by `extractWorkflowSecrets`, but existing rows stay
 * plaintext until the next save. This shim proactively seals them once at boot,
 * mirroring `migrateLegacySyncConfig`: idempotent, best-effort, key-injected (runs
 * WITH the SECRETS_ENCRYPTION_KEY the SQL migrator lacks), and can-never-crash-boot.
 *
 * The seal logic here is byte-for-byte the same as `extractWorkflowSecrets`
 * (same emptiness check on the raw value shape, same JSON.stringify-object-before-put),
 * so a migrated `{ secretRef }` is indistinguishable from a saved one.
 *
 * Idempotent: a definition that is already all-refs leaves `changed` false → no
 * `update`, no new secret rows. Best-effort per-workflow: one malformed/failed
 * workflow is logged and skipped without aborting the loop. Key-guarded: with no
 * key it warns and returns (a fail-closed `put` would otherwise throw).
 */
export async function migrateWorkflowSecrets(deps: {
  store: {
    list(): Promise<Array<{ id: string; definition: unknown }>>;
    update(id: string, next: unknown): Promise<unknown>;
  };
  secretStore: WorkflowSecretStore;
  key: string | undefined;
  logger: Logger;
}): Promise<void> {
  if (!deps.key) {
    deps.logger.warn('SEC-06: workflow-secret migration skipped — SECRETS_ENCRYPTION_KEY unset');
    return;
  }
  for (const w of await deps.store.list()) {
    try {
      let changed = false;
      const kept: string[] = [];
      const def = await mapSecretFieldsAsync(w.definition, async (f) => {
        // Already-sealed ref → keep the row, seal nothing.
        if (isSecretRef(f.value)) {
          kept.push(f.value.secretRef);
          return;
        }
        // Emptiness is decided on the RAW value shape (NOT the serialized string), so a
        // literal secret of 'null' or '{}' is still sealed — identical to extractWorkflowSecrets.
        const v = f.value;
        const isEmpty =
          v == null ||
          (typeof v === 'string' && v.length === 0) ||
          (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);
        if (isEmpty) {
          f.set(undefined); // empty → drop the field entirely
          changed = true;
          return;
        }
        // Plaintext: webhook `secret` is a string; the HTTP `config.headers` blob may be a
        // string OR object — JSON.stringify the non-string form before sealing (the resolver
        // returns the string, which the HTTP node parses).
        const plaintext = typeof v === 'string' ? v : JSON.stringify(v);
        const id = await deps.secretStore.put(w.id, plaintext, deps.key);
        kept.push(id);
        f.set({ secretRef: id });
        changed = true;
      });
      if (changed) {
        // GC any secrets no longer referenced (empty kept → drop all), then persist the
        // ref-only definition. Merge onto the full workflow: the store's `update` forces the
        // whole row through WorkflowSchema — a `{ definition }` partial would fail to parse.
        await deps.secretStore.deleteExcept(w.id, kept);
        await deps.store.update(w.id, { ...w, definition: def });
      }
    } catch (err) {
      deps.logger.warn({ err, workflowId: w.id }, 'SEC-06: workflow-secret migration skipped one workflow');
    }
  }
}
