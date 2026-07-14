import { forEachSecretField, isSecretRef } from '@openldr/workflows';
import type { WorkflowSecretStore } from '@openldr/db';
import type { Logger } from '@openldr/core';
import { sealDefinitionSecrets } from './workflow-secret-seal';

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
 * The seal itself is `sealDefinitionSecrets` — the SAME helper the save path
 * (`extractWorkflowSecrets`) calls — so a migrated `{ secretRef }` is byte-identical
 * to a saved one (one impl, no drift between the two call sites).
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
      // Idempotency gate: a read-only scan decides whether this workflow needs sealing. A field
      // that is NOT already a `{ secretRef }` is either plaintext (to seal) or empty (to drop) —
      // both are changes the original inline walk flagged. An all-refs (or no-secret) definition
      // has nothing to do → skip the seal, the GC, and the `update` entirely (this is what keeps
      // the boot migration idempotent: a second pass over sealed refs mints/touches nothing).
      let changed = false;
      forEachSecretField(w.definition, (f) => {
        if (!isSecretRef(f.value)) changed = true;
      });
      if (changed) {
        // ONE shared seal impl (also the save path's) — a migrated ref is byte-identical to a
        // saved one. It seals plaintext, drops empties, and GCs orphaned rows, returning the
        // ref-only definition. Merge onto the full workflow: the store's `update` forces the
        // whole row through WorkflowSchema — a `{ definition }` partial would fail to parse.
        const def = await sealDefinitionSecrets(w.definition, w.id, deps.secretStore, deps.key);
        await deps.store.update(w.id, { ...w, definition: def });
      }
    } catch (err) {
      deps.logger.warn({ err, workflowId: w.id }, 'SEC-06: workflow-secret migration skipped one workflow');
    }
  }
}
